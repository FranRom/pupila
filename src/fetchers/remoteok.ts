import type { FetcherResult, RawRemoteOk } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://remoteok.com/api';

// No tag pre-filter here — every other fetcher hands its full result set to
// the shared pipeline (`src/filters.ts`) and lets the candidate's own
// config-driven categories/titles decide what's relevant. This fetcher used
// to hard-code a 10-tag allowlist (crypto/web3/ai/ml/react/typescript/
// frontend/full-stack/fullstack) before anything reached that pipeline —
// live check confirmed RemoteOK's feed is broad and healthy (HR, marketing,
// ops roles alongside eng), but that allowlist threw away almost everything
// that didn't carry one of those exact tags, including roles that would
// have matched the candidate's real categories (saas, gaming, fintech,
// agent-adjacent titles without an "ai"/"ml" tag). Observed live: 11 kept
// of a feed that should be in the hundreds.
export async function fetchRemoteOk(): Promise<FetcherResult<RawRemoteOk>> {
  try {
    const data = await fetchJson<unknown[]>(ENDPOINT, { headers: JSON_HEADERS });
    if (!Array.isArray(data)) return { items: [], errors: ['response not an array'] };
    return { items: data.slice(1) as RawRemoteOk[], errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[remoteok] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
