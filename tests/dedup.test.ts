import { describe, expect, it } from 'vitest';
import { compareJobs, dedupe } from '../src/dedup.js';
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
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    fetchedAt: '2026-04-28T00:00:00Z',
    fitScore: 50,
    categories: [],
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
      // bluedoor is lowest priority: on a company+title overlap with any curated
      // source, the curated copy wins (bluedoor re-carries other ATS jobs).
      ['greenhouse', 'bluedoor', 'greenhouse'],
      ['remoteok', 'bluedoor', 'remoteok'],
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

describe('compareJobs', () => {
  it('orders by fitScore desc as the primary key', () => {
    const a = makeJob({ id: 'a', fitScore: 80 });
    const b = makeJob({ id: 'b', fitScore: 60 });
    expect([b, a].sort(compareJobs).map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('breaks fitScore ties by salaryMax desc', () => {
    const a = makeJob({ id: 'a', fitScore: 70, salaryMax: 200_000 });
    const b = makeJob({ id: 'b', fitScore: 70, salaryMax: 150_000 });
    expect([b, a].sort(compareJobs).map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('treats null salaryMax as 0 so unstated comp sinks below stated comp', () => {
    const stated = makeJob({ id: 'stated', fitScore: 70, salaryMax: 100_000 });
    const unstated = makeJob({ id: 'unstated', fitScore: 70, salaryMax: null });
    expect([unstated, stated].sort(compareJobs).map((j) => j.id)).toEqual(['stated', 'unstated']);
  });

  it('falls back to postedAt desc when fitScore and salaryMax tie', () => {
    const newer = makeJob({
      id: 'newer',
      fitScore: 70,
      salaryMax: 100_000,
      postedAt: '2026-04-28T00:00:00Z',
    });
    const older = makeJob({
      id: 'older',
      fitScore: 70,
      salaryMax: 100_000,
      postedAt: '2026-04-01T00:00:00Z',
    });
    expect([older, newer].sort(compareJobs).map((j) => j.id)).toEqual(['newer', 'older']);
  });

  it('uses id asc as the final deterministic tiebreak', () => {
    const a = makeJob({ id: 'aaa', fitScore: 70, salaryMax: 100_000, postedAt: null });
    const b = makeJob({ id: 'bbb', fitScore: 70, salaryMax: 100_000, postedAt: null });
    expect([b, a].sort(compareJobs).map((j) => j.id)).toEqual(['aaa', 'bbb']);
  });
});
