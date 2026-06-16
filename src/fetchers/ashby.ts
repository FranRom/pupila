import slugs from '../../config/slugs.json' with { type: 'json' };
import { ashbyBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawAshbyJob, RawAshbyJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

interface BoardResponse {
  jobs: RawAshbyJob[];
  apiVersion?: string;
}

export async function fetchAshby(): Promise<FetcherResult<RawAshbyJobWithSlug>> {
  const slugList = resolveSlugs(slugs.ashby, (await loadSlugOverlay()).ashby);
  return fetchMultiSlug('ashby', slugList, async (slug) => {
    const data = await fetchJson<BoardResponse>(ashbyBoardUrl(slug), { headers: JSON_HEADERS });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
