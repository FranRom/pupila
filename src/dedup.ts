import type { Job, Source } from './types.js';
import { normalizeText, sha1Hex } from './utils.js';

const SOURCE_PRIORITY: Record<Source, number> = {
  aave: 12,
  'ashby-private': 12,
  ashby: 11,
  lever: 10,
  greenhouse: 9,
  cryptojobslist: 8,
  web3career: 7,
  aijobsnet: 6,
  'hn-hiring': 5,
  'hn-jobs': 4,
  remotive: 3,
  weworkremotely: 2,
  remoteok: 1,
  // Lowest priority: bluedoor re-carries many curated-ATS jobs, so on any
  // company+title overlap the dedicated fetcher's copy must win. bluedoor's
  // unique long-tail (providers we can't reach directly) survives.
  bluedoor: 0,
};

// Comparator for the post-dedup orchestrator sort. Order:
//   1. fitScore desc (primary)
//   2. salaryMax desc (transparent-comp companies float up among ties)
//   3. postedAt desc (newest first)
//   4. id asc (deterministic tie-breaker for day-over-day diffs)
// salaryMax null is treated as 0 so unstated comp sinks below stated comp.
export function compareJobs(a: Job, b: Job): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  const sa = a.salaryMax ?? 0;
  const sb = b.salaryMax ?? 0;
  if (sb !== sa) return sb - sa;
  const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
  const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
  if (tb !== ta) return tb - ta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickWinner(a: Job, b: Job): Job {
  if (b.fitScore > a.fitScore) return b;
  if (b.fitScore < a.fitScore) return a;
  return SOURCE_PRIORITY[b.source] > SOURCE_PRIORITY[a.source] ? b : a;
}

function companyTitleKey(j: Job): string {
  return sha1Hex(`${normalizeText(j.company ?? '')}|${normalizeText(j.title)}`);
}

export interface DedupResult {
  kept: Job[];
  removedById: number;
  removedByTitle: number;
}

export function dedupe(jobs: Job[]): DedupResult {
  const byId = new Map<string, Job>();
  for (const j of jobs) {
    const existing = byId.get(j.id);
    byId.set(j.id, existing ? pickWinner(existing, j) : j);
  }
  const removedById = jobs.length - byId.size;

  const byKey = new Map<string, Job>();
  for (const j of byId.values()) {
    const key = companyTitleKey(j);
    const existing = byKey.get(key);
    byKey.set(key, existing ? pickWinner(existing, j) : j);
  }
  const removedByTitle = byId.size - byKey.size;

  return {
    kept: Array.from(byKey.values()),
    removedById,
    removedByTitle,
  };
}
