import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppliedEntry, Job } from '../../types.ts';
import { useApplied } from './useApplied.ts';

const job1: Job = {
  id: 'job1',
  source: 'ashby',
  title: 'T1',
  company: 'C1',
  url: 'https://example.com/job1',
  location: null,
  remote: false,
  tags: [],
  salary: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postedAt: null,
  fetchedAt: '2026-05-01T00:00:00Z',
  fitScore: 80,
  categories: [],
};

const entry1: AppliedEntry = {
  url: 'https://example.com/job1',
  status: 'applied',
  date: '2026-05-01',
};

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

describe('useApplied', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reconciles AppliedEntry[] against allJobs into a jobId-keyed map on mount', async () => {
    mockFetch(() => new Response(JSON.stringify([entry1]), { status: 200 }));
    const { result } = renderHook(() => useApplied({ allJobs: [job1] }));
    await waitFor(() => expect(result.current.appliedById.job1).toBeDefined());
    expect(result.current.appliedById.job1).toEqual(entry1);
  });

  it('skips entries whose URL is not in the current job list', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify([entry1, { ...entry1, url: 'https://stale.example.com/x' }]), {
          status: 200,
        }),
    );
    const { result } = renderHook(() => useApplied({ allJobs: [job1] }));
    await waitFor(() => expect(Object.keys(result.current.appliedById)).toHaveLength(1));
    expect(result.current.appliedById.job1).toBeDefined();
  });

  describe('setApplied — POST', () => {
    it('optimistically updates state, then confirms with the server value', async () => {
      const serverEntry: AppliedEntry = { ...entry1, notes: 'server-canonical' };
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify([]), { status: 200 }); // initial /api/applied
        if (init?.method === 'POST') {
          return new Response(JSON.stringify(serverEntry), { status: 200 });
        }
        return new Response('?', { status: 500 });
      });
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useApplied({ allJobs: [job1], onSuccess }));
      await waitFor(() => expect(result.current.appliedById).toEqual({}));

      await act(async () => {
        await result.current.setApplied(job1, 'applied');
      });

      // Confirmed entry replaces the optimistic one.
      expect(result.current.appliedById.job1?.notes).toBe('server-canonical');
      expect(onSuccess).toHaveBeenCalled();
    });

    it('rolls back + reports onError when the POST fails', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify([]), { status: 200 });
        if (init?.method === 'POST') return new Response('boom', { status: 500 });
        return new Response('?', { status: 500 });
      });
      const onError = vi.fn();
      const { result } = renderHook(() => useApplied({ allJobs: [job1], onError }));
      await waitFor(() => expect(result.current.appliedById).toEqual({}));

      await act(async () => {
        await result.current.setApplied(job1, 'applied');
      });

      expect(result.current.appliedById.job1).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to save status'));
    });
  });

  describe('setApplied(null) — DELETE', () => {
    it('clears the entry on success', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify([entry1]), { status: 200 });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return new Response('?', { status: 500 });
      });
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useApplied({ allJobs: [job1], onSuccess }));
      await waitFor(() => expect(result.current.appliedById.job1).toBeDefined());

      await act(async () => {
        await result.current.setApplied(job1, null);
      });

      expect(result.current.appliedById.job1).toBeUndefined();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('rolls back the entry when DELETE fails', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify([entry1]), { status: 200 });
        if (init?.method === 'DELETE') return new Response('boom', { status: 500 });
        return new Response('?', { status: 500 });
      });
      const onError = vi.fn();
      const { result } = renderHook(() => useApplied({ allJobs: [job1], onError }));
      await waitFor(() => expect(result.current.appliedById.job1).toBeDefined());

      await act(async () => {
        await result.current.setApplied(job1, null);
      });

      expect(result.current.appliedById.job1).toEqual(entry1);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to clear status'));
    });
  });

  describe('upsertEntry — imperative hydration from AI Apply onComplete', () => {
    it('inserts the entry directly without hitting the server', async () => {
      mockFetch(() => new Response(JSON.stringify([]), { status: 200 }));
      const { result } = renderHook(() => useApplied({ allJobs: [job1] }));
      await waitFor(() => expect(result.current.appliedById).toEqual({}));

      act(() => {
        result.current.upsertEntry('job1', entry1);
      });

      expect(result.current.appliedById.job1).toEqual(entry1);
    });
  });
});
