import { parseXml } from '../rss.js';
import { fetchJson, fetchText, JSON_HEADERS, RSS_HEADERS } from '../utils.js';
import {
  ashbyBoardUrl,
  greenhouseBoardUrl,
  leverBoardUrl,
  personioBoardUrl,
  recruiteeBoardUrl,
} from './ats-endpoints.js';
import { runLlm } from './llm.js';
import { ATS_KEYS, type AtsKey, SLUG_PATTERN } from './slugs.js';
import { type ProbeResult, probeSlug } from './source-probe.js';

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

interface JobsBody {
  jobs?: { title?: string }[];
}
interface PersonioRoot {
  'workzag-jobs'?: { position?: { name?: string } | { name?: string }[] } | null;
}

const clean = (arr: (string | undefined)[]): string[] =>
  arr.map((s) => (s ?? '').trim()).filter(Boolean);

/** Fetch one board and return its role titles. Throws on network/parse error. */
export async function fetchBoardTitles(ats: DiscoveryAtsKey, slug: string): Promise<string[]> {
  if (ats === 'personio') {
    const xml = await fetchText(personioBoardUrl(slug), { headers: RSS_HEADERS });
    const pos = (parseXml(xml) as PersonioRoot)['workzag-jobs']?.position;
    const list = pos ? (Array.isArray(pos) ? pos : [pos]) : [];
    return clean(list.map((p) => p?.name));
  }
  if (ats === 'recruitee') {
    const d = await fetchJson<{ offers?: { title?: string }[] }>(recruiteeBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return clean((d.offers ?? []).map((o) => o.title));
  }
  if (ats === 'lever') {
    const d = await fetchJson<{ text?: string }[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    return clean((Array.isArray(d) ? d : []).map((j) => j.text));
  }
  const url = ats === 'greenhouse' ? greenhouseBoardUrl(slug) : ashbyBoardUrl(slug);
  const d = await fetchJson<JobsBody>(url, { headers: JSON_HEADERS });
  return clean((d.jobs ?? []).map((j) => j.title));
}

/** Minimal shape of the profile fields discovery reads (subset of FilterProfile). */
export interface DiscoveryProfile {
  categories?: readonly { id: string; label?: string; keywords: readonly string[] }[];
  keywords?: { junior?: readonly string[]; engineering?: readonly string[] } & Record<
    string,
    readonly string[] | undefined
  >;
}

export type CuratedSlugs = Record<DiscoveryAtsKey, readonly string[]>;

export function buildDiscoveryPrompt(
  profile: DiscoveryProfile,
  brief: string,
  curated: CuratedSlugs,
): string {
  const cats = (profile.categories ?? [])
    .map((c) => c.label ?? c.id)
    .filter(Boolean)
    .join(', ');
  const excluded = DISCOVERY_ATS_KEYS.flatMap((k) => curated[k] ?? []).join(', ');
  return [
    'You are helping a job-seeker find more companies to track on public ATS job boards.',
    `Supported ATS platforms (only suggest companies on these): ${DISCOVERY_ATS_KEYS.join(', ')}.`,
    '',
    'Candidate brief:',
    brief.trim() || '(no brief provided)',
    '',
    cats ? `Target role categories: ${cats}.` : '',
    '',
    `Already tracked (DO NOT suggest these): ${excluded || '(none)'}.`,
    '',
    'Suggest up to 25 real companies that actively hire for the target roles and host',
    'their jobs on one of the supported ATS platforms. Prefer companies building with AI.',
    '',
    'Return STRICT JSON only — an array, no prose, no markdown fences:',
    '[{"name": "Company", "ats": "ashby|greenhouse|lever|recruitee|personio", "slug": "best-guess-slug", "why": "one short reason"}]',
    'The "ats" and "slug" are best guesses; they will be verified, so include them when unsure.',
  ].join('\n');
}

const MAX_CANDIDATES = 25;

export interface Suggestion {
  name: string;
  ats: DiscoveryAtsKey;
  slug: string;
  matchCount: number;
  totalRoles: number;
  sampleTitles: string[];
  why?: string;
}

export interface DiscoverResult {
  suggestions: Suggestion[];
  proposed: number;
  verified: number;
  errors: string[];
}

export interface DiscoverOptions {
  profile: DiscoveryProfile;
  brief: string;
  curated: CuratedSlugs;
  // Injectable for tests; default to the real implementations.
  runLlm?: (prompt: string) => Promise<string>;
  probe?: (ats: DiscoveryAtsKey, slug: string) => Promise<ProbeResult>;
  fetchTitles?: (ats: DiscoveryAtsKey, slug: string) => Promise<string[]>;
}

function positiveKeywords(p: DiscoveryProfile): string[] {
  const cat = (p.categories ?? []).flatMap((c) => [...c.keywords]);
  return cat.length ? cat : [...(p.keywords?.engineering ?? [])];
}

export async function discoverCompanies(opts: DiscoverOptions): Promise<DiscoverResult> {
  const runLlmFn = opts.runLlm ?? runLlm;
  const probeFn = opts.probe ?? probeSlug;
  const fetchTitlesFn = opts.fetchTitles ?? fetchBoardTitles;
  const errors: string[] = [];

  let candidates: Candidate[];
  try {
    const raw = await runLlmFn(buildDiscoveryPrompt(opts.profile, opts.brief, opts.curated));
    candidates = parseCandidates(raw).slice(0, MAX_CANDIDATES);
  } catch (err) {
    return { suggestions: [], proposed: 0, verified: 0, errors: [(err as Error).message] };
  }

  const posKw = positiveKeywords(opts.profile);
  const juniorKw = [...(opts.profile.keywords?.junior ?? [])];
  const isCurated = (ats: DiscoveryAtsKey, slug: string) =>
    (opts.curated[ats] ?? []).includes(slug);

  const settled = await Promise.all(
    candidates.map(async (c): Promise<Suggestion | null> => {
      try {
        const variants = resolveSlugVariants(c.name, c.slug);
        // If any variant is already curated on any ATS, skip the whole candidate.
        if (variants.some((slug) => DISCOVERY_ATS_KEYS.some((ats) => isCurated(ats, slug)))) {
          return null;
        }
        const order: DiscoveryAtsKey[] =
          c.ats && (DISCOVERY_ATS_KEYS as readonly string[]).includes(c.ats)
            ? [c.ats as DiscoveryAtsKey, ...DISCOVERY_ATS_KEYS.filter((k) => k !== c.ats)]
            : [...DISCOVERY_ATS_KEYS];
        for (const ats of order) {
          for (const slug of variants) {
            const res = await probeFn(ats, slug);
            if (res.state === 'ok' && res.found > 0) {
              const titles = await fetchTitlesFn(ats, slug);
              const score = scoreRoles(titles, posKw, juniorKw);
              return {
                name: c.name,
                ats,
                slug,
                matchCount: score.matchCount,
                totalRoles: titles.length,
                sampleTitles: score.sampleTitles,
                why: c.why,
              };
            }
          }
        }
        return null;
      } catch (err) {
        errors.push(`${c.name}: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  const suggestions = settled
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.matchCount - a.matchCount);
  return { suggestions, proposed: candidates.length, verified: suggestions.length, errors };
}
