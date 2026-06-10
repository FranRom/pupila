import { describe, expect, it } from 'vitest';
import {
  buildBluedoorQueries,
  buildCoveredSlugs,
  isCoveredCompany,
  parseAtsUrl,
} from '../src/fetchers/bluedoor.js';
import { normalizeBluedoor } from '../src/normalize.js';
import type { Job, LocationProfile, RawBluedoorJob } from '../src/types.js';

const NOW = new Date('2026-06-10T00:00:00Z');

function loc(overrides: Partial<LocationProfile> = {}): LocationProfile {
  return {
    basedIn: 'Spain',
    workTypes: ['remote', 'hybrid'],
    acceptedRegions: ['Europe', 'EMEA'],
    excludeOutsideAcceptedRegions: true,
    ...overrides,
  };
}

describe('parseAtsUrl', () => {
  it('extracts provider + slug from a greenhouse boards URL', () => {
    expect(parseAtsUrl('https://boards.greenhouse.io/materialbank/jobs/7742177003')).toEqual({
      provider: 'greenhouse',
      slug: 'materialbank',
    });
  });

  it('handles the job-boards.greenhouse.io subdomain variant', () => {
    expect(parseAtsUrl('https://job-boards.greenhouse.io/atlassand/jobs/8571346002')).toEqual({
      provider: 'greenhouse',
      slug: 'atlassand',
    });
  });

  it('extracts a lever slug', () => {
    expect(parseAtsUrl('https://jobs.lever.co/binance/abc-123')).toEqual({
      provider: 'lever',
      slug: 'binance',
    });
  });

  it('extracts an ashby slug', () => {
    expect(parseAtsUrl('https://jobs.ashbyhq.com/ramp/some-job-id')).toEqual({
      provider: 'ashby',
      slug: 'ramp',
    });
  });

  it('lowercases the slug for stable matching', () => {
    expect(parseAtsUrl('https://boards.greenhouse.io/Coinbase/jobs/1')).toEqual({
      provider: 'greenhouse',
      slug: 'coinbase',
    });
  });

  it('returns null for a non-ATS provider URL (ADP, Taleo, …)', () => {
    expect(
      parseAtsUrl('https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html'),
    ).toBeNull();
  });

  it('returns null for empty / malformed input', () => {
    expect(parseAtsUrl('')).toBeNull();
    expect(parseAtsUrl('not a url')).toBeNull();
  });
});

describe('buildBluedoorQueries', () => {
  it('builds one query per accepted region with a 30-day lookback window', () => {
    const { queries } = buildBluedoorQueries(
      loc({ basedIn: '', acceptedRegions: ['Europe', 'EMEA'] }),
      {
        now: NOW,
      },
    );
    expect(queries).toEqual([
      { location_text: 'Europe', posted_after: '2026-05-11' },
      { location_text: 'EMEA', posted_after: '2026-05-11' },
    ]);
  });

  it('includes basedIn as a region term', () => {
    const { queries } = buildBluedoorQueries(
      loc({ basedIn: 'Germany', acceptedRegions: ['Europe'] }),
      {
        now: NOW,
      },
    );
    expect(queries.map((q) => q.location_text)).toEqual(['Europe', 'Germany']);
  });

  it('dedups region terms case-insensitively (basedIn already in acceptedRegions)', () => {
    const { queries } = buildBluedoorQueries(
      loc({ basedIn: 'spain', acceptedRegions: ['Europe', 'Spain'] }),
      { now: NOW },
    );
    expect(queries.map((q) => q.location_text)).toEqual(['Europe', 'Spain']);
  });

  it('honors a custom lookback window', () => {
    const { queries } = buildBluedoorQueries(loc({ basedIn: '', acceptedRegions: ['Europe'] }), {
      now: NOW,
      lookbackDays: 7,
    });
    expect(queries[0]?.posted_after).toBe('2026-06-03');
  });

  it('caps the number of queries to the request budget and reports the rest', () => {
    const regions = ['a', 'b', 'c', 'd', 'e'];
    const { queries, droppedRegions } = buildBluedoorQueries(
      loc({ basedIn: '', acceptedRegions: regions }),
      { now: NOW, maxQueries: 3 },
    );
    expect(queries).toHaveLength(3);
    expect(queries.map((q) => q.location_text)).toEqual(['a', 'b', 'c']);
    expect(droppedRegions).toBe(2);
  });

  it('returns no queries when there are no region terms (neutral/default profile)', () => {
    expect(buildBluedoorQueries(loc({ basedIn: '', acceptedRegions: [] }), { now: NOW })).toEqual({
      queries: [],
      droppedRegions: 0,
    });
  });

  it('returns no queries when there is no location block at all', () => {
    expect(buildBluedoorQueries(undefined, { now: NOW })).toEqual({
      queries: [],
      droppedRegions: 0,
    });
  });
});

