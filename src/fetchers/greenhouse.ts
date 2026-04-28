import slugs from '../../config/slugs.json' with { type: 'json' };
import type { RawGreenhouseJob, RawGreenhouseJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_SLUGS: readonly string[] = slugs.greenhouse;

const board = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

interface BoardResponse {
  jobs: RawGreenhouseJob[];
  meta?: { total?: number };
}

async function fetchSlug(slug: string): Promise<RawGreenhouseJobWithSlug[]> {
  try {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    const jobs = data.jobs ?? [];
    return jobs.map((j) => ({ ...j, __slug: slug }));
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[greenhouse:${slug}]`, msg);
    return [];
  }
}

export async function fetchGreenhouse(): Promise<RawGreenhouseJobWithSlug[]> {
  const results = await Promise.all(TIER_S_SLUGS.map((slug) => fetchSlug(slug)));
  return results.flat();
}
