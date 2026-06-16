// Live board probe for the Settings > Job sources panel. Answers two things
// for a single ATS company slug, with NO dependency on an aggregator run:
//   - board HEALTH — does the board still exist? (`ok` | `not_found` | `error`)
//   - role COUNT   — how many postings the board currently exposes (pre-filter)
//
// `not_found` (HTTP 404) is the only actionable "remove this" signal — it means
// a typo'd slug or a company that left the ATS. `error` (timeout/5xx/network) is
// transient; `ok` with found:0 just means a healthy board with no open roles
// right now (keep it — they may post later). 404s are detected by reading
// res.status directly instead of fetchJson, which would collapse every non-2xx
// into a thrown Error.
//
// Only the three public REST ATS are probeable. Ashby-private uses an
// unauthenticated GraphQL endpoint we intentionally don't replay, so it reports
// unsupported and the UI shows no health/verify affordance for it.

import { fetchWithTimeout, JSON_HEADERS } from '../utils.js';
import { ashbyBoardUrl, greenhouseBoardUrl, leverBoardUrl } from './ats-endpoints.js';
import type { AtsKey } from './slugs.js';

export type ProbeState = 'ok' | 'not_found' | 'error';

export interface ProbeResult {
  supported: boolean;
  state: ProbeState;
  found: number;
}

interface Endpoint {
  url: (slug: string) => string;
  count: (data: unknown) => number;
}

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

const ENDPOINTS: Partial<Record<AtsKey, Endpoint>> = {
  ashby: { url: ashbyBoardUrl, count: (d) => arrayLen((d as { jobs?: unknown }).jobs) },
  greenhouse: { url: greenhouseBoardUrl, count: (d) => arrayLen((d as { jobs?: unknown }).jobs) },
  lever: { url: leverBoardUrl, count: (d) => arrayLen(d) },
};

export function isProbeSupported(key: AtsKey): boolean {
  return key in ENDPOINTS;
}

export async function probeSlug(key: AtsKey, slug: string): Promise<ProbeResult> {
  const endpoint = ENDPOINTS[key];
  if (!endpoint) return { supported: false, state: 'error', found: 0 };
  try {
    const res = await fetchWithTimeout(endpoint.url(slug), { headers: JSON_HEADERS });
    if (res.status === 404) return { supported: true, state: 'not_found', found: 0 };
    if (!res.ok) return { supported: true, state: 'error', found: 0 };
    const data = (await res.json()) as unknown;
    return { supported: true, state: 'ok', found: endpoint.count(data) };
  } catch {
    // timeout / network / non-JSON → transient, not "remove this".
    return { supported: true, state: 'error', found: 0 };
  }
}
