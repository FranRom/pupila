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
};

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
