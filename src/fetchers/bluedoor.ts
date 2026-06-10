import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, LocationProfile, RawBluedoorJob } from '../types.js';
import { fetchJson, isSafeUrl, JSON_HEADERS } from '../utils.js';

/** Default 30-day discovery window — keeps infrequent runs from missing jobs. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Anonymous-tier request budget is 15/window; cap region queries below it. */
const DEFAULT_MAX_QUERIES = 12;

/** A single region search built from the candidate's location profile. */
export interface BluedoorQuery {
  location_text: string;
  /** ISO date (YYYY-MM-DD) — lower bound on `source_posted_at`. */
  posted_after: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fan out one `location_text` query per accepted region (plus `basedIn`),
 * deduped case-insensitively, each scoped to a `posted_after` window. No
 * `q`/`workplace_type` filter — work-type compatibility and role relevance are
 * decided downstream by the persona-neutral filter, which avoids dropping the
 * many bluedoor records whose `workplace_type` is null. Capped to the request
 * budget; the overflow count is returned so the caller can log it (no silent
 * truncation).
 */
export function buildBluedoorQueries(
  location: LocationProfile | undefined,
  opts: { now?: Date; lookbackDays?: number; maxQueries?: number } = {},
): { queries: BluedoorQuery[]; droppedRegions: number } {
  const {
    now = new Date(),
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    maxQueries = DEFAULT_MAX_QUERIES,
  } = opts;
  if (!location) return { queries: [], droppedRegions: 0 };

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...location.acceptedRegions, location.basedIn]) {
    const term = raw?.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }

  const postedAfter = isoDate(new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000));
  const kept = terms.slice(0, maxQueries);
  return {
    queries: kept.map((location_text) => ({ location_text, posted_after: postedAfter })),
    droppedRegions: terms.length - kept.length,
  };
}

/** A job's ATS provenance, recovered from its public URL. */
export interface AtsRef {
  provider: 'greenhouse' | 'lever' | 'ashby';
  /** The company slug as it appears in the ATS URL, lowercased. */
  slug: string;
}

// host suffix → provider; the company slug is always the first path segment.
const ATS_HOSTS: { suffix: string; provider: AtsRef['provider'] }[] = [
  { suffix: 'greenhouse.io', provider: 'greenhouse' },
  { suffix: 'lever.co', provider: 'lever' },
  { suffix: 'ashbyhq.com', provider: 'ashby' },
];

/** Per-provider set of company slugs already pulled by a dedicated fetcher. */
export type CoveredSlugs = Record<AtsRef['provider'], Set<string>>;

/** The shape of `config/slugs.json` (only the keys we map to ATS providers). */
interface SlugsConfig {
  ashby?: readonly string[];
  greenhouse?: readonly string[];
  lever?: readonly string[];
  /** ashby-private orgs live on jobs.ashbyhq.com → same provider as `ashby`. */
  ashbyPrivate?: readonly string[];
}

const lowerSet = (slugs: readonly string[] = []) => new Set(slugs.map((s) => s.toLowerCase()));

/** Build the covered-slug index from the parsed `config/slugs.json`. */
export function buildCoveredSlugs(config: SlugsConfig): CoveredSlugs {
  return {
    greenhouse: lowerSet(config.greenhouse),
    lever: lowerSet(config.lever),
    ashby: new Set([...lowerSet(config.ashby), ...lowerSet(config.ashbyPrivate)]),
  };
}

/**
 * True when a bluedoor job belongs to a company we already fetch directly — the
 * dedicated fetcher is authoritative, so we drop bluedoor's (often staler) copy
 * before it enters the pipeline. Catches the case plain company+title dedup
 * would miss: a covered company whose bluedoor title differs slightly.
 */
export function isCoveredCompany(ref: AtsRef | null, covered: CoveredSlugs): boolean {
  if (!ref) return false;
  return covered[ref.provider].has(ref.slug);
}

