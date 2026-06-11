import { fetchRssItems } from '../rss.js';
import type { FetcherResult, RawRemoteYeah } from '../types.js';

// RemoteYeah's single global feed (~300 most-recent postings, refreshed
// continuously). Category-specific feeds exist too, but the global feed is the
// persona-neutral choice — relevance is decided downstream by the filter.
const ENDPOINT = 'https://remoteyeah.com/rss.xml';

export async function fetchRemoteYeah(): Promise<FetcherResult<RawRemoteYeah>> {
  try {
    // The shared RSS parser keeps every child tag, so RemoteYeah's custom
    // <company>/<tags>/<location> elements survive — RawRemoteYeah just types them.
    const items = (await fetchRssItems(ENDPOINT)) as unknown as RawRemoteYeah[];
    return { items, errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[remoteyeah] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
