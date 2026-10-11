import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFilters, type FilterProfile } from '../src/filters.js';
import type { Job } from '../src/types.js';
import testProfile from './fixtures/test-profile.json' with { type: 'json' };

// Candidate in Thailand (UTC+7), worldwide-remote accepted.
const profile = {
  ...(testProfile as FilterProfile),
  location: {
    basedIn: 'Thailand',
    workTypes: ['remote'],
    acceptedRegions: ['worldwide', 'anywhere', 'apac', 'asia', 'europe'],
    excludeOutsideAcceptedRegions: true,
    utcOffset: 7,
  },
} as FilterProfile;
const { applyFilters } = createFilters(profile);
const { applyFilters: applyNoOffset } = createFilters({
  ...profile,
  location: { ...(profile.location as object), utcOffset: undefined },
} as FilterProfile);

function makeJob(body: string, location = 'Worldwide', remote = true): Job {
  const now = new Date().toISOString();
  return {
    id: 'tz',
    source: 'greenhouse',
    title: 'Senior Software Engineer',
    company: 'Acme',
    url: 'https://example.com/jobs/1',
    location,
    remote,
    body: `react typescript next.js ${body}`,
    tags: [],
    salary: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: now,
    fetchedAt: now,
    fitScore: 0,
    categories: [],
  };
}

const dropped = (body: string) =>
  applyFilters([makeJob(body)]).droppedByRule.hard_timezone_incompatible === 1;

describe('hard_timezone_incompatible (candidate UTC+7)', () => {
  it.each([
    'You must work EST hours.',
    'Overlap with Pacific time is required.',
    'We need 4 hours of overlap with US business hours.',
    'Core working hours 9-5 ET.',
    'Availability in UTC-8 to UTC-5 working hours.',
    'Expected to be online during North American hours.',
    'Excellent English with partial overlap with U.S. business hours.',
  ])('drops: %s', (body) => {
    expect(dropped(body)).toBe(true);
  });

  it.each([
    'Fully async, work any hours you like.',
    'Overlap with CET hours expected.',
    'Work CET or EST hours, your choice.',
    'Based out of the Pacific Northwest, hiring worldwide.',
    'We are an EST-founded company with a global team.',
    'APAC hours preferred, overlap with SGT.',
    'The Global Physical Security Team (PST) helps protect our people.',
    'Book time with recruiting (Mon-Fri: 9am-3pm Pacific Time).',
    'We ask that you try to overlap some working hours with EST.',
    'EST hours preferred.',
    'UTC+8 to UTC+1 working window.',
    'Work within our core time zones in LATAM (GMT-3) or the Philippines (GMT+8).',
    'We prefer candidates in time zones between US Pacific Time and Central European Time.',
    'The team works across Europe and East Coast North America time zones.',
  ])('keeps: %s', (body) => {
    expect(dropped(body)).toBe(false);
  });

  it('is inert without location.utcOffset', () => {
    const r = applyNoOffset([makeJob('You must work EST hours.')]);
    expect(r.droppedByRule.hard_timezone_incompatible).toBeUndefined();
  });
});

describe('remote_location_far_zone (candidate UTC+7)', () => {
  const far = (location: string, body = 'We build things.') =>
    applyFilters([makeJob(body, location)]).droppedByRule.remote_location_far_zone === 1;

  it.each([
    'Remote, USA',
    'United States',
    'San Francisco',
    'Remote - Canada',
    'Austin, TX',
    'Toronto, CAN',
    'Hybrid - San Francisco, New York City',
    'Brazil',
    'Latin America',
  ])('drops remote posting tied to: %s', (location) => {
    expect(far(location)).toBe(true);
  });

  it.each([
    'Poland',
    'Warsaw',
    'Dubai',
    'United Arab Emirates',
    'Remote - Europe',
    'Germany',
    'United States or Poland',
    'USA, Europe',
    'Worldwide',
    'Remote',
    'Singapore',
    'Australia',
    'Remote, USA / APAC',
  ])('keeps remote posting tied to: %s', (location) => {
    expect(far(location)).toBe(false);
  });

  it('keeps a US location when the body states explicit worldwide hiring', () => {
    expect(far('Remote, USA', 'We hire anywhere in the world.')).toBe(false);
  });

  it('is inert without location.utcOffset', () => {
    const r = applyNoOffset([makeJob('x', 'Remote, USA')]);
    expect(r.droppedByRule.remote_location_far_zone).toBeUndefined();
  });
});

describe('confirmed_not_remote vs stated location', () => {
  const ashby = (location: string, body = 'x') => ({
    ...makeJob(body, location, false),
    source: 'ashby' as const,
  });
  it('keeps an Ashby role flagged non-remote when location says Remote and the body says fully remote', () => {
    const r = applyFilters([
      ashby('Remote, Global', 'What we offer: Fully Remote. We hire globally.'),
    ]);
    expect(r.droppedByRule.confirmed_not_remote).toBeUndefined();
  });
  it('still drops when only the location label says Remote (the flag wins)', () => {
    expect(applyFilters([ashby('Remote')]).droppedByRule.confirmed_not_remote).toBe(1);
  });
  it('still drops a non-remote Ashby role in a city', () => {
    expect(applyFilters([ashby('Asia')]).droppedByRule.confirmed_not_remote).toBe(1);
  });
  it('still drops Hybrid - Remote wording', () => {
    expect(applyFilters([ashby('Hybrid, Asia')]).droppedByRule.confirmed_not_remote).toBe(1);
  });
});

describe('location lock keywords (default profile)', () => {
  const lock = (body: string) =>
    createFilters({
      ...(JSON.parse(readFileSync('config/profile.default.json', 'utf8')) as FilterProfile),
      location: profile.location,
    }).applyFilters([{ ...makeJob(body, 'Remote'), title: 'Senior Software Engineer' }]);
  it.each([
    'Enjoy in-office meals for on-site employees.',
    'Visa sponsorship available.',
    'We offer relocation assistance.',
    'There is no minimum in-office qualification requirement.',
  ])('does not treat benefits wording as a lock: %s', (body) => {
    expect(lock(body).droppedByRule.hard_location_incompatible).toBeUndefined();
  });
  it.each([
    'We do not offer visa sponsorship at this time.',
    'This role is in-office only.',
    'You must be willing to relocate to Berlin.',
  ])('still treats a real restriction as a lock: %s', (body) => {
    expect(lock(body).droppedByRule.hard_location_incompatible).toBe(1);
  });
});
