import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../types.ts';
import { useJobsData } from './useJobsData.ts';

// We test the hook through the full path: hook → api/index.ts → request() →
// global fetch. Mocking fetch (not the api object) means the test exercises
// the same code path production runs. Per-test setup defines what each
// endpoint returns.

const sampleJob: Job = {
  id: 'job1',
  source: 'ashby',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  url: 'https://example.com/job1',
  location: 'Remote',
  remote: true,
  tags: [],
  salary: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postedAt: null,
  fetchedAt: '2026-05-01T00:00:00Z',
  fitScore: 90,
  category: 'ai',
};

function mockEndpoints(handlers: Record<string, () => Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (handler) return handler();
    return new Response('not mocked', { status: 500 });
  }) as typeof fetch;
}

describe('useJobsData', () => {
  beforeEach(() => {
    mockEndpoints({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state with empty data', () => {
    mockEndpoints({});
    const { result } = renderHook(() => useJobsData());
    expect(result.current.loading).toBe(true);
    expect(result.current.allJobs).toEqual([]);
    expect(result.current.aiReviews).toEqual({});
  });

  it('populates state from /api/jobs + /api/reviews on mount', async () => {
    mockEndpoints({
      '/api/jobs': () => new Response(JSON.stringify([sampleJob]), { status: 200 }),
      '/api/reviews': () =>
        new Response(
          JSON.stringify({
            job1: {
              jobId: 'job1',
              reviewedAt: '2026-05-01T00:00:00Z',
              model: 'test',
              summary: 's',
              wants: [],
              offers: [],
              redFlags: [],
              verdict: 'match',
              reason: 'r',
            },
          }),
          { status: 200 },
        ),
    });
    const { result } = renderHook(() => useJobsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allJobs).toHaveLength(1);
    expect(result.current.allJobs[0]?.title).toBe('Senior Frontend Engineer');
    expect(result.current.aiReviews.job1?.verdict).toBe('match');
  });

  it('falls back to empty arrays when both endpoints fail', async () => {
    mockEndpoints({
      '/api/jobs': () => new Response('boom', { status: 500 }),
      '/api/reviews': () => new Response('boom', { status: 500 }),
    });
    const { result } = renderHook(() => useJobsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allJobs).toEqual([]);
    expect(result.current.aiReviews).toEqual({});
  });

  it('reload() re-fetches and returns the fresh values', async () => {
    let jobsCallCount = 0;
    mockEndpoints({
      '/api/jobs': () => {
        jobsCallCount++;
        return new Response(JSON.stringify(jobsCallCount === 1 ? [] : [sampleJob]), {
          status: 200,
        });
      },
      '/api/reviews': () => new Response(JSON.stringify({}), { status: 200 }),
    });
    const { result } = renderHook(() => useJobsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allJobs).toEqual([]);
    const reloadResult = await result.current.reload();
    expect(reloadResult?.jobs).toHaveLength(1);
    await waitFor(() => expect(result.current.allJobs).toHaveLength(1));
  });
});
