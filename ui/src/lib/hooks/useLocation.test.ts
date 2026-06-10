import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationProfile } from '../../types.ts';
import { DEFAULT_LOCATION, useLocation } from './useLocation.ts';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const EU: LocationProfile = {
  basedIn: 'Spain',
  workTypes: ['remote', 'hybrid'],
  acceptedRegions: ['europe', 'emea'],
  excludeOutsideAcceptedRegions: true,
};

describe('useLocation', () => {
  it('loads location on mount', async () => {
    mockFetch(() => new Response(JSON.stringify({ location: EU }), { status: 200 }));
    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.location).toEqual(EU);
  });

  it('falls back to the neutral default when the server has no location', async () => {
    mockFetch(() => new Response(JSON.stringify({ location: null }), { status: 200 }));
    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.location).toEqual(DEFAULT_LOCATION);
  });

  it('save() PUTs the location and adopts the server-validated response', async () => {
    const bodies: unknown[] = [];
    mockFetch((_input, init) => {
      if (init?.method === 'PUT') {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, location: EU }), { status: 200 });
      }
      return new Response(JSON.stringify({ location: DEFAULT_LOCATION }), { status: 200 });
    });
    const { result } = renderHook(() => useLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save(EU);
    });

    expect(result.current.location).toEqual(EU);
    expect(bodies[0]).toEqual({ location: EU });
  });

  it('routes a load failure to onError', async () => {
    const onError = vi.fn();
    mockFetch(() => new Response('boom', { status: 500 }));
    const { result } = renderHook(() => useLocation({ onError }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
