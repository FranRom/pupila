// Live board probe for the Settings > Job sources panel. Answers two things
// for a single ATS company slug, with NO dependency on an aggregator run:
//   - board HEALTH - does the board still exist? (`ok` | `not_found` | `error`)
//   - role COUNT   - how many postings the board currently exposes (pre-filter)
//
// `not_found` is the only actionable "remove this" signal - a typo'd slug or a
// company that left the ATS. `error` (timeout/5xx/network) is transient; `ok`
// with found:0 just means a healthy board with no open roles right now (keep
// it - they may post later).
//
// The three public REST ATS detect not_found via HTTP 404. Ashby-private uses
// the same unauthenticated GraphQL as the public job-board page: a missing org
// comes back as HTTP 200 with `jobBoard: null` (no 404), so we key not_found off
// that instead.

import { fetchWithTimeout, JSON_HEADERS } from '../utils.js';
import {
  ashbyBoardUrl,
  greenhouseBoardUrl,
  leverBoardUrl,
  recruiteeBoardUrl,
} from './ats-endpoints.js';
import type { AtsKey } from './slugs.js';

export type ProbeState = 'ok' | 'not_found' | 'error';

export interface ProbeResult {
  supported: boolean;
  state: ProbeState;
  found: number;
}

type Outcome = { state: ProbeState; found: number };
type Prober = (slug: string) => Promise<Outcome>;

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

// REST probe: 404 → not_found, other non-2xx → error, else count from the body.
async function restProbe(url: string, count: (data: unknown) => number): Promise<Outcome> {
  const res = await fetchWithTimeout(url, { headers: JSON_HEADERS });
  if (res.status === 404) return { state: 'not_found', found: 0 };
  if (!res.ok) return { state: 'error', found: 0 };
  const data = (await res.json()) as unknown;
  return { state: 'ok', found: count(data) };
}

// Mirrors the list query in src/fetchers/ashby-private.ts (kept minimal - we
// only need the posting count, not the per-job detail the fetcher pulls).
const ASHBY_PRIVATE_GRAPHQL_URL =
  'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams';
const ASHBY_PRIVATE_LIST_QUERY =
  'query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {' +
  ' jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {' +
  ' jobPostings { id } } }';

async function ashbyPrivateProbe(slug: string): Promise<Outcome> {
  const res = await fetchWithTimeout(ASHBY_PRIVATE_GRAPHQL_URL, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'ApiJobBoardWithTeams',
      query: ASHBY_PRIVATE_LIST_QUERY,
      variables: { organizationHostedJobsPageName: slug },
    }),
  });
  if (!res.ok) return { state: 'error', found: 0 };
  const data = (await res.json()) as {
    data?: { jobBoard?: { jobPostings?: unknown } | null };
  };
  const board = data.data?.jobBoard;
  // A missing org comes back as jobBoard: null with HTTP 200 - treat as not_found.
  if (!board) return { state: 'not_found', found: 0 };
  return { state: 'ok', found: arrayLen(board.jobPostings) };
}

const PROBERS: Partial<Record<AtsKey, Prober>> = {
  ashby: (slug) => restProbe(ashbyBoardUrl(slug), (d) => arrayLen((d as { jobs?: unknown }).jobs)),
  greenhouse: (slug) =>
    restProbe(greenhouseBoardUrl(slug), (d) => arrayLen((d as { jobs?: unknown }).jobs)),
  lever: (slug) => restProbe(leverBoardUrl(slug), (d) => arrayLen(d)),
  ashbyPrivate: (slug) => ashbyPrivateProbe(slug),
  recruitee: (slug) =>
    restProbe(recruiteeBoardUrl(slug), (d) => arrayLen((d as { offers?: unknown }).offers)),
};

export function isProbeSupported(key: AtsKey): boolean {
  return key in PROBERS;
}

export async function probeSlug(key: AtsKey, slug: string): Promise<ProbeResult> {
  const prober = PROBERS[key];
  if (!prober) return { supported: false, state: 'error', found: 0 };
  try {
    return { supported: true, ...(await prober(slug)) };
  } catch {
    // timeout / network / non-JSON → transient, not "remove this".
    return { supported: true, state: 'error', found: 0 };
  }
}
