import { describe, expect, it } from 'vitest';
import { normalizeAiJobsNet } from '../src/normalize.js';
import type { RawAiJobs } from '../src/types.js';

const fetchedAt = '2026-07-29T00:00:00Z';

function makeRaw(overrides: Partial<RawAiJobs> = {}): RawAiJobs {
  return {
    id: 'abc123',
    url: 'https://aijobs.net/job/example-123/',
    title: 'Senior AI Engineer',
    salary: null,
    tags: [],
    seniority: 'Senior-level',
    companyAndLocation: null,
    postedRelative: null,
    ...overrides,
  };
}

// Regression: `company` used to be populated from this field via a
// capital-letter-boundary split heuristic that, on ~215 real fetched
// postings sampled across three days, never once produced a real company
// name — every sample was purely location/office info. `company` is now
// always null for this source; the whole cleaned field is the location.
describe('normalizeAiJobsNet', () => {
  it('treats the field as location only, never company — plain "City, Country"', () => {
    const [j] = normalizeAiJobsNet(
      [makeRaw({ companyAndLocation: 'Full Time Hyderabad, India' })],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
    expect(j?.location).toBe('Hyderabad, India');
  });

  it('treats the field as location only — "City, Country-code, Postal"', () => {
    const [j] = normalizeAiJobsNet(
      [makeRaw({ companyAndLocation: 'Full Time Carnaxide, PT, 2790-012' })],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
    expect(j?.location).toBe('Carnaxide, PT, 2790-012');
  });

  it('treats an office/campus-name shape as location only, not company', () => {
    const [j] = normalizeAiJobsNet(
      [makeRaw({ companyAndLocation: 'Full Time Headquarters - Chevy Chase, MD' })],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
    expect(j?.location).toBe('Headquarters - Chevy Chase, MD');
  });

  it('strips the leading employment-type token before treating the rest as location', () => {
    const [j] = normalizeAiJobsNet(
      [makeRaw({ companyAndLocation: 'Contract Freelance Remote' })],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
    expect(j?.location).toBe('Freelance Remote');
  });

  it('returns null company and location when the field is absent', () => {
    const [j] = normalizeAiJobsNet([makeRaw({ companyAndLocation: null })], fetchedAt);
    expect(j?.company).toBeNull();
    expect(j?.location).toBeNull();
  });
});
