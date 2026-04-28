import { fetchRssItems } from '../rss.js';
import type { FetcherResult, RawRssItem } from '../types.js';

const ENDPOINT = 'https://api.cryptojobslist.com/jobs.rss';

export async function fetchCryptoJobsList(): Promise<FetcherResult<RawRssItem>> {
  try {
    const items = await fetchRssItems(ENDPOINT);
    return { items, errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[cryptojobslist] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
