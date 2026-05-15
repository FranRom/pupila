import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboarding } from './useOnboarding.ts';

function mockFetchOnce(handler: (input: RequestInfo | URL) => Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => handler(input)) as typeof fetch;
}

describe('useOnboarding', () => {
  beforeEach(() => {
    mockFetchOnce(() => new Response('not mocked', { status: 500 }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with showOnboarding=null before the probe resolves', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.showOnboarding).toBeNull();
  });

  it('routes to wizard when /api/preferences returns onboardedAt=null', async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ provider: null, onboardedAt: null }), {
          status: 200,
        }),
    );
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.showOnboarding).toBe(true));
  });

  it('skips wizard when preferences carry an onboardedAt stamp', async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ provider: 'claude', onboardedAt: '2026-05-10' }), {
          status: 200,
        }),
    );
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.showOnboarding).toBe(false));
  });

  it('treats a failed probe as a fresh install (wizard shows)', async () => {
    mockFetchOnce(() => new Response('boom', { status: 500 }));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.showOnboarding).toBe(true));
  });

  it('dismiss() flips the gate off without another probe', async () => {
    mockFetchOnce(
      () =>
        new Response(JSON.stringify({ provider: null, onboardedAt: null }), {
          status: 200,
        }),
    );
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.showOnboarding).toBe(true));
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.showOnboarding).toBe(false);
  });

  it('reprobe() re-fetches and reflects the latest preferences state', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // First call: onboarded. Second call (after destructive clean): cleared.
      const body =
        callCount === 1
          ? { provider: 'claude', onboardedAt: '2026-05-10' }
          : { provider: null, onboardedAt: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.showOnboarding).toBe(false));
    await act(async () => {
      await result.current.reprobe();
    });
    expect(result.current.showOnboarding).toBe(true);
    expect(callCount).toBe(2);
  });
});
