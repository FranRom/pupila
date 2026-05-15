// Shared resolver for the applied-mutator tools. Each accepts `url` OR
// `jobId` and we need to land on a canonical URL string before reading or
// writing `config/applied.json`.

import type { Job } from '../../types.js';
import { normalizeUrl, readJsonOrNull } from '../../utils.js';

export interface JobIdentifier {
  url?: string;
  jobId?: string;
}

export interface ResolveResult {
  url: string | null;
  reason: 'ok' | 'no-identifier' | 'jobid-not-found' | 'invalid-url';
}

export async function resolveAppliedUrl(
  input: JobIdentifier,
  jobsPath: string,
): Promise<ResolveResult> {
  if (input.url) {
    const normalized = normalizeUrl(input.url);
    if (!normalized) return { url: null, reason: 'invalid-url' };
    return { url: normalized, reason: 'ok' };
  }
  if (input.jobId) {
    const jobs = (await readJsonOrNull<Job[]>(jobsPath)) ?? [];
    const job = jobs.find((j) => j.id === input.jobId);
    if (!job) return { url: null, reason: 'jobid-not-found' };
    const normalized = normalizeUrl(job.url);
    return normalized ? { url: normalized, reason: 'ok' } : { url: null, reason: 'invalid-url' };
  }
  return { url: null, reason: 'no-identifier' };
}
