import { describe, expect, it } from 'vitest';
import { normalizePersonio } from '../src/normalize.js';
import type { Job, RawPersonioPositionWithSlug } from '../src/types.js';

const FETCHED_AT = '2026-06-17T00:00:00.000Z';

function raw(overrides: Partial<RawPersonioPositionWithSlug> = {}): RawPersonioPositionWithSlug {
  return {
    __slug: 'userlane',
    id: '2577915',
    name: 'Senior Product Manager (data &amp; analytics)',
    office: 'Germany, Munich',
    department: 'Product &amp; UX',
    recruitingCategory: 'Product',
    employmentType: 'permanent',
    seniority: 'experienced',
    occupationCategory: 'it_software',
    createdAt: '2026-03-26T14:20:48+00:00',
    jobDescriptions: {
      jobDescription: [
        { name: 'About', value: { '#cdata': '<p>We are <strong>Userlane</strong>.</p>' } },
        { name: 'Your role', value: { '#cdata': '<ul><li>Own the roadmap</li></ul>' } },
      ],
    },
    ...overrides,
  };
}

function firstJob(overrides: Partial<RawPersonioPositionWithSlug> = {}): Job {
  const [job] = normalizePersonio([raw(overrides)], FETCHED_AT);
  if (!job) throw new Error('expected normalizePersonio to produce a job');
  return job;
}

describe('normalizePersonio', () => {
  it('builds the job URL from slug + id and decodes entity in the title', () => {
    const job = firstJob();
    expect(job).toMatchObject({
      source: 'personio',
      title: 'Senior Product Manager (data & analytics)', // &amp; decoded
      company: 'Userlane', // derived from the slug (feed has no clean company)
      url: 'https://userlane.jobs.personio.de/job/2577915',
      location: 'Germany, Munich',
      fetchedAt: FETCHED_AT,
    });
    expect(job.id).toMatch(/^[0-9a-f]{40}$/);
    expect(job.postedAt).toBe('2026-03-26T14:20:48.000Z');
    expect(job.salary).toBeNull();
  });

  it('concatenates description sections and strips their CDATA html', () => {
    const job = firstJob();
    expect(job.body).toContain('We are Userlane'); // section CDATA html stripped
    expect(job.body).toContain('Own the roadmap');
    expect(job.body).not.toContain('<strong>');
  });

  it('tags from department, category, seniority, type (entities decoded)', () => {
    const job = firstJob();
    expect(job.tags).toEqual(
      expect.arrayContaining(['Product & UX', 'experienced', 'permanent', 'it_software']),
    );
  });

  it('infers remote from a remote office string', () => {
    expect(firstJob({ office: 'Remote, Europe' }).remote).toBe(true);
    expect(firstJob({ office: 'Germany, Munich' }).remote).toBe(false);
  });

  it('handles a single (non-array) jobDescription', () => {
    const job = firstJob({
      jobDescriptions: { jobDescription: { name: 'Role', value: 'Plain text body' } },
    });
    expect(job.body).toContain('Plain text body');
  });

  it('skips positions missing an id or title', () => {
    const jobs = normalizePersonio(
      [raw({ id: undefined }), raw({ name: '   ' }), raw({ id: '999', name: 'Real Role' })],
      FETCHED_AT,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Real Role');
  });
});
