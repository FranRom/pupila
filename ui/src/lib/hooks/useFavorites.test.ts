import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFavorites } from './useFavorites.ts';

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

describe('useFavorites', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads favorite ids on mount', async () => {
    mockFetch(() => new Response(JSON.stringify({ favorites: ['job1', 'job2'] }), { status: 200 }));
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.favoriteIds.size).toBe(2));
    expect(result.current.isFavorite('job1')).toBe(true);
    expect(result.current.isFavorite('job3')).toBe(false);
  });

  describe('toggleFavorite — add', () => {
    it('optimistically adds, keeps it on success', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ favorites: [] }), { status: 200 });
        if (init?.method === 'POST') return new Response(null, { status: 200 });
        return new Response('?', { status: 500 });
      });
      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.favoriteIds.size).toBe(0));

      await act(async () => {
        await result.current.toggleFavorite('job1');
      });

      expect(result.current.isFavorite('job1')).toBe(true);
    });

    it('rolls back + reports onError when the POST fails', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ favorites: [] }), { status: 200 });
        if (init?.method === 'POST') return new Response('boom', { status: 500 });
        return new Response('?', { status: 500 });
      });
      const onError = vi.fn();
      const { result } = renderHook(() => useFavorites({ onError }));
      await waitFor(() => expect(result.current.favoriteIds.size).toBe(0));

      await act(async () => {
        await result.current.toggleFavorite('job1');
      });

      expect(result.current.isFavorite('job1')).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not favorite'));
    });
  });

  describe('toggleFavorite — remove', () => {
    it('optimistically removes an existing favorite on success', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1)
          return new Response(JSON.stringify({ favorites: ['job1'] }), { status: 200 });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return new Response('?', { status: 500 });
      });
      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isFavorite('job1')).toBe(true));

      await act(async () => {
        await result.current.toggleFavorite('job1');
      });

      expect(result.current.isFavorite('job1')).toBe(false);
    });

    it('rolls back the removal when DELETE fails', async () => {
      let calls = 0;
      mockFetch((_input, init) => {
        calls++;
        if (calls === 1)
          return new Response(JSON.stringify({ favorites: ['job1'] }), { status: 200 });
        if (init?.method === 'DELETE') return new Response('boom', { status: 500 });
        return new Response('?', { status: 500 });
      });
      const onError = vi.fn();
      const { result } = renderHook(() => useFavorites({ onError }));
      await waitFor(() => expect(result.current.isFavorite('job1')).toBe(true));

      await act(async () => {
        await result.current.toggleFavorite('job1');
      });

      expect(result.current.isFavorite('job1')).toBe(true);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not unfavorite'));
    });
  });
});
