import type { RawRemotive } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://remotive.com/api/remote-jobs?category=software-dev';

interface RemotiveResponse {
  jobs: RawRemotive[];
  'job-count'?: number;
}

export async function fetchRemotive(): Promise<RawRemotive[]> {
  try {
    const data = await fetchJson<RemotiveResponse>(ENDPOINT, { headers: JSON_HEADERS });
    return Array.isArray(data?.jobs) ? data.jobs : [];
  } catch (err) {
    console.error('[remotive] fetch failed:', (err as Error).message);
    return [];
  }
}
