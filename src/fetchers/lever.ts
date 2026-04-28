import slugs from '../../config/slugs.json' with { type: 'json' };
import type { FetcherResult, RawLeverJob, RawLeverJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_LEVER_SLUGS: readonly string[] = slugs.lever;

const board = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

async function fetchSlug(slug: string): Promise<FetcherResult<RawLeverJobWithSlug>> {
  try {
    const data = await fetchJson<RawLeverJob[]>(board(slug), { headers: JSON_HEADERS });
    if (!Array.isArray(data)) return { items: [], errors: [`${slug}: response not an array`] };
    return { items: data.map((j) => ({ ...j, __slug: slug })), errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[lever:${slug}]`, message);
    return { items: [], errors: [`${slug}: ${message}`] };
  }
}

export async function fetchLever(): Promise<FetcherResult<RawLeverJobWithSlug>> {
  const results = await Promise.all(TIER_S_LEVER_SLUGS.map((slug) => fetchSlug(slug)));
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => r.errors),
  };
}
