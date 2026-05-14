import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SwipeSkip {
  jobId: string;
  skippedAt: string;
}

export interface SwipeSkipsFile {
  skips: SwipeSkip[];
}

const DEFAULT_PATH = 'data/swipe-skips.json';

function emptyFile(): SwipeSkipsFile {
  return { skips: [] };
}

function isSwipeSkip(value: unknown): value is SwipeSkip {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === 'string' && typeof v.skippedAt === 'string';
}

export async function loadSwipeSkips(path = DEFAULT_PATH): Promise<SwipeSkipsFile> {
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
    !('skips' in parsed) ||
    !Array.isArray((parsed as { skips: unknown }).skips)
  ) {
    return emptyFile();
  }

  const rawSkips = (parsed as { skips: unknown[] }).skips;
  return { skips: rawSkips.filter(isSwipeSkip) };
}

// NOTE: No in-process lock. Concurrent addSwipeSkip calls within the same
// process may clobber each other. Acceptable for single-user, swipe-paced usage.
export async function addSwipeSkip(jobId: string, path = DEFAULT_PATH): Promise<void> {
  const current = await loadSwipeSkips(path);

  const alreadySkipped = current.skips.some((s) => s.jobId === jobId);
  if (alreadySkipped) {
    return;
  }

  const newEntry: SwipeSkip = {
    jobId,
    skippedAt: new Date().toISOString(),
  };

  const updated: SwipeSkipsFile = {
    skips: [...current.skips, newEntry],
  };

  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function removeSwipeSkip(jobId: string, path = DEFAULT_PATH): Promise<void> {
  const current = await loadSwipeSkips(path);
  const updated: SwipeSkipsFile = {
    skips: current.skips.filter((s) => s.jobId !== jobId),
  };
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function hasSwipeSkip(jobId: string, path = DEFAULT_PATH): Promise<boolean> {
  const { skips } = await loadSwipeSkips(path);
  return skips.some((s) => s.jobId === jobId);
}

export async function listSwipeSkipIds(path = DEFAULT_PATH): Promise<Set<string>> {
  const { skips } = await loadSwipeSkips(path);
  return new Set(skips.map((s) => s.jobId));
}
