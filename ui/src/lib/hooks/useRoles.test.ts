import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleInterest } from '../../types.ts';
import { useRoles } from './useRoles.ts';

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  ) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const FE: RoleInterest = { id: 'fe', label: 'Frontend Engineer', titleMatch: ['frontend'] };
const PE: RoleInterest = {
  id: 'product',
  label: 'Product Engineer',
  titleMatch: ['product engineer'],
};

describe('useRoles', () => {
  it('loads roles on mount', async () => {
    mockFetch(() => new Response(JSON.stringify({ roles: [FE] }), { status: 200 }));
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roles).toEqual([FE]);
  });

  it('save() PUTs the list and adopts the server-validated response', async () => {
    const bodies: unknown[] = [];
    mockFetch((_input, init) => {
      if (init?.method === 'PUT') {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, roles: [FE, PE] }), { status: 200 });
      }
      return new Response(JSON.stringify({ roles: [FE] }), { status: 200 });
    });
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save([FE, PE]);
    });

    expect(result.current.roles).toEqual([FE, PE]);
    expect(bodies[0]).toEqual({ roles: [FE, PE] });
  });

  it('routes a load failure to onError', async () => {
    const onError = vi.fn();
    mockFetch(() => new Response('boom', { status: 500 }));
    const { result } = renderHook(() => useRoles({ onError }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
