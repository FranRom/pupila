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

  it('updates optimistically, before the server has answered', async () => {
    let release: (r: Response) => void = () => {};
    let calls = 0;
    mockFetch((_input, init) => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ favorites: [] }), { status: 200 });
      if (init?.method === 'POST') return new Promise<Response>((res) => (release = res));
      return new Response('?', { status: 500 });
    });
    const { result } = renderHook(() => useFavorites());
    await waitFor(() => expect(result.current.favoriteIds.size).toBe(0));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.toggleFavorite('job1');
    });
    // The POST is still in flight, yet the star is already on.
    expect(result.current.isFavorite('job1')).toBe(true);

    await act(async () => {
      release(new Response(null, { status: 200 }));
      await pending;
    });
    expect(result.current.isFavorite('job1')).toBe(true);
  });

  it('does not let a slow initial load undo a toggle made before it returned', async () => {
    let releaseList: (r: Response) => void = () => {};
    mockFetch((_input, init) => {
      if (init?.method === 'POST') return new Response(null, { status: 200 });
      if (init?.method === 'DELETE') return new Response(null, { status: 200 });
      return new Promise<Response>((res) => (releaseList = res)); // GET /api/favorites
    });
    const { result } = renderHook(() => useFavorites());

    await act(async () => {
      await result.current.toggleFavorite('job1');
    });
    expect(result.current.isFavorite('job1')).toBe(true);

    // The stale snapshot (taken before the toggle) arrives afterwards.
    await act(async () => {
      releaseList(new Response(JSON.stringify({ favorites: ['job2'] }), { status: 200 }));
    });
    await waitFor(() => expect(result.current.isFavorite('job2')).toBe(true));
    expect(result.current.isFavorite('job1')).toBe(true);
  });

  it('reports a failed initial load through onError', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const onError = vi.fn();
    renderHook(() => useFavorites({ onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[0]).toMatch(/Could not load favorites/);
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
