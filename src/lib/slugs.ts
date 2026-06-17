// Personal overlay on top of the shipped tier-S slug lists (config/slugs.json).
//
// config/slugs.json is committed + shared (the curated tier-S boards). Personal
// add/remove choices live in config/slugs.local.json (gitignored), stored as a
// per-ATS DELTA so upstream additions to slugs.json keep flowing through and the
// user's picks stay separate. Effective list = (shipped ∪ add) \ remove.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keys match config/slugs.json (camelCase ashbyPrivate), NOT the Source ids.
export const ATS_KEYS = ['ashby', 'greenhouse', 'lever', 'ashbyPrivate', 'recruitee'] as const;
export type AtsKey = (typeof ATS_KEYS)[number];

// Public ATS slugs are lowercase and use letters, digits, dot, dash, underscore
// (e.g. "polygon-labs", "li.fi", "monad.foundation"). The pattern doubles as an
// injection guard: these strings are interpolated into ATS board URLs.
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_SLUG_LENGTH = 100;

export interface SlugDelta {
  add: string[];
  remove: string[];
}
export type SlugOverlay = Partial<Record<AtsKey, SlugDelta>>;

// src/lib/slugs.ts → ../../ reaches the repo root.
const DEFAULT_SLUGS_LOCAL_PATH = fileURLToPath(
  new URL('../../config/slugs.local.json', import.meta.url),
);

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

// Effective list: shipped first (original order), then additions, deduped, with
// removals filtered out. Stable ordering keeps JOBS.md / dedup deterministic.
export function resolveSlugs(base: readonly string[], delta: SlugDelta | undefined): string[] {
  const removed = new Set(delta?.remove ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of [...base, ...(delta?.add ?? [])]) {
    if (removed.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function cleanSlugList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (isValidSlug(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// Validate one ATS delta. `add` wins over `remove` for the same slug so a
// re-added shipped slug never lands in both lists.
export function sanitizeDelta(raw: unknown): SlugDelta {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const add = cleanSlugList(obj.add);
  const addSet = new Set(add);
  const remove = cleanSlugList(obj.remove).filter((s) => !addSet.has(s));
  return { add, remove };
}

export function sanitizeOverlay(raw: unknown): SlugOverlay {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const overlay: SlugOverlay = {};
  for (const key of ATS_KEYS) {
    const delta = sanitizeDelta(obj[key]);
    if (delta.add.length || delta.remove.length) overlay[key] = delta;
  }
  return overlay;
}

// Reads config/slugs.local.json. Missing / unparseable → empty overlay (so a
// fresh clone with no personal overlay just uses the shipped lists).
export async function loadSlugOverlay(
  overlayPath: string = DEFAULT_SLUGS_LOCAL_PATH,
): Promise<SlugOverlay> {
  try {
    const raw = await readFile(overlayPath, 'utf8');
    return sanitizeOverlay(JSON.parse(raw));
  } catch {
    return {};
  }
}
