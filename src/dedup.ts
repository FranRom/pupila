import type { Job, Source } from './types.js';
import { normalizeText, sha1Hex } from './utils.js';

const SOURCE_PRIORITY: Record<Source, number> = {
  aave: 14,
  'ashby-private': 14,
  ashby: 13,
  lever: 12,
  greenhouse: 11,
  // Recruitee and Personio are public curated ATSes (per-company boards), so
  // they rank in the ATS tier above the niche boards and every aggregator.
  // Personio sits just under Recruitee (it ships no salary and no native URL).
  recruitee: 10,
  personio: 9,
  cryptojobslist: 8,
  web3career: 7,
  aijobsnet: 6,
  'hn-hiring': 5,
  'hn-jobs': 4,
  remotive: 3,
  weworkremotely: 2,
  remoteok: 1,
  // Aggregators sit at the bottom: they re-carry jobs the dedicated fetchers
  // already pull, so on any company+title overlap the curated copy must win.
  // jobicy, himalayas and remoteyeah rank above bluedoor but below every
  // dedicated source — their links point at their own sites (not the underlying
  // ATS), so they can't pre-skip already-covered companies and dedup by
  // company+title only.
  jobicy: 0,
  himalayas: -1,
  remoteyeah: -2,
  // Lowest priority: bluedoor's unique long-tail (providers we can't reach
  // directly) survives, but any overlap loses to a more-specific source.
  bluedoor: -3,
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
