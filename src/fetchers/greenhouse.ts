import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawGreenhouseJob, RawGreenhouseJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

export const TIER_S_SLUGS: readonly string[] = slugs.greenhouse;

const board = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

interface BoardResponse {
  jobs: RawGreenhouseJob[];
  meta?: { total?: number };
}

export async function fetchGreenhouse(): Promise<FetcherResult<RawGreenhouseJobWithSlug>> {
  return fetchMultiSlug('greenhouse', TIER_S_SLUGS, async (slug) => {
    const data = await fetchJson<BoardResponse>(board(slug), { headers: JSON_HEADERS });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
