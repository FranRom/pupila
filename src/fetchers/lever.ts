import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawLeverJob, RawLeverJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

export const TIER_S_LEVER_SLUGS: readonly string[] = slugs.lever;

const board = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

export async function fetchLever(): Promise<FetcherResult<RawLeverJobWithSlug>> {
  return fetchMultiSlug('lever', TIER_S_LEVER_SLUGS, async (slug) => {
    const data = await fetchJson<RawLeverJob[]>(board(slug), { headers: JSON_HEADERS });
    if (!Array.isArray(data)) throw new Error('response not an array');
    return data.map((j) => ({ ...j, __slug: slug }));
  });
}
