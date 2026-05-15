import { afterEach, describe, expect, it } from 'vitest';
import { type GetJobDetailPaths, runGetJobDetail } from '../../src/mcp/tools/get-job-detail.js';
import type { AiReview, AppliedEntry, Job } from '../../src/types.js';
import { buildFixture, type FixtureLayout, jobIdFor, makeJob, parseToolJson } from './_fixtures.js';

interface DetailResponse {
  job: Job;
  body: string | null;
  bodySource: 'sidecar' | 'jobs.json' | 'preview' | null;
  aiReview: AiReview | null;
  applied: AppliedEntry | null;
}

function pathsFor(fx: FixtureLayout): GetJobDetailPaths {
  return {
    jobsPath: fx.jobsPath,
    jobsBodiesPath: fx.jobsBodiesPath,
    reviewsPath: fx.reviewsPath,
    appliedPath: fx.appliedPath,
  };
}

describe('runGetJobDetail', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns an error envelope when the job id is unknown', async () => {
    fx = await buildFixture({ jobs: [makeJob({ url: 'https://a.example/1' })] });
    const ghost = 'f'.repeat(40);
    const result = await runGetJobDetail({ jobId: ghost }, pathsFor(fx));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Job not found');
  });

  it('prefers the sidecar body when present', async () => {
    const url = 'https://a.example/with-body';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url, body: '' })],
      jobsBodies: { [jobId]: 'sidecar body text' },
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.body).toBe('sidecar body text');
    expect(payload.bodySource).toBe('sidecar');
  });

  it('falls back to jobs.json body when no sidecar entry', async () => {
    const url = 'https://a.example/inline-body';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url, body: 'inline body content' })],
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.body).toBe('inline body content');
    expect(payload.bodySource).toBe('jobs.json');
  });

  it('falls back to bodyPreview when neither sidecar nor body present', async () => {
    const url = 'https://a.example/preview-only';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url, body: '', bodyPreview: 'preview only' })],
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.body).toBe('preview only');
    expect(payload.bodySource).toBe('preview');
  });

  it('returns body: null when no body data exists anywhere', async () => {
    const url = 'https://a.example/no-body';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url, body: '' })],
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.body).toBeNull();
    expect(payload.bodySource).toBeNull();
  });

  it('merges AI review when the jobId has one', async () => {
    const url = 'https://a.example/with-review';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url })],
      reviews: {
        [jobId]: {
          jobId,
          reviewedAt: '2026-05-14T00:00:00.000Z',
          model: 'claude',
          summary: 'Looks like a strong fit',
          wants: ['React'],
          offers: ['Remote'],
          redFlags: [],
          verdict: 'strong-match',
          reason: 'Stack match + remote',
        },
      },
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.aiReview?.verdict).toBe('strong-match');
    expect(payload.aiReview?.summary).toBe('Looks like a strong fit');
  });

  it('merges applied entry when the URL matches', async () => {
    const url = 'https://a.example/applied-here';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      jobs: [makeJob({ url })],
      applied: [{ url, status: 'offer', date: '2026-05-13', notes: 'phone screen passed' }],
    });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.applied?.status).toBe('offer');
    expect(payload.applied?.notes).toBe('phone screen passed');
  });

  it('returns null aiReview/applied when files are missing entirely', async () => {
    const url = 'https://a.example/clean';
    const jobId = jobIdFor(url);
    fx = await buildFixture({ jobs: [makeJob({ url })] });
    const result = await runGetJobDetail({ jobId }, pathsFor(fx));
    const payload = parseToolJson(result.content) as DetailResponse;
    expect(payload.aiReview).toBeNull();
    expect(payload.applied).toBeNull();
  });
});
