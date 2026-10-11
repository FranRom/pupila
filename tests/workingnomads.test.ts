import { describe, expect, it } from 'vitest';
import { normalizeWorkingNomads } from '../src/normalize.js';
import type { Job, RawWorkingNomads } from '../src/types.js';

const FETCHED_AT = '2026-07-28T00:00:00.000Z';

// Shape taken verbatim from a live response of
// https://www.workingnomads.com/api/exposed_jobs/ — every field is a string,
// `tags` is comma-separated, `description` is HTML, `location` is a free-text
// region list, and there is no id field.
function raw(overrides: Partial<RawWorkingNomads> = {}): RawWorkingNomads {
  return {
    url: 'https://www.workingnomads.com/job/go/1750002/',
    title: 'Senior AI Engineer',
    description: '<p>Build agent systems.</p><p>Salary: $150,000 - $190,000 USD</p>',
    company_name: 'Acme',
    category_name: 'Development',
    tags: 'llm,langchain, python ,',
    location: 'Europe, North America, Latin America, APAC',
    pub_date: '2026-07-24T07:53:58-04:00',
    ...overrides,
  };
}

function firstJob(overrides: Partial<RawWorkingNomads> = {}): Job {
  const [job] = normalizeWorkingNomads([raw(overrides)], FETCHED_AT);
  if (!job) throw new Error('expected normalizeWorkingNomads to produce a job');
  return job;
}

describe('normalizeWorkingNomads', () => {
  it('maps the core fields and forces remote true', () => {
    const job = firstJob();
    expect(job).toMatchObject({
      source: 'workingnomads',
      title: 'Senior AI Engineer',
      company: 'Acme',
      url: 'https://www.workingnomads.com/job/go/1750002/',
      location: 'Europe, North America, Latin America, APAC',
      remote: true,
      fetchedAt: FETCHED_AT,
      fitScore: 0,
    });
  });

  it('strips HTML from the body before it can reach a filter regex', () => {
    const job = firstJob();
    expect(job.body).not.toMatch(/<[a-z][\s\S]*>/i);
    expect(job.body).toContain('Build agent systems.');
  });

  it('preserves the multi-region location string the geo filter reads', () => {
    expect(firstJob({ location: 'Global' }).location).toBe('Global');
    expect(firstJob({ location: '  Remote, Canada  ' }).location).toBe('Remote, Canada');
    expect(firstJob({ location: '' }).location).toBeNull();
    expect(firstJob({ location: undefined }).location).toBeNull();
  });

  it('splits the comma-separated tag string and drops blanks', () => {
    const job = firstJob();
    expect(job.tags).toContain('llm');
    expect(job.tags).toContain('langchain');
    expect(job.tags).toContain('python');
    expect(job.tags).toContain('Development');
    expect(job.tags).not.toContain('');
  });

  it('parses a salary out of the body when the board states one', () => {
    const job = firstJob();
    expect(job.salaryMin).toBe(150000);
    expect(job.salaryMax).toBe(190000);
    expect(job.salaryCurrency).toBe('USD');
  });

  it('leaves the salary quartet null when the body states none', () => {
    const job = firstJob({ description: '<p>Build agent systems. No numbers here.</p>' });
    expect(job.salary).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.salaryCurrency).toBeNull();
  });

  it('normalizes pub_date to ISO', () => {
    expect(firstJob().postedAt).toBe('2026-07-24T11:53:58.000Z');
    expect(firstJob({ pub_date: undefined }).postedAt).toBeNull();
  });

  it('drops rows missing a url or a title rather than emitting a broken job', () => {
    expect(normalizeWorkingNomads([raw({ url: undefined })], FETCHED_AT)).toHaveLength(0);
    expect(normalizeWorkingNomads([raw({ title: undefined })], FETCHED_AT)).toHaveLength(0);
    expect(normalizeWorkingNomads([raw({ url: '   ' })], FETCHED_AT)).toHaveLength(0);
  });

  it('derives a stable id from the url', () => {
    expect(firstJob().id).toBe(firstJob().id);
    expect(firstJob().id).not.toBe(firstJob({ url: 'https://www.workingnomads.com/job/go/1/' }).id);
  });

  it('handles an empty feed without throwing', () => {
    expect(normalizeWorkingNomads([], FETCHED_AT)).toEqual([]);
  });
});