/**
 * Recover `{ provider, slug }` from a public ATS job URL — used both to derive a
 * human company name for bluedoor jobs (which ship none) and to skip companies
 * already covered by a dedicated fetcher. Returns null for non-ATS providers
 * (ADP, Taleo, Workday, …) whose URLs carry only opaque ids.
 */
export function parseAtsUrl(url: string | null | undefined): AtsRef | null {
  if (!url || !isSafeUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const match = ATS_HOSTS.find((h) => host === h.suffix || host.endsWith(`.${h.suffix}`));
  if (!match) return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!slug) return null;
  return { provider: match.provider, slug };
}

const SEARCH_URL = 'https://api.bluedoor.sh/job-postings/v1/jobs/search';
const PAGE_SIZE = 100; // API max
const DEFAULT_PAGE_CAP = 2; // pages per region; depth-2 only kicks in past 100
// Anonymous tier allows 15 requests/window — stay under it with headroom for the
// HTTP wrapper's retry. An API key lifts the ceiling.
const ANON_MAX_REQUESTS = 12;
const KEYED_MAX_REQUESTS = 60;

interface SearchResponse {
  data?: RawBluedoorJob[];
  meta?: { next_cursor?: string | null };
}

export interface FetchBluedoorOptions {
  now?: Date;
  lookbackDays?: number;
  maxRequests?: number;
  pageCap?: number;
  apiKey?: string;
}

/**
 * Fetch region-relevant jobs from the bluedoor aggregator, driven entirely by
 * the candidate's `location` profile (no hardcoded regions). Fans out one
 * `location_text` query per accepted region, paginates within a shared request
 * budget, drops companies already covered by a dedicated fetcher, and dedups by
 * `job_id`. Never throws — every failure is caught and reported in `errors`.
 */
export async function fetchBluedoor(
  location: LocationProfile | undefined,
  opts: FetchBluedoorOptions = {},
): Promise<FetcherResult<RawBluedoorJob>> {
  const apiKey = opts.apiKey ?? process.env.BLUEDOOR_API_KEY;
  const maxRequests = opts.maxRequests ?? (apiKey ? KEYED_MAX_REQUESTS : ANON_MAX_REQUESTS);
  const pageCap = opts.pageCap ?? DEFAULT_PAGE_CAP;
  const errors: string[] = [];

  const { queries, droppedRegions } = buildBluedoorQueries(location, {
    now: opts.now,
    lookbackDays: opts.lookbackDays,
    maxQueries: maxRequests,
  });
  if (queries.length === 0) {
    return { items: [], errors }; // no location config → nothing to ask for
  }
  if (droppedRegions > 0) {
    errors.push(
      `request budget (${maxRequests}) below region count — skipped ${droppedRegions} region(s)`,
    );
  }

  const covered = buildCoveredSlugs(slugs);
  const headers = apiKey ? { ...JSON_HEADERS, 'x-api-key': apiKey } : JSON_HEADERS;
  const byId = new Map<string, RawBluedoorJob>();
  let requests = 0;

  for (const query of queries) {
    let cursor: string | null = null;
    for (let page = 0; page < pageCap && requests < maxRequests; page++) {
      const params = new URLSearchParams({
        location_text: query.location_text,
        posted_after: query.posted_after,
        include: 'description',
        limit: String(PAGE_SIZE),
      });
      if (cursor) params.set('cursor', cursor);
      requests++;
      try {
        const res = await fetchJson<SearchResponse>(`${SEARCH_URL}?${params}`, { headers });
        for (const job of res.data ?? []) {
          if (!job?.job_id) continue;
          if (isCoveredCompany(parseAtsUrl(job.apply_url ?? job.source_url), covered)) continue;
          byId.set(job.job_id, job);
        }
        cursor = res.meta?.next_cursor ?? null;
        if (!cursor) break;
      } catch (err) {
        errors.push(`${query.location_text} (page ${page + 1}): ${(err as Error).message}`);
        break; // move on to the next region
      }
    }
    if (requests >= maxRequests) break;
  }

  return { items: Array.from(byId.values()), errors };
}
