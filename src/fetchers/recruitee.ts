import slugs from '../../config/slugs.json' with { type: 'json' };
import { recruiteeBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawRecruiteeOffer, RawRecruiteeOfferWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

interface OffersResponse {
  offers?: RawRecruiteeOffer[];
}

export async function fetchRecruitee(): Promise<FetcherResult<RawRecruiteeOfferWithSlug>> {
  const slugList = resolveSlugs(slugs.recruitee, (await loadSlugOverlay()).recruitee);
  return fetchMultiSlug('recruitee', slugList, async (slug) => {
    const data = await fetchJson<OffersResponse>(recruiteeBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return (data.offers ?? []).map((o) => ({ ...o, __slug: slug }));
  });
}
