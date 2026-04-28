import { describe, expect, it } from 'vitest';
import { dedupe } from '../src/dedup.js';
import type { Job, Source } from '../src/types.js';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'a',
    source: 'greenhouse',
    title: 'Senior Engineer',
    company: 'Acme',
    url: 'https://example.com/a',
    location: null,
    remote: true,
    body: '',
    tags: [],
    salary: null,
    postedAt: null,
    fetchedAt: '2026-04-28T00:00:00Z',
    fitScore: 50,
    category: 'general',
    ...overrides,
  };
}

describe('dedupe', () => {
  it('collapses jobs with identical id', () => {
    const r = dedupe([makeJob({ id: 'x' }), makeJob({ id: 'x' })]);
    expect(r.kept).toHaveLength(1);
    expect(r.removedById).toBe(1);
  });

  it('collapses jobs with same normalized company+title', () => {
    const r = dedupe([
      makeJob({ id: 'x', company: 'Acme', title: 'Senior Engineer' }),
      makeJob({ id: 'y', company: 'ACME', title: 'senior engineer!' }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.removedByTitle).toBe(1);
  });

  it('keeps the higher fitScore on collision', () => {
    const r = dedupe([
      makeJob({ id: 'x', fitScore: 60, source: 'remoteok' }),
      makeJob({ id: 'y', fitScore: 90, source: 'weworkremotely' }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.fitScore).toBe(90);
  });

  it('breaks ties by source priority (ashby > greenhouse > remoteok)', () => {
    const cases: [Source, Source, Source][] = [
      ['ashby', 'greenhouse', 'ashby'],
      ['greenhouse', 'remoteok', 'greenhouse'],
      ['lever', 'web3career', 'lever'],
    ];
    for (const [a, b, winner] of cases) {
      const r = dedupe([
        makeJob({ id: 'x', source: a, fitScore: 50 }),
        makeJob({ id: 'y', source: b, fitScore: 50 }),
      ]);
      expect(r.kept[0]?.source).toBe(winner);
    }
  });

  it('returns empty result for empty input', () => {
    const r = dedupe([]);
    expect(r.kept).toHaveLength(0);
    expect(r.removedById).toBe(0);
    expect(r.removedByTitle).toBe(0);
  });
});
