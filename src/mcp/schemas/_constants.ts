// Shared Zod primitives used across MCP tool input schemas.
//
// JOB_ID_REGEX must match `isValidJobId` in `src/lib/apply-queue.ts` — both
// gate identical attack surfaces (path traversal via `data/applications/<jobId>.md`
// writes). Keep them in sync; the lib version stays a plain RegExp for hot
// paths, the Zod version is the parsing entry point at the tool boundary.

import { z } from 'zod';
import { APPLICATION_STATUSES, SOURCES } from '../../types.js';

// sha1 hex — 40 lowercase hex chars. Same as `isValidJobId` in
// src/lib/apply-queue.ts.
export const JOB_ID_REGEX = /^[a-f0-9]{40}$/;

export const jobIdSchema = z
  .string()
  .regex(JOB_ID_REGEX, 'jobId must be a 40-char lowercase sha1 hex string');

// Source enum derives directly from the canonical `SOURCES` tuple in
// `src/types.ts` — re-exported here so MCP schema consumers have a single import
// site. No local copy can drift out of sync.
export { SOURCES };
export const sourceEnum = z.enum(SOURCES);

export const CATEGORIES = ['web3', 'ai', 'web3+ai', 'general'] as const;
export const categoryEnum = z.enum(CATEGORIES);

export const AI_VERDICTS = ['strong-match', 'match', 'weak-match', 'skip'] as const;
export const verdictEnum = z.enum(AI_VERDICTS);

export const applicationStatusEnum = z.enum(APPLICATION_STATUSES);

// Sort keys accepted by list_jobs. Mirrors the UI's sortable columns
// (score / salaryMax / postedAt) plus a deterministic id fallback.
export const LIST_JOBS_SORT_KEYS = ['fitScore', 'salaryMax', 'postedAt', 'id'] as const;
export const listJobsSortEnum = z.enum(LIST_JOBS_SORT_KEYS);
