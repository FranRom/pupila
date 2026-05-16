// Storage layer for `config/applied.json`. Used by:
//   - The UI middleware (ui/plugins/applied.ts via re-export through _shared.ts)
//   - The MCP write tools (src/mcp/tools/mark-applied.ts and siblings)
//   - The AI Apply core (src/lib/ai-apply.ts — currently has its own copy of
//     the atomic-write logic; ideally migrates here but left alone for now)
//
// Atomic write via temp+rename so a concurrent UI POST and an MCP write tool
// can't tear the file. Same shape as `atomicWriteJson` in ai-apply.ts.

import { readFile, rename, writeFile } from 'node:fs/promises';
import type { ApplicationStatus, AppliedEntry } from '../types.js';

export type { AppliedEntry };

const DEFAULT_PATH = 'config/applied.json';

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, filePath);
}

export async function readApplied(appliedPath: string = DEFAULT_PATH): Promise<AppliedEntry[]> {
  try {
    const raw = await readFile(appliedPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AppliedEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeApplied(
  entries: AppliedEntry[],
  appliedPath: string = DEFAULT_PATH,
): Promise<void> {
  await atomicWriteJson(appliedPath, entries);
}

/**
 * Upsert an applied entry by URL. Returns the resulting entries list.
 *
 * Matches the existing UI behavior: when an entry with the same URL already
 * exists, the new record fully replaces it (not a deep-merge). Callers
 * wanting partial update should read first, merge in JS, then call this.
 */
export async function upsertApplied(
  entry: AppliedEntry,
  appliedPath: string = DEFAULT_PATH,
): Promise<{ entry: AppliedEntry; created: boolean; entries: AppliedEntry[] }> {
  const entries = await readApplied(appliedPath);
  const idx = entries.findIndex((e) => e?.url === entry.url);
  const created = idx < 0;
  const next = created ? [...entries, entry] : entries.map((e, i) => (i === idx ? entry : e));
  await writeApplied(next, appliedPath);
  return { entry, created, entries: next };
}

/**
 * Update only an existing entry. Returns null if no entry with the given
 * URL exists — caller can surface that as a precondition error.
 */
export async function updateAppliedStatus(
  url: string,
  patch: Partial<Pick<AppliedEntry, 'status' | 'date' | 'notes'>>,
  appliedPath: string = DEFAULT_PATH,
): Promise<AppliedEntry | null> {
  const entries = await readApplied(appliedPath);
  const idx = entries.findIndex((e) => e?.url === url);
  if (idx < 0) return null;
  const existing = entries[idx];
  if (!existing) return null;
  const next: AppliedEntry = {
    url: existing.url,
    status: (patch.status as ApplicationStatus | undefined) ?? existing.status,
    date: patch.date ?? existing.date,
    ...(patch.notes !== undefined
      ? { notes: patch.notes }
      : existing.notes !== undefined
        ? { notes: existing.notes }
        : {}),
  };
  const merged = entries.map((e, i) => (i === idx ? next : e));
  await writeApplied(merged, appliedPath);
  return next;
}

/**
 * Remove by URL. Idempotent — returns the count of entries removed (0 or 1).
 */
export async function removeApplied(
  url: string,
  appliedPath: string = DEFAULT_PATH,
): Promise<number> {
  const entries = await readApplied(appliedPath);
  const filtered = entries.filter((e) => e?.url !== url);
  const removed = entries.length - filtered.length;
  if (removed > 0) await writeApplied(filtered, appliedPath);
  return removed;
}
