import slugs from '../../config/slugs.json' with { type: 'json' };
import { greenhouseBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawGreenhouseJob, RawGreenhouseJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

interface BoardResponse {
  jobs: RawGreenhouseJob[];
  meta?: { total?: number };
}

export async function fetchGreenhouse(): Promise<FetcherResult<RawGreenhouseJobWithSlug>> {
  const slugList = resolveSlugs(slugs.greenhouse, (await loadSlugOverlay()).greenhouse);
  return fetchMultiSlug('greenhouse', slugList, async (slug) => {
    const data = await fetchJson<BoardResponse>(greenhouseBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
