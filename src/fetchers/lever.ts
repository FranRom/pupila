import slugs from '../../config/slugs.json' with { type: 'json' };
import { leverBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawLeverJob, RawLeverJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

export async function fetchLever(): Promise<FetcherResult<RawLeverJobWithSlug>> {
  const slugList = resolveSlugs(slugs.lever, (await loadSlugOverlay()).lever);
  return fetchMultiSlug('lever', slugList, async (slug) => {
    const data = await fetchJson<RawLeverJob[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    if (!Array.isArray(data)) throw new Error('response not an array');
    return data.map((j) => ({ ...j, __slug: slug }));
  });
}
