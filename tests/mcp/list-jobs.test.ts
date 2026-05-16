import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listJobsInputObject } from '../../src/mcp/schemas/list-jobs.js';
import { runListJobs } from '../../src/mcp/tools/list-jobs.js';
import type { Job } from '../../src/types.js';
import { buildFixture, type FixtureLayout, jobIdFor, makeJob, parseToolJson } from './_fixtures.js';

interface ListJobsResponse {
  total: number;
  matched: number;
  returned: number;
  jobs: Job[];
}

function pathsFor(fx: FixtureLayout) {
  return { jobsPath: fx.jobsPath, appliedPath: fx.appliedPath };
}

describe('runListJobs', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns empty result when jobs.json is missing (fresh clone state)', async () => {
    fx = await buildFixture({ jobs: undefined });
    const input = listJobsInputObject.parse({});
    const result = await runListJobs(input, pathsFor(fx));
    const payload = parseToolJson(result.content) as ListJobsResponse;
    expect(payload.total).toBe(0);
    expect(payload.matched).toBe(0);
    expect(payload.returned).toBe(0);
    expect(payload.jobs).toEqual([]);
  });

  describe('with seeded jobs', () => {
    beforeEach(async () => {
      fx = await buildFixture({
        jobs: [
          makeJob({ url: 'https://x.io/1', category: 'web3', fitScore: 90, source: 'ashby' }),
          makeJob({ url: 'https://x.io/2', category: 'ai', fitScore: 70, source: 'lever' }),
          makeJob({ url: 'https://x.io/3', category: 'general', fitScore: 40, source: 'ashby' }),
          makeJob({
            url: 'https://x.io/4',
            title: 'Lead Backend Engineer',
            category: 'general',
            fitScore: 55,
            source: 'greenhouse',
          }),
        ],
      });
    });

    it('filters by category', async () => {
      const input = listJobsInputObject.parse({ category: 'ai' });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.matched).toBe(1);
      expect(payload.jobs[0]?.category).toBe('ai');
    });

    it('filters by source', async () => {
      const input = listJobsInputObject.parse({ source: 'ashby' });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.matched).toBe(2);
      for (const j of payload.jobs) expect(j.source).toBe('ashby');
    });

    it('filters by minScore', async () => {
      const input = listJobsInputObject.parse({ minScore: 60 });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.matched).toBe(2);
      for (const j of payload.jobs) expect(j.fitScore).toBeGreaterThanOrEqual(60);
    });

    it('q matches title substring case-insensitively', async () => {
      const input = listJobsInputObject.parse({ q: 'BACKEND' });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.matched).toBe(1);
      expect(payload.jobs[0]?.title).toContain('Backend');
    });

    it('sorts by fitScore desc by default', async () => {
      const input = listJobsInputObject.parse({});
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      const scores = payload.jobs.map((j) => j.fitScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('honors dir: asc', async () => {
      const input = listJobsInputObject.parse({ dir: 'asc' });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      const scores = payload.jobs.map((j) => j.fitScore);
      expect(scores).toEqual([...scores].sort((a, b) => a - b));
    });

    it('limit caps the returned count without changing matched', async () => {
      const input = listJobsInputObject.parse({ limit: 2 });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.matched).toBe(4);
      expect(payload.returned).toBe(2);
      expect(payload.jobs).toHaveLength(2);
    });

    it('returns top of the sort window', async () => {
      const input = listJobsInputObject.parse({ sort: 'fitScore', limit: 1 });
      const result = await runListJobs(input, pathsFor(fx));
      const payload = parseToolJson(result.content) as ListJobsResponse;
      expect(payload.jobs[0]?.fitScore).toBe(90);
    });
  });

  it('filter applied=true only loads applied.json when active', async () => {
    const appliedUrl = 'https://target.example/posting/123';
    fx = await buildFixture({
      jobs: [
        makeJob({ url: appliedUrl, fitScore: 70 }),
        makeJob({ url: 'https://target.example/posting/999', fitScore: 60 }),
      ],
      applied: [{ url: appliedUrl, status: 'interview', date: '2026-05-12' }],
    });

    const trueResult = await runListJobs(
      listJobsInputObject.parse({ applied: true }),
      pathsFor(fx),
    );
    const trueP = parseToolJson(trueResult.content) as ListJobsResponse;
    expect(trueP.matched).toBe(1);
    expect(trueP.jobs[0]?.id).toBe(jobIdFor(appliedUrl));
    // applied entry is attached inline when the map is loaded.
    expect(trueP.jobs[0]?.applied?.status).toBe('interview');

    const falseResult = await runListJobs(
      listJobsInputObject.parse({ applied: false }),
      pathsFor(fx),
    );
    const falseP = parseToolJson(falseResult.content) as ListJobsResponse;
    expect(falseP.matched).toBe(1);
    expect(falseP.jobs[0]?.applied).toBeUndefined();
  });
});
