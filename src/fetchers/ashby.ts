import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawAshbyJob, RawAshbyJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

export const TIER_S_ASHBY_SLUGS: readonly string[] = slugs.ashby;

const board = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

interface BoardResponse {
  jobs: RawAshbyJob[];
  apiVersion?: string;
}

export async function fetchAshby(): Promise<FetcherResult<RawAshbyJobWithSlug>> {
  return fetchMultiSlug('ashby', TIER_S_ASHBY_SLUGS, async (slug) => {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
