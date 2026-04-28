import { fetchRssItems } from '../rss.js';
import type { RawRssItem } from '../types.js';

const PRIMARY = 'https://web3.career/feed';
const FALLBACK = 'https://web3.career/jobs.rss';

export async function fetchWeb3Career(): Promise<RawRssItem[]> {
  for (const url of [PRIMARY, FALLBACK]) {
    try {
      const items = await fetchRssItems(url);
      if (items.length > 0) return items;
    } catch (err) {
      console.error(`[web3career] ${url} failed:`, (err as Error).message);
    }
  }
  return [];
}
