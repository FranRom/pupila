import { describe, expect, it } from 'vitest';
import {
  applicationStatusEnum,
  categoryFilterSchema,
  JOB_ID_REGEX,
  jobIdSchema,
  LIST_JOBS_SORT_KEYS,
  SOURCES,
  verdictEnum,
} from '../../src/mcp/schemas/_constants.js';
import { getJobDetailInputObject } from '../../src/mcp/schemas/get-job-detail.js';
import { listJobsInputObject } from '../../src/mcp/schemas/list-jobs.js';
import { APPLICATION_STATUSES } from '../../src/types.js';

const VALID_JOB_ID = 'a'.repeat(40);

describe('JOB_ID_REGEX', () => {
  it('accepts a 40-char lowercase hex string', () => {
    expect(JOB_ID_REGEX.test(VALID_JOB_ID)).toBe(true);
    expect(JOB_ID_REGEX.test('0123456789abcdef0123456789abcdef01234567')).toBe(true);
  });

  it('rejects uppercase hex (sha1 hex is always lowercase here)', () => {
    expect(JOB_ID_REGEX.test('A'.repeat(40))).toBe(false);
  });

  it('rejects wrong-length strings', () => {
    expect(JOB_ID_REGEX.test('a'.repeat(39))).toBe(false);
    expect(JOB_ID_REGEX.test('a'.repeat(41))).toBe(false);
    expect(JOB_ID_REGEX.test('')).toBe(false);
  });

  it('rejects non-hex characters (path-traversal vectors)', () => {
    expect(JOB_ID_REGEX.test('../../../etc/passwd-aaaaaaaaaaaaaaaa')).toBe(false);
    expect(JOB_ID_REGEX.test(`${'a'.repeat(38)}/x`)).toBe(false);
    expect(JOB_ID_REGEX.test(`${'a'.repeat(38)}..`)).toBe(false);
  });

  it('jobIdSchema parses valid id, rejects malicious input', () => {
    expect(jobIdSchema.safeParse(VALID_JOB_ID).success).toBe(true);
    expect(jobIdSchema.safeParse('../etc/passwd').success).toBe(false);
    expect(jobIdSchema.safeParse(42).success).toBe(false);
  });
});

describe('shared enum schemas', () => {
  it('SOURCES covers every value used in src/types.ts Source union', () => {
    // Spot-check key sources — if any are missing we'd fail to validate input.
    expect(SOURCES).toContain('ashby');
    expect(SOURCES).toContain('ashby-private');
    expect(SOURCES).toContain('aave');
    expect(SOURCES).toContain('hn-hiring');
  });

  it('categoryFilterSchema accepts any non-empty id string, rejects empty/oversized', () => {
    // Categories are user-defined config, not a fixed enum — the filter takes
    // any id and matches it at runtime.
    expect(categoryFilterSchema.safeParse('web3').success).toBe(true);
    expect(categoryFilterSchema.safeParse('fintech').success).toBe(true);
    expect(categoryFilterSchema.safeParse('').success).toBe(false);
    expect(categoryFilterSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });

  it('LIST_JOBS_SORT_KEYS exposes only safe sort columns', () => {
    expect(LIST_JOBS_SORT_KEYS).toEqual(['fitScore', 'salaryMax', 'postedAt', 'id']);
  });

  it('applicationStatusEnum mirrors APPLICATION_STATUSES const', () => {
    for (const s of APPLICATION_STATUSES) {
      expect(applicationStatusEnum.safeParse(s).success).toBe(true);
    }
    expect(applicationStatusEnum.safeParse('not-a-status').success).toBe(false);
  });

  it('verdictEnum accepts every AiVerdict value', () => {
    expect(verdictEnum.safeParse('strong-match').success).toBe(true);
    expect(verdictEnum.safeParse('match').success).toBe(true);
    expect(verdictEnum.safeParse('weak-match').success).toBe(true);
    expect(verdictEnum.safeParse('skip').success).toBe(true);
    expect(verdictEnum.safeParse('strong').success).toBe(false);
  });
});

describe('listJobsInputObject', () => {
  it('applies defaults for sort/dir/limit', () => {
    const parsed = listJobsInputObject.parse({});
    expect(parsed.sort).toBe('fitScore');
    expect(parsed.dir).toBe('desc');
    expect(parsed.limit).toBe(50);
  });

  it('rejects limit above the 500 cap', () => {
    expect(listJobsInputObject.safeParse({ limit: 501 }).success).toBe(false);
  });

  it('rejects negative minScore', () => {
    expect(listJobsInputObject.safeParse({ minScore: -1 }).success).toBe(false);
  });

  it('rejects unknown sort key (defense against SQL-injection-style payloads)', () => {
    expect(listJobsInputObject.safeParse({ sort: 'DROP TABLE jobs' }).success).toBe(false);
  });

  it('rejects q longer than 200 chars', () => {
    expect(listJobsInputObject.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts a fully populated request', () => {
    const result = listJobsInputObject.safeParse({
      category: 'ai',
      source: 'ashby',
      applied: false,
      q: 'frontend',
      minScore: 50,
      sort: 'salaryMax',
      dir: 'asc',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });
});

describe('getJobDetailInputObject', () => {
  it('requires a valid jobId', () => {
    expect(getJobDetailInputObject.safeParse({ jobId: VALID_JOB_ID }).success).toBe(true);
    expect(getJobDetailInputObject.safeParse({}).success).toBe(false);
    expect(getJobDetailInputObject.safeParse({ jobId: 'short' }).success).toBe(false);
  });
});