describe('covered-company pre-skip', () => {
  const config = {
    ashby: ['ramp', 'Linear'],
    greenhouse: ['coinbase'],
    lever: ['binance'],
    ashbyPrivate: ['chainlink-labs'],
  };
  const covered = buildCoveredSlugs(config);

  it('skips a company already covered by its dedicated ATS fetcher', () => {
    expect(isCoveredCompany({ provider: 'greenhouse', slug: 'coinbase' }, covered)).toBe(true);
    expect(isCoveredCompany({ provider: 'lever', slug: 'binance' }, covered)).toBe(true);
  });

  it('treats ashbyPrivate slugs as covered ashby companies', () => {
    expect(isCoveredCompany({ provider: 'ashby', slug: 'chainlink-labs' }, covered)).toBe(true);
  });

  it('matches case-insensitively against the configured slug list', () => {
    expect(isCoveredCompany({ provider: 'ashby', slug: 'linear' }, covered)).toBe(true);
  });

  it('does not skip a long-tail company we do not fetch directly', () => {
    expect(isCoveredCompany({ provider: 'greenhouse', slug: 'materialbank' }, covered)).toBe(false);
  });

  it('does not skip when the URL was non-ATS (no ref)', () => {
    expect(isCoveredCompany(null, covered)).toBe(false);
  });

  it('does not cross providers (same slug, different ATS)', () => {
    expect(isCoveredCompany({ provider: 'lever', slug: 'coinbase' }, covered)).toBe(false);
  });
});

const FETCHED_AT = '2026-06-10T08:00:00.000Z';

function rawJob(overrides: Partial<RawBluedoorJob> = {}): RawBluedoorJob {
  return {
    job_id: 'job-1',
    org_id: '0034ebc9-0a4b-4010-ad53-dbdb68f19b65',
    provider: 'greenhouse',
    title: 'Senior Frontend Engineer',
    location_text: 'Remote - Europe',
    workplace_type: 'remote',
    remote_policy: 'remote',
    country: 'Germany',
    region: null,
    city: 'Berlin',
    salary_min: 120000,
    salary_max: 160000,
    salary_currency: 'EUR',
    salary_period: 'year',
    source_url: 'https://boards.greenhouse.io/materialbank/jobs/1',
    apply_url: 'https://boards.greenhouse.io/materialbank/jobs/1',
    source_posted_at: '2026-06-05T18:35:00.000Z',
    description_text: 'Build the design system in React. Remote across Europe.',
    ...overrides,
  };
}

// normalizeBluedoor maps each raw job to exactly one Job; assert + unwrap.
function one(jobs: Job[]): Job {
  expect(jobs).toHaveLength(1);
  const [job] = jobs;
  if (!job) throw new Error('expected exactly one normalized job');
  return job;
}

describe('normalizeBluedoor', () => {
  it('maps core fields and derives the company from the ATS URL slug', () => {
    const job = one(normalizeBluedoor([rawJob()], FETCHED_AT));
    expect(job.source).toBe('bluedoor');
    expect(job.title).toBe('Senior Frontend Engineer');
    expect(job.company).toBe('Materialbank');
    expect(job.url).toBe('https://boards.greenhouse.io/materialbank/jobs/1');
    expect(job.remote).toBe(true);
    expect(job.postedAt).toBe('2026-06-05T18:35:00.000Z');
    expect(job.fetchedAt).toBe(FETCHED_AT);
  });

  it('falls back to org_id as the company for non-ATS providers (no name shipped)', () => {
    const job = one(
      normalizeBluedoor(
        [
          rawJob({
            provider: 'adp_workforcenow',
            org_id: 'org-abc',
            source_url:
              'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html',
            apply_url:
              'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html',
          }),
        ],
        FETCHED_AT,
      ),
    );
    // ensures two different employers never collapse to one in company+title dedup
    expect(job.company).toBe('org-abc');
  });

  it('annualizes salary by period so cross-period sorting is sane', () => {
    const job = one(
      normalizeBluedoor(
        [
          rawJob({
            salary_min: 80,
            salary_max: 100,
            salary_currency: 'USD',
            salary_period: 'hour',
          }),
        ],
        FETCHED_AT,
      ),
    );
    expect(job.salaryMin).toBe(80 * 2080);
    expect(job.salaryMax).toBe(100 * 2080);
    expect(job.salaryCurrency).toBe('USD');
  });

  it('leaves salary null when the source has no numbers', () => {
    const job = one(
      normalizeBluedoor(
        [rawJob({ salary_min: null, salary_max: null, salary_currency: null })],
        FETCHED_AT,
      ),
    );
    expect(job.salary).toBeNull();
    expect(job.salaryMin).toBeNull();
  });

  it('keeps region signals from a messy multi-region location_text matchable in the body', () => {
    const messy =
      'North Europe / Scandinavia, Sweden; Europe, France; North America, Canada; Asia - Pacific, Philippines';
    const job = one(
      normalizeBluedoor([rawJob({ location_text: messy, workplace_type: null })], FETCHED_AT),
    );
    expect(job.body.toLowerCase()).toContain('europe');
    expect(job.body.toLowerCase()).toContain('react'); // original description still present
  });

  it('detects remote from location_text even when workplace_type is null', () => {
    const job = one(
      normalizeBluedoor(
        [
          rawJob({
            workplace_type: null,
            remote_policy: null,
            location_text: 'Remote - Worldwide',
          }),
        ],
        FETCHED_AT,
      ),
    );
    expect(job.remote).toBe(true);
  });

  it('gives the same id to the same job url across runs', () => {
    const a = one(normalizeBluedoor([rawJob()], FETCHED_AT));
    const b = one(normalizeBluedoor([rawJob()], '2026-06-11T08:00:00.000Z'));
    expect(a.id).toBe(b.id);
  });
});
