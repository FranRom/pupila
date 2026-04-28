import { fetchRssItems } from '../rss.js';
import type { RawRssItem } from '../types.js';

const ENDPOINT = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';

export async function fetchWeWorkRemotely(): Promise<RawRssItem[]> {
  try {
    return await fetchRssItems(ENDPOINT);
  } catch (err) {
    console.error('[weworkremotely] fetch failed:', (err as Error).message);
    return [];
  }
}
