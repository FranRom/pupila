import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawGreenhouseJob, RawGreenhouseJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_SLUGS: readonly string[] = slugs.greenhouse;

const board = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

interface BoardResponse {
  jobs: RawGreenhouseJob[];
  meta?: { total?: number };
}

async function fetchSlug(slug: string): Promise<FetcherResult<RawGreenhouseJobWithSlug>> {
  try {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    const jobs = data.jobs ?? [];
    return { items: jobs.map((j) => ({ ...j, __slug: slug })), errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[greenhouse:${slug}]`, message);
    return { items: [], errors: [`${slug}: ${message}`] };
  }
}

export async function fetchGreenhouse(): Promise<FetcherResult<RawGreenhouseJobWithSlug>> {
  const results = await Promise.all(TIER_S_SLUGS.map((slug) => fetchSlug(slug)));
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => r.errors),
  };
}
