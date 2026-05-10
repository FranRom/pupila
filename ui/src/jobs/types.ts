// Shared types for the jobs UI tab. Re-exports + small constants kept in
// one file so the table, the detail panel, and App.tsx all import from a
// single place.

import type { ApplicationStatus, AppliedEntry, Job } from '../types.ts';

export type AppliedMap = Record<string, AppliedEntry>;
export type SetApplied = (
  job: Job,
  status: ApplicationStatus | null,
  notes?: string,
) => Promise<void>;

export interface AiApplyResult {
  jobId: string;
  body: string;
  path: string;
}

export interface AiApplyError {
  jobId: string;
  error: string;
}

export const STATUS_EMOJI: Record<ApplicationStatus, string> = {
  applied: '📝',
  interview: '💬',
  offer: '🎯',
  rejected: '❌',
  withdrawn: '⏸',
};

export const STATUS_OPTIONS: ApplicationStatus[] = [
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];
