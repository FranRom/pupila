import type { FetcherResult, RawJobicy } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

// Jobicy's public v2 feed returns the latest remote postings in one shot — no
// key, no pagination (the `count` param caps at 100). Its `friendlyNotice` asks
// integrators to credit Jobicy, redirect users to jobicy.com to apply (we keep
// the job's `jobicy.com/jobs/...` URL, so that holds), and fetch only a few
// times per day. The daily launchd/cron run sits well inside that.
const ENDPOINT = 'https://jobicy.com/api/v2/remote-jobs?count=100';

interface JobicyResponse {
  jobs?: RawJobicy[];
  jobCount?: number;
}

export async function fetchJobicy(): Promise<FetcherResult<RawJobicy>> {
  try {
    const data = await fetchJson<JobicyResponse>(ENDPOINT, { headers: JSON_HEADERS });
    return { items: Array.isArray(data?.jobs) ? data.jobs : [], errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[jobicy] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
