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

// NOTE: No in-process lock. Concurrent addFavorite calls within the same
// process may clobber each other. Acceptable for single-user usage.
export async function addFavorite(jobId: string, path = DEFAULT_PATH): Promise<void> {
  const current = await loadFavorites(path);

  const alreadyFavorited = current.favorites.some((f) => f.jobId === jobId);
  if (alreadyFavorited) {
    return;
  }

  const newEntry: Favorite = {
    jobId,
    favoritedAt: new Date().toISOString(),
  };

  const updated: FavoritesFile = {
    favorites: [...current.favorites, newEntry],
  };

  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function removeFavorite(jobId: string, path = DEFAULT_PATH): Promise<void> {
  const current = await loadFavorites(path);
  const updated: FavoritesFile = {
    favorites: current.favorites.filter((f) => f.jobId !== jobId),
  };
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function hasFavorite(jobId: string, path = DEFAULT_PATH): Promise<boolean> {
  const { favorites } = await loadFavorites(path);
  return favorites.some((f) => f.jobId === jobId);
}

export async function listFavoriteIds(path = DEFAULT_PATH): Promise<Set<string>> {
  const { favorites } = await loadFavorites(path);
  return new Set(favorites.map((f) => f.jobId));
}
