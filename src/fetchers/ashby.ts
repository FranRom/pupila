import slugs from '../../config/slugs.json' with { type: 'json' };
import type { RawAshbyJob, RawAshbyJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_ASHBY_SLUGS: readonly string[] = slugs.ashby;

const board = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

interface BoardResponse {
  jobs: RawAshbyJob[];
  apiVersion?: string;
}

async function fetchSlug(slug: string): Promise<RawAshbyJobWithSlug[]> {
  try {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    const jobs = data.jobs ?? [];
    return jobs.map((j) => ({ ...j, __slug: slug }));
  } catch (err) {
    console.error(`[ashby:${slug}]`, (err as Error).message);
    return [];
  }
}

export async function fetchAshby(): Promise<RawAshbyJobWithSlug[]> {
  const results = await Promise.all(TIER_S_ASHBY_SLUGS.map((slug) => fetchSlug(slug)));
  return results.flat();
}
