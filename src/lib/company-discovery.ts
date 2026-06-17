import { ATS_KEYS, type AtsKey } from './slugs.js';

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
