import { fetchRssItems } from '../rss.js';
import type { RawRssItem } from '../types.js';

const ENDPOINT = 'https://ai-jobs.net/feed/';

export async function fetchAiJobsNet(): Promise<RawRssItem[]> {
  try {
    return await fetchRssItems(ENDPOINT);
  } catch (err) {
    console.error('[aijobsnet] fetch failed:', (err as Error).message);
    return [];
  }
}
