import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawAshbyJob, RawAshbyJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_ASHBY_SLUGS: readonly string[] = slugs.ashby;

const board = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

interface BoardResponse {
  jobs: RawAshbyJob[];
  apiVersion?: string;
}

async function fetchSlug(slug: string): Promise<FetcherResult<RawAshbyJobWithSlug>> {
  try {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    const jobs = data.jobs ?? [];
    return { items: jobs.map((j) => ({ ...j, __slug: slug })), errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[ashby:${slug}]`, message);
    return { items: [], errors: [`${slug}: ${message}`] };
  }
}

export async function fetchAshby(): Promise<FetcherResult<RawAshbyJobWithSlug>> {
  const results = await Promise.all(TIER_S_ASHBY_SLUGS.map((slug) => fetchSlug(slug)));
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => r.errors),
  };
}
