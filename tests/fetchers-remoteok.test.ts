import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRemoteOk } from '../src/fetchers/remoteok.js';

function stubFetch(impl: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => impl(String(url))),
  );
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchRemoteOk', () => {
  it('drops the legal/metadata first element and returns every job regardless of tags', async () => {
    stubFetch(() =>
      json([
        { legal: 'API terms' },
        { id: '1', position: 'Senior React Engineer', tags: ['react'] },
        // Not in the old 10-tag allowlist — must no longer be discarded here.
        { id: '2', position: 'Senior Rust Engineer', tags: ['rust', 'systems'] },
        { id: '3', position: 'Support Lead', tags: [] },
      ]),
    );
    const r = await fetchRemoteOk();
    expect(r.errors).toEqual([]);
    expect(r.items.map((j) => j.id)).toEqual(['1', '2', '3']);
  });

  it('reports a non-array response as an error instead of throwing', async () => {
    stubFetch(() => json({ error: 'nope' }));
    const r = await fetchRemoteOk();
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual(['response not an array']);
  });

  it('returns the HTTP error instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => new Response('boom', { status: 503 }));
    const r = await fetchRemoteOk();
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatch(/HTTP 503/);
  });
});
