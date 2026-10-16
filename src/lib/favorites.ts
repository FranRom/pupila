import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Favorite {
  jobId: string;
  favoritedAt: string;
}

export interface FavoritesFile {
  favorites: Favorite[];
}

const DEFAULT_PATH = 'data/favorites.json';

function emptyFile(): FavoritesFile {
  return { favorites: [] };
}

function isFavorite(value: unknown): value is Favorite {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === 'string' && typeof v.favoritedAt === 'string';
}

export async function loadFavorites(path = DEFAULT_PATH): Promise<FavoritesFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return emptyFile();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFile();
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('favorites' in parsed) ||
    !Array.isArray((parsed as { favorites: unknown }).favorites)
  ) {
    return emptyFile();
  }

  const rawFavorites = (parsed as { favorites: unknown[] }).favorites;
  return { favorites: rawFavorites.filter(isFavorite) };
}

// Mutations are read-modify-write on one file, so they are serialized per path
// through a promise chain (the server is a single process). Each write goes to a
// unique temp file and is renamed into place, so a crash never leaves a
// half-written favorites.json and two writers never share a temp file.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(path) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(path, tail);
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path);
  });
  return run;
}

// Reads for a mutation. A MISSING file is simply empty. A file that exists but
// cannot be parsed is set aside (not overwritten) so one bad write never
// silently erases every earlier favorite.
async function loadForMutation(path: string): Promise<FavoritesFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as { favorites?: unknown };
    if (parsed && Array.isArray(parsed.favorites)) {
      return { favorites: parsed.favorites.filter(isFavorite) };
    }
  } catch {
    // fall through to quarantine
  }
  const aside = `${path}.corrupt-${Date.now()}`;
  await rename(path, aside);
  console.warn(`[favorites] ${path} was unreadable; moved to ${aside} and starting empty`);
  return emptyFile();
}

async function writeAtomic(path: string, data: FavoritesFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

export function addFavorite(jobId: string, path = DEFAULT_PATH): Promise<void> {
  return serialized(path, async () => {
    const current = await loadForMutation(path);
    if (current.favorites.some((f) => f.jobId === jobId)) return;
    await writeAtomic(path, {
      favorites: [...current.favorites, { jobId, favoritedAt: new Date().toISOString() }],
    });
  });
}

export function removeFavorite(jobId: string, path = DEFAULT_PATH): Promise<void> {
  return serialized(path, async () => {
    const current = await loadForMutation(path);
    await writeAtomic(path, { favorites: current.favorites.filter((f) => f.jobId !== jobId) });
  });
}

export async function hasFavorite(jobId: string, path = DEFAULT_PATH): Promise<boolean> {
  const { favorites } = await loadFavorites(path);
  return favorites.some((f) => f.jobId === jobId);
}

export async function listFavoriteIds(path = DEFAULT_PATH): Promise<Set<string>> {
  const { favorites } = await loadFavorites(path);
  return new Set(favorites.map((f) => f.jobId));
}
