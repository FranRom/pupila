import type { FetcherResult, RawWorkingNomads } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

// Working Nomads publishes its whole live board as one unauthenticated JSON
// array — no key, no pagination, no cursor. The endpoint name ("exposed_jobs")
// is theirs; it is the feed they point integrators at. One call per run is well
// inside anything reasonable for a daily cron.
//
// Why this source earns its place: its `location` field carries multi-region
// strings such as "Europe, North America, Latin America, APAC" and "Global",
// which is exactly the eligibility signal the geo filter needs. Most boards
// collapse that to a bare "Remote".
const ENDPOINT = 'https://www.workingnomads.com/api/exposed_jobs/';

export async function fetchWorkingNomads(): Promise<FetcherResult<RawWorkingNomads>> {
  try {
    // The response is a bare array, not an object with a `jobs` key.
    const data = await fetchJson<RawWorkingNomads[]>(ENDPOINT, { headers: JSON_HEADERS });
    return { items: Array.isArray(data) ? data : [], errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[workingnomads] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
