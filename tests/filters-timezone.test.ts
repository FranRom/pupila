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
    'No security clearance is required.',
    'A security clearance is not required.',
    'Help us build public trust in AI.',
    'There is no need to relocate.',
    "You don't need to relocate.",
    'Office Set-Up Reimbursement (In-Office Only)',
    'Not sure about visa sponsorship? We provide it.',
    'You are never required to work from the office.',
  ])('does not treat benefits wording as a lock: %s', (body) => {
    expect(lock(body).droppedByRule.hard_location_incompatible).toBeUndefined();
  });
  it.each([
    'We do not offer visa sponsorship at this time.',
    'This role is in-office only.',
    'You must be willing to relocate to Berlin.',
    'Ability to obtain and maintain a Public Trust clearance.',
    'Active security clearance required.',
    'This role is in-office only.',
    'We are unable to provide visa sponsorship.',
  ])('still treats a real restriction as a lock: %s', (body) => {
    expect(lock(body).droppedByRule.hard_location_incompatible).toBe(1);
  });
});

describe('timezone gap wraps around the clock', () => {
  const sydney = createFilters({
    ...profile,
    location: { ...(profile.location as object), utcOffset: 10 },
  } as FilterProfile).applyFilters;
  const tz = (f: typeof sydney, body: string, location = 'Worldwide') =>
    f([makeJob(body, location)]).droppedByRule;

  it('UTC+10 is 6h from Pacific time, not 18', () => {
    expect(
      tz(sydney, 'Overlap with Pacific time is required.').hard_timezone_incompatible,
    ).toBeUndefined();
    expect(tz(sydney, 'Remote, San Francisco').remote_location_far_zone).toBeUndefined();
  });

  it('still drops a genuinely far zone for the same candidate', () => {
    expect(tz(sydney, 'You must work CET hours.').hard_timezone_incompatible).toBe(1);
  });

  it('treats a null utcOffset as unset instead of UTC+0', () => {
    const f = createFilters({
      ...profile,
      location: { ...(profile.location as object), utcOffset: null },
    } as unknown as FilterProfile).applyFilters;
    expect(
      f([makeJob('You must work JST hours.')]).droppedByRule.hard_timezone_incompatible,
    ).toBeUndefined();
  });
});

describe('ambiguous abbreviations and plain English', () => {
  it.each([
    'This is a PT contract, 20 hours per week.',
    'Based in Stamford, CT with flexible hours.',
    'Great fit when working with the ET team.',
    'Working on MT models and evaluation hours.',
    'Aligned with CST (China Standard Time) working hours.',
    'Our tooling saves us hours every week.',
    'FT or PT options, flexible working hours.',
  ])('keeps: %s', (body) => {
    expect(dropped(body)).toBe(false);
  });

  it.each([
    'Core hours 9-5 ET.',
    'Overlap with PT is required.',
    'ET hours expected.',
    'Availability in US hours is required.',
  ])('still drops: %s', (body) => {
    expect(dropped(body)).toBe(true);
  });
});

describe('far-zone rule — other home regions and US states', () => {
  const berlin = createFilters({
    ...profile,
    location: {
      ...(profile.location as object),
      utcOffset: 1,
      acceptedRegions: ['europe', 'eu', 'emea'],
    },
  } as FilterProfile).applyFilters;
  const us = createFilters({
    ...profile,
    location: {
      ...(profile.location as object),
      utcOffset: -5,
      acceptedRegions: ['north america', 'americas'],
    },
  } as FilterProfile).applyFilters;
  const far = (f: typeof berlin, location: string) =>
    f([makeJob('We build things.', location)]).droppedByRule.remote_location_far_zone === 1;

  it('treats California as west coast for a Berlin candidate in either spelling', () => {
    expect(far(berlin, 'Remote - San Francisco')).toBe(true);
    expect(far(berlin, 'Remote, San Francisco, CA')).toBe(true);
  });

  it('drops Asia-Pacific places for a US candidate, keeps Canada', () => {
    expect(far(us, 'Remote, Singapore')).toBe(true);
    expect(far(us, 'Remote, Canada')).toBe(false);
  });

  it('does not drop a placeholder BLANK location', () => {
    const r = berlin([{ ...makeJob('x', 'BLANK,BLANK,Multiple Locations'), remote: false }]);
    expect(r.droppedByRule.hard_location_incompatible).toBeUndefined();
  });
});

describe('accepting a region accepts the countries inside it', () => {
  const berlin = createFilters({
    ...profile,
    location: {
      basedIn: 'Germany',
      workTypes: ['remote'],
      acceptedRegions: ['europe', 'eu', 'emea'],
      excludeOutsideAcceptedRegions: true,
    },
  } as FilterProfile).applyFilters;
  const rule = (location: string, body = 'Great team.') =>
    berlin([makeJob(body, location)]).droppedByRule.hard_location_incompatible;

  it.each([
    'Spain, Portugal',
    'Poland, Portugal, Romania, Serbia, Spain, Turkey',
    'Remote (Bulgaria, Ireland, United Kingdom)',
    'Croatia, Slovenia',
  ])("keeps a Europe-accepting candidate's posting listed as: %s", (location) => {
    expect(rule(location)).toBeUndefined();
  });

  it('keeps a role restricted to "the United Kingdom only"', () => {
    expect(
      rule('Remote', 'This remote role is for candidates located in the United Kingdom.'),
    ).toBeUndefined();
  });

  it('still drops a closed list of countries outside the accepted regions', () => {
    expect(rule('Brazil, Canada')).toBe(1);
  });
});

describe('sentence scoping and splitting', () => {
  it('does not let a zone named in an earlier sentence unlock a later bare region', () => {
    // "Europe" is a rescue only for a far zone named in the SAME sentence.
    expect(
      dropped(
        'Must be available during US business hours. We also collaborate closely with partners across Europe on product.',
      ),
    ).toBe(true);
  });

  it('still rescues a far zone with a bare region named in the same sentence', () => {
    expect(dropped('Overlap with US business hours or Europe is fine.')).toBe(false);
  });

  it.each([
    'Core hours are 9-5 PST. Rust experience preferred.',
    'Core hours are 9-5 (PST). Rust experience preferred.',
    'Core hours are 9-5 PST.\nRust experience preferred.',
  ])('splits after a two-capital ending so the sentence is judged: %s', (body) => {
    expect(dropped(body)).toBe(true);
  });
});
