import { fetchRssItems } from '../rss.js';
import type { FetcherResult, RawRssItem } from '../types.js';

const ENDPOINT = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';

export async function fetchWeWorkRemotely(): Promise<FetcherResult<RawRssItem>> {
  try {
    const items = await fetchRssItems(ENDPOINT);
    return { items, errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[weworkremotely] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
