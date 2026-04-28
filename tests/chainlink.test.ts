import { describe, expect, it } from 'vitest';
import { parseDetailResponse, parseListResponse } from '../src/fetchers/chainlink.js';
import { normalizeChainlink } from '../src/normalize.js';
import type { RawChainlinkBrief, RawChainlinkDetail, RawChainlinkJob } from '../src/types.js';

describe('parseListResponse', () => {
  it('returns empty when errors are present', () => {
    expect(parseListResponse({ errors: [{ message: 'oops' }] })).toEqual([]);
  });

  it('returns empty when data shape is unexpected', () => {
    expect(parseListResponse({})).toEqual([]);
    expect(parseListResponse({ data: {} })).toEqual([]);
    expect(parseListResponse({ data: { jobBoard: {} } })).toEqual([]);
  });

  it('extracts jobPostings array', () => {
    const briefs: RawChainlinkBrief[] = [
      {
        id: 'a',
        title: 'Senior Frontend Engineer',
        locationName: 'Remote',
        workplaceType: 'Remote',
      },
      {
        id: 'b',
        title: 'Smart Contract Engineer',
        locationName: 'Toronto',
        workplaceType: 'Hybrid',
      },
    ];
    const out = parseListResponse({ data: { jobBoard: { jobPostings: briefs } } });
    expect(out).toEqual(briefs);
  });
});

describe('parseDetailResponse', () => {
  it('returns null on error or missing data', () => {
    expect(parseDetailResponse({ errors: [{ message: 'x' }] })).toBeNull();
    expect(parseDetailResponse({})).toBeNull();
    expect(parseDetailResponse({ data: {} })).toBeNull();
  });

  it('extracts the jobPosting object', () => {
    const detail: RawChainlinkDetail = {
      id: 'a',
      title: 'Senior Frontend Engineer',
      descriptionHtml: '<p>React + TypeScript on Chainlink data products.</p>',
      workplaceType: 'Remote',
      locationName: 'Remote',
      publishedDate: '2026-04-01T00:00:00Z',
      teamNames: ['Frontend'],
      departmentName: 'Engineering',
    };
    expect(parseDetailResponse({ data: { jobPosting: detail } })).toEqual(detail);
  });
});

describe('normalizeChainlink', () => {
  const fetchedAt = '2026-04-28T07:00:00Z';

  it('produces a Job with company=Chainlink Labs and stripped HTML body', () => {
    const item: RawChainlinkJob = {
      id: 'fc4b9935-1b07-4e44-b2cf-1d10551542ca',
      title: 'Senior Frontend Engineer',
      workplaceType: 'Remote',
      locationName: 'Remote',
      detail: {
        id: 'fc4b9935-1b07-4e44-b2cf-1d10551542ca',
        title: 'Senior Frontend Engineer',
        descriptionHtml:
          '<p><strong>About</strong> Chainlink — react, typescript, design systems.</p>',
        workplaceType: 'Remote',
        locationName: 'Remote',
        publishedDate: '2026-04-01T00:00:00Z',
        teamNames: ['Frontend'],
        departmentName: 'Engineering',
        compensationTierSummary: '$180K - $220K',
      },
    };
    const [job] = normalizeChainlink([item], fetchedAt);
    expect(job).toBeDefined();
    if (!job) return;
    expect(job.source).toBe('chainlink');
    expect(job.company).toBe('Chainlink Labs');
    expect(job.title).toBe('Senior Frontend Engineer');
    expect(job.url).toBe(
      'https://jobs.ashbyhq.com/chainlink-labs/fc4b9935-1b07-4e44-b2cf-1d10551542ca',
    );
    expect(job.remote).toBe(true);
    expect(job.location).toBe('Remote');
    expect(job.body).toMatch(/react.*typescript.*design systems/i);
    expect(job.body).not.toMatch(/<p>|<strong>/);
    expect(job.salary).toBe('$180K - $220K');
    expect(job.salaryMin).toBe(180_000);
    expect(job.salaryMax).toBe(220_000);
    expect(job.postedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(job.tags).toContain('Frontend');
  });

  it('falls back to brief data when detail is null', () => {
    const item: RawChainlinkJob = {
      id: 'b',
      title: 'Backend Engineer',
      workplaceType: 'Hybrid',
      locationName: 'New York',
      detail: null,
    };
    const [job] = normalizeChainlink([item], fetchedAt);
    expect(job?.title).toBe('Backend Engineer');
    expect(job?.remote).toBe(false);
    expect(job?.location).toBe('New York');
    expect(job?.body).toBe('');
    expect(job?.postedAt).toBeNull();
  });

  it('produces stable id from posting id', () => {
    const item: RawChainlinkJob = { id: 'abc', title: 'T', detail: null };
    const [a] = normalizeChainlink([item], fetchedAt);
    const [b] = normalizeChainlink([item], fetchedAt);
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toMatch(/^[0-9a-f]{40}$/);
  });
});
