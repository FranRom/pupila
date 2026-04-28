import type { RawLeverJob, RawLeverJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_LEVER_SLUGS = [
  'ledger',
  'binance',
  'coingecko',
  'coinmarketcap',
  'safe',
  'arbitrumfoundation',
] as const;

const board = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

async function fetchSlug(slug: string): Promise<RawLeverJobWithSlug[]> {
  try {
    const data = await fetchJson<RawLeverJob[]>(board(slug), { headers: JSON_HEADERS });
    if (!Array.isArray(data)) return [];
    return data.map((j) => ({ ...j, __slug: slug }));
  } catch (err) {
    console.error(`[lever:${slug}]`, (err as Error).message);
    return [];
  }
}

export async function fetchLever(): Promise<RawLeverJobWithSlug[]> {
  const results = await Promise.all(TIER_S_LEVER_SLUGS.map((slug) => fetchSlug(slug)));
  return results.flat();
}
