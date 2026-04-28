import type { RawHnHit } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date?tags=job&hitsPerPage=100';

interface SearchResponse {
  hits: RawHnHit[];
}

export async function fetchHnJobs(): Promise<RawHnHit[]> {
  try {
    const data = await fetchJson<SearchResponse>(ENDPOINT, { headers: JSON_HEADERS });
    return data.hits ?? [];
  } catch (err) {
    console.error('[hn-jobs] fetch failed:', (err as Error).message);
    return [];
  }
}
