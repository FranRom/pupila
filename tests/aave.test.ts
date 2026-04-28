import { describe, expect, it } from 'vitest';
import { parseAaveHtml } from '../src/fetchers/aave.js';
import { normalizeAave } from '../src/normalize.js';
import type { RawAavePost } from '../src/types.js';

const FIXTURE_POSTS: RawAavePost[] = [
  {
    id: '47be1573-6daa-468c-b765-c75069de33d7',
    slug: 'staff-design-engineer-47be1573-6daa-468c-b765-c75069de33d7',
    title: 'Staff Design Engineer',
    summary: 'Lead our design engineering practice.',
    description:
      '#### How you can make an impact:\n- Build the design system\n- Ship React components',
    team: 'Design',
    department: null,
    location: 'Remote, US',
    commitment: 'Full-time',
    workplaceType: 'remote',
  },
  {
    id: '8d4c6dd8-6246-4c22-a0f3-968b0f46cb9f',
    slug: 'sales-engineer-8d4c6dd8-6246-4c22-a0f3-968b0f46cb9f',
    title: 'Sales Engineer',
    summary: 'Be our customer-facing engineer.',
    description: 'Help close enterprise deals.',
    team: 'Business Development',
    department: null,
    location: 'London, England',
    commitment: 'Full-time',
    workplaceType: 'hybrid',
  },
];

function buildFixtureHtml(posts: RawAavePost[]): string {
  const next = { props: { pageProps: { posts } } };
  return `<!DOCTYPE html><html><head><title>Careers | Aave</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
}

describe('parseAaveHtml', () => {
  it('extracts posts from __NEXT_DATA__ blob', () => {
    const html = buildFixtureHtml(FIXTURE_POSTS);
    const posts = parseAaveHtml(html);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.title).toBe('Staff Design Engineer');
    expect(posts[1]?.title).toBe('Sales Engineer');
  });

  it('returns empty array when __NEXT_DATA__ is missing', () => {
    const html = '<html><body>No next data here</body></html>';
    expect(parseAaveHtml(html)).toEqual([]);
  });

  it('returns empty array when JSON is malformed', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{not valid json}</script>';
    expect(parseAaveHtml(html)).toEqual([]);
  });

  it('returns empty array when posts key is absent', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>';
    expect(parseAaveHtml(html)).toEqual([]);
  });
});

describe('normalizeAave', () => {
  const fetchedAt = '2026-04-28T07:00:00Z';

  it('converts a remote role to a Job with remote=true', () => {
    const [job] = normalizeAave([FIXTURE_POSTS[0] as RawAavePost], fetchedAt);
    expect(job).toBeDefined();
    if (!job) return;
    expect(job.source).toBe('aave');
    expect(job.company).toBe('Aave');
    expect(job.title).toBe('Staff Design Engineer');
    expect(job.url).toBe(
      'https://aave.com/careers/staff-design-engineer-47be1573-6daa-468c-b765-c75069de33d7',
    );
    expect(job.remote).toBe(true);
    expect(job.location).toBe('Remote, US');
    expect(job.body).toMatch(/Build the design system/);
    expect(job.tags).toContain('Design');
    expect(job.tags).toContain('Full-time');
    expect(job.postedAt).toBeNull();
  });

  it('marks hybrid roles as non-remote', () => {
    const [job] = normalizeAave([FIXTURE_POSTS[1] as RawAavePost], fetchedAt);
    expect(job?.remote).toBe(false);
    expect(job?.location).toBe('London, England');
  });

  it('produces a stable id from the slug-based URL', () => {
    const [a] = normalizeAave([FIXTURE_POSTS[0] as RawAavePost], fetchedAt);
    const [b] = normalizeAave([FIXTURE_POSTS[0] as RawAavePost], fetchedAt);
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toMatch(/^[0-9a-f]{40}$/);
  });
});
