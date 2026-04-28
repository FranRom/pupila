import type { FetcherResult, RawRemoteOk } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ENDPOINT = 'https://remoteok.com/api';

const ALLOWED_TAGS = new Set([
  'crypto',
  'web3',
  'blockchain',
  'ai',
  'ml',
  'react',
  'typescript',
  'frontend',
  'full-stack',
  'fullstack',
]);

export async function fetchRemoteOk(): Promise<FetcherResult<RawRemoteOk>> {
  try {
    const data = await fetchJson<unknown[]>(ENDPOINT, { headers: JSON_HEADERS });
    if (!Array.isArray(data)) return { items: [], errors: ['response not an array'] };
    const jobs = data.slice(1) as RawRemoteOk[];
    const items = jobs.filter((j) => {
      const tags = (j.tags ?? []).map((t) => t.toLowerCase());
      return tags.some((t) => ALLOWED_TAGS.has(t));
    });
    return { items, errors: [] };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[remoteok] fetch failed:', message);
    return { items: [], errors: [message] };
  }
}
