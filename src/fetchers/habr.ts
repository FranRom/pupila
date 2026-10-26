import { fetchRssItems } from '../rss.js';
import type { FetcherResult, RawRssItem } from '../types.js';

// Habr Career (career.habr.com) — the main Russian-language IT job board.
// No public JSON API (and hh.ru's vacancy search now 403s anonymous clients),
// but the vacancy RSS is open and supports the remote filter. The feed returns
// the 50 most recent remote postings across all professions; non-engineering
// roles are dropped downstream by the hard filters like every other source.
const ENDPOINT = 'https://career.habr.com/vacancies/rss?type=all&remote=true';

export async function fetchHabr(): Promise<FetcherResult<RawRssItem>> {
  try {
    const items = await fetchRssItems(ENDPOINT);
    return { items, errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[habr] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
