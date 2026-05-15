import { afterEach, describe, expect, it } from 'vitest';
import { runGetAiReview } from '../../src/mcp/tools/get-ai-review.js';
import { runListAiReviews } from '../../src/mcp/tools/list-ai-reviews.js';
import { runRunSummary } from '../../src/mcp/tools/run-summary.js';
import type { AiReview } from '../../src/types.js';
import { buildFixture, type FixtureLayout, jobIdFor, makeJob, parseToolJson } from './_fixtures.js';

function review(jobId: string, verdict: AiReview['verdict']): AiReview {
  return {
    jobId,
    reviewedAt: '2026-05-14T00:00:00.000Z',
    model: 'claude',
    summary: `Summary for ${verdict}`,
    wants: [],
    offers: [],
    redFlags: [],
    verdict,
    reason: 'test reason',
  };
}

describe('run_summary', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns zero-state when jobs.json is missing', async () => {
    fx = await buildFixture({});
    const result = await runRunSummary({ jobsPath: fx.jobsPath });
    const payload = parseToolJson(result.content) as {
      total: number;
      byCategory: Record<string, number>;
      bySource: { name: string; kept: number }[];
      ageHours: number | null;
    };
    expect(payload.total).toBe(0);
    expect(payload.byCategory).toEqual({ 'web3+ai': 0, web3: 0, ai: 0, general: 0 });
    expect(payload.bySource).toEqual([]);
    expect(payload.ageHours).toBeNull();
  });

  it('aggregates byCategory and bySource correctly', async () => {
    fx = await buildFixture({
      jobs: [
        makeJob({ url: 'https://s.test/1', category: 'web3', source: 'ashby' }),
        makeJob({ url: 'https://s.test/2', category: 'web3', source: 'lever' }),
        makeJob({ url: 'https://s.test/3', category: 'ai', source: 'ashby' }),
        makeJob({ url: 'https://s.test/4', category: 'general', source: 'remoteok' }),
      ],
    });
    const result = await runRunSummary({ jobsPath: fx.jobsPath });
    const payload = parseToolJson(result.content) as {
      total: number;
      byCategory: Record<string, number>;
      bySource: { name: string; kept: number }[];
    };
    expect(payload.total).toBe(4);
    expect(payload.byCategory.web3).toBe(2);
    expect(payload.byCategory.ai).toBe(1);
    expect(payload.byCategory.general).toBe(1);
    expect(payload.bySource).toContainEqual({ name: 'ashby', kept: 2 });
    expect(payload.bySource).toContainEqual({ name: 'lever', kept: 1 });
    // Sorted desc by kept count.
    expect(payload.bySource[0]?.kept).toBeGreaterThanOrEqual(payload.bySource[1]?.kept ?? 0);
  });

  it('derives generatedAt from max fetchedAt', async () => {
    fx = await buildFixture({
      jobs: [
        makeJob({ url: 'https://t.test/1', fetchedAt: '2026-05-10T00:00:00.000Z' }),
        makeJob({ url: 'https://t.test/2', fetchedAt: '2026-05-15T12:00:00.000Z' }),
      ],
    });
    const result = await runRunSummary({ jobsPath: fx.jobsPath });
    const payload = parseToolJson(result.content) as { generatedAt: string | null };
    expect(payload.generatedAt).toBe('2026-05-15T12:00:00.000Z');
  });
});

describe('get_ai_review', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns review when jobId has one', async () => {
    const url = 'https://r.test/1';
    const jobId = jobIdFor(url);
    fx = await buildFixture({
      reviews: { [jobId]: review(jobId, 'strong-match') },
    });
    const result = await runGetAiReview({ jobId }, { reviewsPath: fx.reviewsPath });
    const payload = parseToolJson(result.content) as { review: AiReview | null };
    expect(payload.review?.verdict).toBe('strong-match');
  });

  it('returns null when jobId has no review', async () => {
    fx = await buildFixture({});
    const result = await runGetAiReview({ jobId: 'b'.repeat(40) }, { reviewsPath: fx.reviewsPath });
    const payload = parseToolJson(result.content) as { review: AiReview | null };
    expect(payload.review).toBeNull();
  });
});

describe('list_ai_reviews', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns empty list when no reviews file exists', async () => {
    fx = await buildFixture({});
    const result = await runListAiReviews({ limit: 50 }, { reviewsPath: fx.reviewsPath });
    const payload = parseToolJson(result.content) as {
      total: number;
      reviews: AiReview[];
    };
    expect(payload.total).toBe(0);
    expect(payload.reviews).toEqual([]);
  });

  it('filters by verdict', async () => {
    const a = jobIdFor('https://l.test/1');
    const b = jobIdFor('https://l.test/2');
    const c = jobIdFor('https://l.test/3');
    fx = await buildFixture({
      reviews: {
        [a]: review(a, 'strong-match'),
        [b]: review(b, 'match'),
        [c]: review(c, 'strong-match'),
      },
    });
    const result = await runListAiReviews(
      { verdict: 'strong-match', limit: 50 },
      { reviewsPath: fx.reviewsPath },
    );
    const payload = parseToolJson(result.content) as {
      total: number;
      matched: number;
      reviews: AiReview[];
    };
    expect(payload.total).toBe(3);
    expect(payload.matched).toBe(2);
    expect(payload.reviews.every((r) => r.verdict === 'strong-match')).toBe(true);
  });

  it('honors limit and reports counts independently', async () => {
    const a = jobIdFor('https://l.test/a');
    const b = jobIdFor('https://l.test/b');
    fx = await buildFixture({
      reviews: { [a]: review(a, 'match'), [b]: review(b, 'match') },
    });
    const result = await runListAiReviews({ limit: 1 }, { reviewsPath: fx.reviewsPath });
    const payload = parseToolJson(result.content) as {
      matched: number;
      returned: number;
      reviews: AiReview[];
    };
    expect(payload.matched).toBe(2);
    expect(payload.returned).toBe(1);
    expect(payload.reviews).toHaveLength(1);
  });
});
