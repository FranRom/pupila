import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplyQueueResponse } from '../../types.ts';
import { useApplyQueue } from './useApplyQueue.ts';

// We test the hook through the full path: hook → api/index.ts → request() →
// global fetch. Per-call handlers route on URL + method so each test can
// stage one snapshot at a time.

const queueWithRows = (rows: ApplyQueueResponse['rows']): ApplyQueueResponse => ({
  rows,
  worker: { alive: true, pid: 1234, pidPath: '/tmp/p' },
});

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('useApplyQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('polling gate', () => {
    it('does NOT fetch when pollEnabled is false', async () => {
      const fetchSpy = vi.fn(async () => new Response('?', { status: 500 }));
      globalThis.fetch = fetchSpy as typeof fetch;

      renderHook(() => useApplyQueue({ pollEnabled: false }));
      // Give microtasks a chance — there should be NO fetch ever.
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetches queue + skips on first tick when pollEnabled is true', async () => {
      mockFetch((input) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(
            JSON.stringify(
              queueWithRows([
                {
                  jobId: 'job1',
                  status: 'queued',
                  enqueuedAt: '2026-05-01T00:00:00Z',
                  attempts: 0,
                },
              ]),
            ),
            { status: 200 },
          );
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: ['jobX'] }), { status: 200 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());
      expect(result.current.queue?.rows).toHaveLength(1);
      expect(result.current.swipeSkipIds.has('jobX')).toBe(true);
    });
  });

  describe('derived helpers', () => {
    it('statusMap and activeJobIds reflect the most-recent queue rows', async () => {
      mockFetch((input) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(
            JSON.stringify(
              queueWithRows([
                { jobId: 'a', status: 'queued', enqueuedAt: '2026-05-01', attempts: 0 },
                { jobId: 'b', status: 'running', enqueuedAt: '2026-05-01', attempts: 0 },
                { jobId: 'c', status: 'done', enqueuedAt: '2026-05-01', attempts: 1 },
                { jobId: 'd', status: 'failed', enqueuedAt: '2026-05-01', attempts: 1 },
                { jobId: 'e', status: 'cancelled', enqueuedAt: '2026-05-01', attempts: 0 },
              ]),
            ),
            { status: 200 },
          );
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue?.rows).toHaveLength(5));

      expect(result.current.statusMap).toEqual({
        a: 'queued',
        b: 'running',
        c: 'done',
        d: 'failed',
        e: 'cancelled',
      });
      // Only queued + running are active.
      expect(Array.from(result.current.activeJobIds).sort()).toEqual(['a', 'b']);
    });
  });

  describe('enqueue', () => {
    it('POSTs to /api/apply-queue/enqueue and refreshes', async () => {
      const calls: { url: string; method?: string }[] = [];
      mockFetch((input, init) => {
        const url = urlOf(input);
        calls.push({ url, method: init?.method });
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url === '/api/apply-queue/enqueue') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      await act(async () => {
        await result.current.enqueue('jobX');
      });
      expect(calls.some((c) => c.url === '/api/apply-queue/enqueue' && c.method === 'POST')).toBe(
        true,
      );
    });

    it('swallows HTTP 409 (dedup) without onError', async () => {
      const onError = vi.fn();
      mockFetch((input) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url === '/api/apply-queue/enqueue') {
          return new Response('already queued', { status: 409 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true, onError }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      await act(async () => {
        await result.current.enqueue('jobX');
      });
      expect(onError).not.toHaveBeenCalled();
    });

    it('reports onError on non-409 failures', async () => {
      const onError = vi.fn();
      mockFetch((input) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url === '/api/apply-queue/enqueue') {
          return new Response('boom', { status: 500 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true, onError }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      await act(async () => {
        await result.current.enqueue('jobX');
      });
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not queue job'));
    });
  });

  describe('cancel', () => {
    it('DELETEs /api/apply-queue/:jobId and refreshes', async () => {
      const calls: { url: string; method?: string }[] = [];
      mockFetch((input, init) => {
        const url = urlOf(input);
        calls.push({ url, method: init?.method });
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url.startsWith('/api/apply-queue/') && init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      await act(async () => {
        await result.current.cancel('jobX');
      });
      expect(calls.some((c) => c.url === '/api/apply-queue/jobX' && c.method === 'DELETE')).toBe(
        true,
      );
    });
  });

  describe('addSkip / removeSkip — optimistic + rollback', () => {
    it('addSkip mutates the local set immediately and returns null on success', async () => {
      mockFetch((input, init) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url.endsWith('/skip') && init?.method === 'POST') {
          return new Response(null, { status: 204 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      let returned: string | null = 'unset';
      await act(async () => {
        returned = await result.current.addSkip('jobX');
      });
      expect(returned).toBeNull();
      expect(result.current.swipeSkipIds.has('jobX')).toBe(true);
    });

    it('addSkip rolls back when the server call fails and returns a formatted error', async () => {
      mockFetch((input, init) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: [] }), { status: 200 });
        }
        if (url.endsWith('/skip') && init?.method === 'POST') {
          return new Response('boom', { status: 500 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.queue).not.toBeNull());

      let returned: string | null = null;
      await act(async () => {
        returned = await result.current.addSkip('jobX');
      });
      expect(returned).toBeTruthy();
      expect(result.current.swipeSkipIds.has('jobX')).toBe(false);
    });

    it('removeSkip optimistically clears the entry and rolls back on failure', async () => {
      mockFetch((input, init) => {
        const url = urlOf(input);
        if (url === '/api/apply-queue') {
          return new Response(JSON.stringify(queueWithRows([])), { status: 200 });
        }
        if (url === '/api/apply-queue/skips') {
          return new Response(JSON.stringify({ skips: ['jobX'] }), { status: 200 });
        }
        if (url.endsWith('/skip') && init?.method === 'DELETE') {
          return new Response('boom', { status: 500 });
        }
        return new Response('?', { status: 500 });
      });

      const { result } = renderHook(() => useApplyQueue({ pollEnabled: true }));
      await waitFor(() => expect(result.current.swipeSkipIds.has('jobX')).toBe(true));

      let returned: string | null = null;
      await act(async () => {
        returned = await result.current.removeSkip('jobX');
      });
      expect(returned).toBeTruthy();
      // Rolled back — entry restored.
      expect(result.current.swipeSkipIds.has('jobX')).toBe(true);
    });
  });
});
