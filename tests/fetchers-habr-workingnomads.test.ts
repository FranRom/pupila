import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHabr } from '../src/fetchers/habr.js';
import { fetchWorkingNomads } from '../src/fetchers/workingnomads.js';

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

describe('fetchWorkingNomads', () => {
  it('returns the bare array as items', async () => {
    stubFetch(() => json([{ url: 'https://www.workingnomads.com/jobs/a', title: 'A' }]));
    const r = await fetchWorkingNomads();
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
  });

  it('treats a non-array body as an empty result', async () => {
    stubFetch(() => json({ jobs: [] }));
    const r = await fetchWorkingNomads();
    expect(r).toEqual({ items: [], errors: [] });
  });

  it('never throws on an HTTP error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => new Response('', { status: 500 }));
    const r = await fetchWorkingNomads();
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatch(/HTTP 500/);
  });
});

describe('fetchHabr', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Senior React developer</title><link>https://career.habr.com/vacancies/1</link><guid>1</guid></item>
    <item><title>Lead Backend</title><link>https://career.habr.com/vacancies/2</link><guid>2</guid></item>
  </channel></rss>`;

  it('requests the remote-only vacancy feed and parses its items', async () => {
    let requested = '';
    stubFetch((url) => {
      requested = url;
      return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    });
    const r = await fetchHabr();
    expect(requested).toContain('career.habr.com/vacancies/rss');
    expect(requested).toContain('remote=true');
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(2);
  });

  it('never throws on an HTTP error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => new Response('', { status: 403 }));
    const r = await fetchHabr();
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatch(/HTTP 403/);
  });
});
