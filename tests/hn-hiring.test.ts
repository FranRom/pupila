import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHnHiring, pickLatestHiringStory } from '../src/fetchers/hn-hiring.js';
import type { RawHnHit } from '../src/types.js';

function hit(overrides: Partial<RawHnHit> = {}): RawHnHit {
  return {
    objectID: '48747976',
    title: 'Ask HN: Who is hiring? (July 2026)',
    created_at: '2026-07-01T15:01:21.000Z',
    ...overrides,
  } as RawHnHit;
}

describe('pickLatestHiringStory', () => {
  it('picks the hiring thread out of a mixed result set', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: '1', title: 'Ask HN: Who wants to be hired? (July 2026)' }),
      hit(),
      hit({ objectID: '2', title: 'Show HN: my job board' }),
    ]);
    expect(picked?.objectID).toBe('48747976');
  });

  it('never returns the sibling "who wants to be hired" thread', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: '1', title: 'Ask HN: Who wants to be hired? (July 2026)' }),
      hit({ objectID: '2', title: 'Ask HN: Freelancer? Seeking freelancer? (July 2026)' }),
    ]);
    expect(picked).toBeNull();
  });

  it('picks the newest when several months are present', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: 'may', created_at: '2026-05-01T15:00:07.000Z' }),
      hit({ objectID: 'july', created_at: '2026-07-01T15:01:21.000Z' }),
      hit({ objectID: 'june', created_at: '2026-06-01T15:00:00.000Z' }),
    ]);
    expect(picked?.objectID).toBe('july');
  });

  // The regression: a month-old thread must still be found. Under the old
  // 5-result free-text window it had been pushed out by newer unrelated stories,
  // so the source silently returned zero for most of every month.
  it('still finds a month-old thread buried among newer unrelated stories', () => {
    const noise = Array.from({ length: 25 }, (_, i) =>
      hit({
        objectID: `noise-${i}`,
        title: `Ask HN: is anyone hiring juniors? (${i})`,
        created_at: `2026-07-${String(20 + (i % 8)).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const picked = pickLatestHiringStory([...noise, hit()]);
    expect(picked?.objectID).toBe('48747976');
  });

  it('returns null on an empty or title-less result set', () => {
    expect(pickLatestHiringStory([])).toBeNull();
    expect(pickLatestHiringStory([hit({ title: undefined })])).toBeNull();
  });

  it('tolerates an unparseable created_at without throwing', () => {
    const picked = pickLatestHiringStory([
      hit({ objectID: 'bad', created_at: 'not-a-date' }),
      hit({ objectID: 'good' }),
    ]);
    expect(picked).not.toBeNull();
  });
});

describe('fetchHnHiring — author-scoped query with fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const thread = {
    objectID: '48747976',
    title: 'Ask HN: Who is hiring? (July 2026)',
    created_at: '2026-07-01T15:00:00Z',
  };
  const tree = {
    id: 1,
    children: [{ id: 11, text: 'Acme | Engineer | Remote', created_at: '2026-07-01T16:00:00Z' }],
  };

  function stub(handler: (url: string) => Response) {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string | URL) => {
        urls.push(String(u));
        return handler(String(u));
      }),
    );
    return urls;
  }

  it('asks for the whoishiring account first and stops there when it finds the thread', async () => {
    const urls = stub((u) => (u.includes('/items/') ? json(tree) : json({ hits: [thread] })));
    const r = await fetchHnHiring();
    expect(urls[0]).toContain('author_whoishiring');
    expect(urls.filter((u) => u.includes('search_by_date'))).toHaveLength(1);
    expect(r.items).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('falls through to the wide free-text query when the author query finds nothing', async () => {
    const urls = stub((u) => {
      if (u.includes('/items/')) return json(tree);
      return u.includes('author_whoishiring') ? json({ hits: [] }) : json({ hits: [thread] });
    });
    const r = await fetchHnHiring();
    expect(urls.some((u) => u.includes('hitsPerPage=50'))).toBe(true);
    expect(r.items).toHaveLength(1);
  });

  it('falls through when the author query errors without flagging the source unhealthy', async () => {
    stub((u) => {
      if (u.includes('/items/')) return json(tree);
      return u.includes('author_whoishiring')
        ? new Response('boom', { status: 503 })
        : json({ hits: [thread] });
    });
    const r = await fetchHnHiring();
    expect(r.items).toHaveLength(1);
    // The fallback worked, so a failed primary must not raise the 🚨 banner.
    expect(r.errors).toEqual([]);
  });

  it('returns errors instead of throwing when no thread is found anywhere', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stub(() => json({ hits: [] }));
    const r = await fetchHnHiring();
    expect(r.items).toEqual([]);
    expect(r.errors.at(-1)).toMatch(/no matching "Who is hiring" story/);
  });
});
