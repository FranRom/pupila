import type { FetcherResult, RawHnHit } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date?tags=job&hitsPerPage=100';

interface SearchResponse {
  hits: RawHnHit[];
}

export async function fetchHnJobs(): Promise<FetcherResult<RawHnHit>> {
  try {
    const data = await fetchJson<SearchResponse>(ENDPOINT, { headers: JSON_HEADERS });
    return { items: data.hits ?? [], errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[hn-jobs] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
