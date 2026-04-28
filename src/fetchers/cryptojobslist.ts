import { fetchRssItems } from '../rss.js';
import type { RawRssItem } from '../types.js';

const ENDPOINT = 'https://api.cryptojobslist.com/jobs.rss';

export async function fetchCryptoJobsList(): Promise<RawRssItem[]> {
  try {
    return await fetchRssItems(ENDPOINT);
  } catch (err) {
    console.error('[cryptojobslist] fetch failed:', (err as Error).message);
    return [];
  }
}
