// Live "does this slug exist / how many roles does it expose right now" probe,
// used by the Settings > Job sources panel when a user adds a company. Because
// 404 slugs are silently skipped at fetch time, a typo otherwise contributes
// zero jobs forever with no feedback — this gives the user a check/cross on add.
//
// Only the three public ATS are probeable. Ashby-private uses an unauthenticated
// GraphQL endpoint we intentionally don't replay here, so it reports unsupported.

import { fetchJson, JSON_HEADERS } from '../utils.js';
import { ashbyBoardUrl, greenhouseBoardUrl, leverBoardUrl } from './ats-endpoints.js';
import type { AtsKey } from './slugs.js';

export interface ProbeResult {
  supported: boolean;
  found: number;
}

const COUNTERS: Partial<Record<AtsKey, (slug: string) => Promise<number>>> = {
  ashby: async (slug) => {
    const data = await fetchJson<{ jobs?: unknown[] }>(ashbyBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return Array.isArray(data.jobs) ? data.jobs.length : 0;
  },
  greenhouse: async (slug) => {
    const data = await fetchJson<{ jobs?: unknown[] }>(greenhouseBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return Array.isArray(data.jobs) ? data.jobs.length : 0;
  },
  lever: async (slug) => {
    const data = await fetchJson<unknown[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    return Array.isArray(data) ? data.length : 0;
  },
};

export async function probeSlug(key: AtsKey, slug: string): Promise<ProbeResult> {
  const counter = COUNTERS[key];
  if (!counter) return { supported: false, found: 0 };
  try {
    return { supported: true, found: await counter(slug) };
  } catch {
    // 404 / network → treat as "found nothing" rather than erroring the panel.
    return { supported: true, found: 0 };
  }
}
