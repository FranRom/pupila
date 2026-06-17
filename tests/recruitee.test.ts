import { describe, expect, it } from 'vitest';
import { normalizeRecruitee } from '../src/normalize.js';
import type { Job, RawRecruiteeOfferWithSlug } from '../src/types.js';

const FETCHED_AT = '2026-06-17T00:00:00.000Z';

function raw(overrides: Partial<RawRecruiteeOfferWithSlug> = {}): RawRecruiteeOfferWithSlug {
  return {
    __slug: 'bunq',
    id: 1557,
    title: 'Senior Backend Engineer',
    company_name: 'bunq',
    careers_url: 'https://careers.bunq.com/o/senior-backend-engineer',
    careers_apply_url: 'https://careers.bunq.com/o/senior-backend-engineer/c/new',
    location: 'Amsterdam, Noord-Holland, Netherlands',
    city: 'Amsterdam',
    country: 'Netherlands',
    remote: false,
    hybrid: true,
    on_site: false,
    salary: { min: '75000', max: '95000', currency: 'EUR', period: 'year' },
    department: 'Engineering',
    employment_type_code: 'fulltime_permanent',
    tags: ['golang'],
    description: '<p>Build banking systems.</p>',
    requirements: '<p>5y experience.</p>',
    published_at: '2026-06-16 15:41:49 UTC',
    slug: 'senior-backend-engineer',
    ...overrides,
  };
}

function firstJob(overrides: Partial<RawRecruiteeOfferWithSlug> = {}): Job {
  const [job] = normalizeRecruitee([raw(overrides)], FETCHED_AT);
  if (!job) throw new Error('expected normalizeRecruitee to produce a job');
  return job;
}

describe('normalizeRecruitee', () => {
  it('maps core fields, prefers careers_url, parses the UTC date', () => {
    const job = firstJob();
    expect(job).toMatchObject({
      source: 'recruitee',
      title: 'Senior Backend Engineer',
      company: 'bunq',
      url: 'https://careers.bunq.com/o/senior-backend-engineer',
      location: 'Amsterdam, Noord-Holland, Netherlands',
      fetchedAt: FETCHED_AT,
    });
    expect(job.id).toMatch(/^[0-9a-f]{40}$/);
    // description + requirements concatenated, HTML stripped
    expect(job.body).toContain('Build banking systems.');
    expect(job.body).toContain('5y experience.');
    expect(job.postedAt).toBe('2026-06-16T15:41:49.000Z');
  });

  it('flags only fully-remote offers and tags the work type', () => {
    expect(firstJob({ remote: true, hybrid: false }).remote).toBe(true);
    const hybrid = firstJob({ remote: false, hybrid: true });
    expect(hybrid.remote).toBe(false);
    expect(hybrid.tags).toContain('hybrid');
    expect(firstJob({ remote: false, hybrid: false, on_site: true }).tags).toContain('on-site');
  });

  it('coerces string salary and annualizes by period', () => {
    expect(firstJob().salary).toBe('75K-95K EUR'); // year -> as-is
    expect(firstJob().salaryMin).toBe(75000);
    // monthly figures annualize x12
    const monthly = firstJob({
      salary: { min: '5000', max: '6000', currency: 'EUR', period: 'month' },
    });
    expect(monthly.salaryMin).toBe(60000);
    expect(monthly.salaryMax).toBe(72000);
  });

  it('leaves salary null when min/max are absent or non-numeric', () => {
    expect(
      firstJob({ salary: { min: null, max: null, currency: null, period: null } }).salary,
    ).toBeNull();
    expect(firstJob({ salary: null }).salaryMin).toBeNull();
  });

  it('falls back to a slug-derived company and city/country location', () => {
    const job = firstJob({
      __slug: 'technicaengineeringgmbh',
      company_name: null,
      location: null,
      city: 'Munich',
      country: 'Germany',
    });
    expect(job.company).toBe('Technicaengineeringgmbh');
    expect(job.location).toBe('Munich, Germany');
  });

  it('skips offers missing a url or title', () => {
    const jobs = normalizeRecruitee(
      [
        raw({ careers_url: null, careers_apply_url: null }),
        raw({ title: '  ' }),
        raw({ title: 'Real Job', careers_url: 'https://careers.bunq.com/o/real' }),
      ],
      FETCHED_AT,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Real Job');
  });
});
