import { describe, expect, it } from 'vitest';
import { renderFeed } from '../src/feed.js';
import type { Job } from '../src/types.js';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'abc123',
    source: 'ashby',
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    url: 'https://example.com/jobs/123',
    location: 'Remote',
    remote: true,
    body: '',
    tags: [],
    salary: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: '2026-04-28T00:00:00Z',
    fetchedAt: '2026-04-28T00:00:00Z',
    fitScore: 88,
    category: 'ai',
    ...overrides,
  };
}

describe('renderFeed', () => {
  it('emits valid RSS 2.0 with channel metadata', () => {
    const xml = renderFeed([], '2026-04-28T07:00:00Z');
    expect(xml).toMatch(/<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toMatch(/<rss version="2\.0">/);
    expect(xml).toMatch(/<channel>/);
    expect(xml).toMatch(/<title>job-hunt — new matches<\/title>/);
  });

  it('renders one item per job with title containing fit score', () => {
    const xml = renderFeed([makeJob()], '2026-04-28T07:00:00Z');
    expect(xml).toMatch(/<item>/);
    expect(xml).toMatch(/\[88\] Senior Frontend Engineer — Acme/);
    expect(xml).toMatch(/<link>https:\/\/example\.com\/jobs\/123<\/link>/);
    expect(xml).toMatch(/<guid isPermaLink="false">abc123<\/guid>/);
  });

  it('escapes ampersands and angle brackets in titles', () => {
    const xml = renderFeed(
      [makeJob({ title: 'Senior <Engineer> & Lead', company: 'A&B' })],
      '2026-04-28T07:00:00Z',
    );
    expect(xml).toMatch(/&lt;Engineer&gt;/);
    expect(xml).toMatch(/&amp;/);
    expect(xml).not.toMatch(/<Engineer>/);
  });

  it('caps items at 50 even with larger input', () => {
    const jobs = Array.from({ length: 200 }, (_, i) =>
      makeJob({ id: `id-${i}`, fitScore: 100 - i }),
    );
    const xml = renderFeed(jobs, '2026-04-28T07:00:00Z');
    expect(xml.match(/<item>/g)?.length).toBe(50);
  });

  it('sorts items by fitScore descending', () => {
    const xml = renderFeed(
      [
        makeJob({ id: 'low', fitScore: 30, title: 'Low' }),
        makeJob({ id: 'high', fitScore: 90, title: 'High' }),
        makeJob({ id: 'mid', fitScore: 60, title: 'Mid' }),
      ],
      '2026-04-28T07:00:00Z',
    );
    const highIdx = xml.indexOf('High');
    const midIdx = xml.indexOf('Mid');
    const lowIdx = xml.indexOf('Low');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('includes salary when present', () => {
    const xml = renderFeed([makeJob({ salary: '$120K-$180K' })], '2026-04-28T07:00:00Z');
    expect(xml).toMatch(/💰 \$120K-\$180K/);
  });
});
