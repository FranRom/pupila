import type { RawRemoteOk } from '../types.js';
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

export async function fetchRemoteOk(): Promise<RawRemoteOk[]> {
  try {
    const data = await fetchJson<unknown[]>(ENDPOINT, { headers: JSON_HEADERS });
    if (!Array.isArray(data)) return [];
    const jobs = data.slice(1) as RawRemoteOk[];
    return jobs.filter((j) => {
      const tags = (j.tags ?? []).map((t) => t.toLowerCase());
      return tags.some((t) => ALLOWED_TAGS.has(t));
    });
  } catch (err) {
    console.error('[remoteok] fetch failed:', (err as Error).message);
    return [];
  }
}
