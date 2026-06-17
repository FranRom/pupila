import type { FetcherResult, RawHimalayas } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://himalayas.app/jobs/api';
// The API hard-caps each response at 20 rows regardless of the requested
// `limit`, so coverage comes from paging via `offset`. The feed is sorted
// newest-first over ~90k listings; cap at a recent window rather than draining
// it. Each page is one HTTP request — keep the cap modest for a daily run.
const PAGE_SIZE = 20;
const DEFAULT_PAGE_CAP = 8; // ~160 most-recent jobs

export interface FetchHimalayasOptions {
  pageCap?: number;
}

interface HimalayasResponse {
  jobs?: RawHimalayas[];
  totalCount?: number;
}

/**
 * Fetch the most-recent remote jobs from Himalayas, paging via `offset` within a
 * page budget (the API returns at most 20 rows per request). No key. Dedups by
 * `guid`, stops early on a short/empty page, and never throws — every failure is
 * caught and reported in `errors`.
 */
export async function fetchHimalayas(
  opts: FetchHimalayasOptions = {},
): Promise<FetcherResult<RawHimalayas>> {
  const pageCap = opts.pageCap ?? DEFAULT_PAGE_CAP;
  const errors: string[] = [];
  const byGuid = new Map<string, RawHimalayas>();

  for (let page = 0; page < pageCap; page++) {
    const offset = page * PAGE_SIZE;
    const url = `${ENDPOINT}?limit=${PAGE_SIZE}&offset=${offset}`;
    try {
      const res = await fetchJson<HimalayasResponse>(url, { headers: JSON_HEADERS });
      const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
      for (const job of jobs) {
        const key = job?.guid || job?.applicationLink;
        if (!key) continue;
        byGuid.set(key, job);
      }
      if (jobs.length < PAGE_SIZE) break; // reached the end of the feed
    } catch (err) {
      errors.push(`offset ${offset}: ${(err as Error).message}`);
      break; // stop paging on the first failure; keep what we have
    }
  }

  return { items: Array.from(byGuid.values()), errors };
}
