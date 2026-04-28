import type { FetcherResult, RawRemotive } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://remotive.com/api/remote-jobs?category=software-dev';

interface RemotiveResponse {
  jobs: RawRemotive[];
  'job-count'?: number;
}

export async function fetchRemotive(): Promise<FetcherResult<RawRemotive>> {
  try {
    const data = await fetchJson<RemotiveResponse>(ENDPOINT, { headers: JSON_HEADERS });
    return { items: Array.isArray(data?.jobs) ? data.jobs : [], errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[remotive] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
