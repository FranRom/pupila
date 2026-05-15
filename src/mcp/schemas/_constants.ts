// Shared Zod primitives used across MCP tool input schemas.
//
// JOB_ID_REGEX must match `isValidJobId` in `src/lib/apply-queue.ts` — both
// gate identical attack surfaces (path traversal via `data/applications/<jobId>.md`
// writes). Keep them in sync; the lib version stays a plain RegExp for hot
// paths, the Zod version is the parsing entry point at the tool boundary.

import { z } from 'zod';
import { APPLICATION_STATUSES, type Source } from '../../types.js';

// sha1 hex — 40 lowercase hex chars. Same as `isValidJobId` in
// src/lib/apply-queue.ts.
export const JOB_ID_REGEX = /^[a-f0-9]{40}$/;

export const jobIdSchema = z
  .string()
  .regex(JOB_ID_REGEX, 'jobId must be a 40-char lowercase sha1 hex string');

// Mirrors the Source union in src/types.ts. Kept as an explicit tuple so a
// new source must be added in two places (compile-time prompt).
export const SOURCES = [
  'remoteok',
  'remotive',
  'weworkremotely',
  'cryptojobslist',
  'web3career',
  'aijobsnet',
  'hn-hiring',
  'hn-jobs',
  'greenhouse',
  'ashby',
  'lever',
  'aave',
  'ashby-private',
] as const;

export const sourceEnum = z.enum(SOURCES);

// Compile-time guard: if a new value is added to the `Source` union in
// `src/types.ts` without being mirrored in `SOURCES` here, this expression
// fails to compile. Forces the two lists to stay in sync.
type _SourcesExhaustive =
  Exclude<Source, (typeof SOURCES)[number]> extends never
    ? true
    : ['SOURCES tuple missing a Source value', Exclude<Source, (typeof SOURCES)[number]>];
const _sourcesExhaustive: _SourcesExhaustive = true;
void _sourcesExhaustive;

export const CATEGORIES = ['web3', 'ai', 'web3+ai', 'general'] as const;
export const categoryEnum = z.enum(CATEGORIES);

export const AI_VERDICTS = ['strong-match', 'match', 'weak-match', 'skip'] as const;
export const verdictEnum = z.enum(AI_VERDICTS);

export const applicationStatusEnum = z.enum(APPLICATION_STATUSES);

// Sort keys accepted by list_jobs. Mirrors the UI's sortable columns
// (score / salaryMax / postedAt) plus a deterministic id fallback.
export const LIST_JOBS_SORT_KEYS = ['fitScore', 'salaryMax', 'postedAt', 'id'] as const;
export const listJobsSortEnum = z.enum(LIST_JOBS_SORT_KEYS);
