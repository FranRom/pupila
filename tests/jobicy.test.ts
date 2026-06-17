import { describe, expect, it } from 'vitest';
import { normalizeJobicy } from '../src/normalize.js';
import type { Job, RawJobicy } from '../src/types.js';

const FETCHED_AT = '2026-06-17T00:00:00.000Z';

function raw(overrides: Partial<RawJobicy> = {}): RawJobicy {
  return {
    id: 146883,
    url: 'https://jobicy.com/jobs/146883-senior-backend-engineer',
    jobSlug: '146883-senior-backend-engineer',
    jobTitle: 'Senior Backend Engineer',
    companyName: 'Acme',
    jobIndustry: ['Software Engineering'],
    jobType: ['Full-Time'],
    jobGeo: 'Europe',
    jobLevel: 'Senior',
    jobExcerpt: 'short excerpt',
    jobDescription: '<p>Build things.</p>',
    pubDate: '2026-06-16T07:07:22+00:00',
    ...overrides,
  };
}

function firstJob(overrides: Partial<RawJobicy> = {}): Job {
  const [job] = normalizeJobicy([raw(overrides)], FETCHED_AT);
  if (!job) throw new Error('expected normalizeJobicy to produce a job');
  return job;
}

describe('normalizeJobicy', () => {
  it('maps the core fields and forces remote true', () => {
    const job = firstJob();
    expect(job).toMatchObject({
      source: 'jobicy',
      title: 'Senior Backend Engineer',
      company: 'Acme',
      url: 'https://jobicy.com/jobs/146883-senior-backend-engineer',
      location: 'Europe',
      remote: true,
      fetchedAt: FETCHED_AT,
      fitScore: 0,
    });
    expect(job.id).toMatch(/^[0-9a-f]{40}$/);
    expect(job.body).toBe('Build things.');
    expect(job.postedAt).toBe('2026-06-16T07:07:22.000Z');
  });

  it('keeps jobGeo verbatim (multi-region) so the geo filter can match', () => {
    const job = firstJob({ jobGeo: 'Europe,  Netherlands,  Spain' });
    expect(job.location).toBe('Europe,  Netherlands,  Spain');
  });

  it('annualizes and formats structured salary when present', () => {
    const job = firstJob({
      salaryMin: 78000,
      salaryMax: 156000,
      salaryCurrency: 'USD',
      salaryPeriod: 'yearly',
    });
    expect(job.salaryMin).toBe(78000);
    expect(job.salaryMax).toBe(156000);
    expect(job.salaryCurrency).toBe('USD');
    expect(job.salary).toBe('78K-156K USD');
  });

  it('leaves salary null when the listing carries no compensation', () => {
    const job = firstJob();
    expect(job.salary).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
  });

  it('decodes HTML entities in industry/type tags and includes the level', () => {
    const job = firstJob({
      jobIndustry: ['Legal &amp; Compliance'],
      jobType: ['Full-Time'],
      jobLevel: 'Director',
    });
    expect(job.tags).toContain('Legal & Compliance');
    expect(job.tags).toContain('Full-Time');
    expect(job.tags).toContain('Director');
  });

  it('skips records missing a url or title', () => {
    const jobs = normalizeJobicy(
      [
        raw({ url: '' }),
        raw({ jobTitle: '   ' }),
        raw({ id: 1, url: 'https://jobicy.com/jobs/1-ok', jobTitle: 'Real Job' }),
      ],
      FETCHED_AT,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Real Job');
  });
});
