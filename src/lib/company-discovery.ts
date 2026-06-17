import { ATS_KEYS, type AtsKey, SLUG_PATTERN } from './slugs.js';

/** ATSes discovery can probe (REST/XML). Excludes ashbyPrivate (GraphQL). */
export const DISCOVERY_ATS_KEYS = [
  'ashby',
  'greenhouse',
  'lever',
  'recruitee',
  'personio',
] as const satisfies readonly AtsKey[];
export type DiscoveryAtsKey = (typeof DISCOVERY_ATS_KEYS)[number];

/** A company the LLM proposed. `ats`/`slug` are best-guesses; we verify both. */
export interface Candidate {
  name: string;
  ats?: AtsKey;
  slug?: string;
  why?: string;
}

function isAtsKey(v: unknown): v is AtsKey {
  return typeof v === 'string' && (ATS_KEYS as readonly string[]).includes(v);
}

export function parseCandidates(raw: string): Candidate[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as { companies?: unknown })?.companies ?? null);
  if (!Array.isArray(arr)) return [];

  const out: Candidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      ats: isAtsKey(o.ats) ? o.ats : undefined,
      slug: typeof o.slug === 'string' ? o.slug : undefined,
      why: typeof o.why === 'string' ? o.why : undefined,
    });
  }
  return out;
}

const MAX_VARIANTS = 4;

/** Ordered, deduped, SLUG_PATTERN-valid slug candidates for one company. */
export function resolveSlugVariants(name: string, slugGuess?: string): string[] {
  const base = name.toLowerCase().trim();
  const raw = [
    slugGuess?.toLowerCase().trim(),
    base.replace(/[^a-z0-9]+/g, ''), // "alephalpha"
    base.replace(/[^a-z0-9]+/g, '-'), // "aleph-alpha"
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (!v) continue;
    const s = v.replace(/^-+|-+$/g, '');
    if (s && SLUG_PATTERN.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.slice(0, MAX_VARIANTS);
}

export interface RoleScore {
  matchCount: number;
  sampleTitles: string[];
}

const SAMPLE_LIMIT = 4;

/** Build a case-insensitive matcher from keyword/regex-fragment strings. Empty → never matches. */
function compileKeywords(keywords: readonly string[]): RegExp | null {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return new RegExp(`(?:${cleaned.join('|')})`, 'i');
}

/**
 * Title-keyword relevance: count titles that match a positive keyword and are
 * NOT junior-excluded. `positiveKeywords` come from the profile's category
 * keyword arrays; `juniorKeywords` from `profile.keywords.junior`.
 */
export function scoreRoles(
  titles: readonly string[],
  positiveKeywords: readonly string[],
  juniorKeywords: readonly string[],
): RoleScore {
  const positive = compileKeywords(positiveKeywords);
  if (!positive) return { matchCount: 0, sampleTitles: [] };
  const junior = compileKeywords(juniorKeywords);
  const matched = titles.filter((t) => positive.test(t) && !(junior?.test(t) ?? false));
  return { matchCount: matched.length, sampleTitles: matched.slice(0, SAMPLE_LIMIT) };
}
