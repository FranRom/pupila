import { describe, expect, it } from 'vitest';
import { normalizeHimalayas } from '../src/normalize.js';
import type { Job, RawHimalayas } from '../src/types.js';

const FETCHED_AT = '2026-06-17T00:00:00.000Z';

function raw(overrides: Partial<RawHimalayas> = {}): RawHimalayas {
  return {
    title: 'Staff Backend Engineer',
    companyName: 'Stewart',
    companySlug: 'stewart',
    employmentType: 'Full Time',
    seniority: ['Senior'],
    minSalary: 157900,
    maxSalary: 236900,
    currency: 'USD',
    salaryPeriod: 'annual',
    locationRestrictions: ['United States'],
    categories: ['Backend', 'Platform'],
    description: '<p>Build things.</p>',
    pubDate: 1781675331,
    applicationLink: 'https://himalayas.app/companies/stewart/jobs/staff-backend-engineer',
    guid: 'https://himalayas.app/companies/stewart/jobs/staff-backend-engineer',
    ...overrides,
  };
}

function firstJob(overrides: Partial<RawHimalayas> = {}): Job {
  const [job] = normalizeHimalayas([raw(overrides)], FETCHED_AT);
  if (!job) throw new Error('expected normalizeHimalayas to produce a job');
  return job;
}

describe('normalizeHimalayas', () => {
  it('maps core fields, forces remote, and decodes epoch-seconds pubDate', () => {
    const job = firstJob();
    expect(job).toMatchObject({
      source: 'himalayas',
      title: 'Staff Backend Engineer',
      company: 'Stewart',
      url: 'https://himalayas.app/companies/stewart/jobs/staff-backend-engineer',
      location: 'United States',
      remote: true,
      fetchedAt: FETCHED_AT,
    });
    expect(job.id).toMatch(/^[0-9a-f]{40}$/);
    expect(job.body).toBe('Build things.');
    // 1781675331s -> 2026-06-17T...Z (epoch seconds, not ms)
    expect(job.postedAt).toBe(new Date(1781675331 * 1000).toISOString());
  });

  it('joins multi-country restrictions into the location string', () => {
    const job = firstJob({ locationRestrictions: ['Germany', 'United Kingdom', 'Portugal'] });
    expect(job.location).toBe('Germany, United Kingdom, Portugal');
  });

  it('treats an empty restriction list as Worldwide', () => {
    const job = firstJob({ locationRestrictions: [] });
    expect(job.location).toBe('Worldwide');
  });

  it('annualizes structured salary across periods', () => {
    expect(firstJob({ salaryPeriod: 'annual', minSalary: 100000, maxSalary: 150000 }).salary).toBe(
      '100K-150K USD',
    );
    // hourly -> annualized via SALARY_PERIOD_FACTOR (x2080)
    const hourly = firstJob({
      salaryPeriod: 'hourly',
      minSalary: 50,
      maxSalary: 75,
      currency: 'USD',
    });
    expect(hourly.salaryMin).toBe(104000);
    expect(hourly.salaryMax).toBe(156000);
  });

  it('leaves salary null when the listing carries no compensation', () => {
    const job = firstJob({ minSalary: undefined, maxSalary: undefined });
    expect(job.salary).toBeNull();
    expect(job.salaryMin).toBeNull();
  });

  it('tags from categories, seniority and employment type', () => {
    const job = firstJob({
      categories: ['Backend'],
      seniority: ['Senior', 'Manager'],
      employmentType: 'Full Time',
    });
    expect(job.tags).toEqual(expect.arrayContaining(['Backend', 'Senior', 'Manager', 'Full Time']));
  });

  it('skips records missing a url or title', () => {
    const jobs = normalizeHimalayas(
      [
        raw({ applicationLink: '' }),
        raw({ title: '  ' }),
        raw({ applicationLink: 'https://himalayas.app/companies/ok/jobs/real', title: 'Real Job' }),
      ],
      FETCHED_AT,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Real Job');
  });
});
