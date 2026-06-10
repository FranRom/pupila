import { describe, expect, it } from 'vitest';
import { createFilters, type FilterProfile } from '../src/filters.js';
import type { Job } from '../src/types.js';
import testProfile from './fixtures/test-profile.json' with { type: 'json' };

// Tests run against a stable fixture profile (Fran's tuned values) so
// scoring assertions don't shift when `config/profile.json` is genericized.
const { applyFilters } = createFilters(testProfile as FilterProfile);

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    source: 'greenhouse',
    title: 'Senior Software Engineer',
    company: 'Acme',
    url: 'https://example.com/jobs/123',
    location: 'Remote',
    remote: true,
    body: 'react typescript next.js',
    tags: [],
    salary: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: now,
    fetchedAt: now,
    fitScore: 0,
    category: 'general',
    ...overrides,
  };
}

describe('applyFilters — hard excludes', () => {
  it('drops junior titles', () => {
    const r = applyFilters([makeJob({ title: 'Junior Software Engineer' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops intern titles', () => {
    const r = applyFilters([makeJob({ title: 'Software Engineering Intern' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops titles without senior_req keyword', () => {
    const r = applyFilters([makeJob({ title: 'Marketing Manager' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('keeps senior+engineer titles past hard filter', () => {
    const r = applyFilters([makeJob()]);
    expect(r.droppedHard).toBe(0);
  });

  it('drops body with hard US-only pattern', () => {
    const r = applyFilters([makeJob({ body: 'Candidates must be located in the United States.' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops when location field names a non-accepted region ("Remote, USA")', () => {
    const r = applyFilters([
      makeJob({ location: 'Remote, USA', body: 'We do many things and ship products.' }),
    ]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
    expect(r.droppedByRule.hard_location_incompatible).toBe(1);
  });

  it('drops when body says "EST timezone required" (out-of-region for an EU profile)', () => {
    const r = applyFilters([
      makeJob({ body: 'Remote-friendly position. EST timezone required for daily standups.' }),
    ]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops explicit work-authorization / based-in locks to a non-accepted region', () => {
    const r1 = applyFilters([
      makeJob({ body: 'You must be authorized to work in the United States to apply.' }),
    ]);
    const r2 = applyFilters([
      makeJob({ body: 'This role requires you to be based in the US for tax reasons.' }),
    ]);
    expect(r1.droppedHard + r2.droppedHard).toBe(2);
  });

  it('drops "remote in US" via the location field', () => {
    const r = applyFilters([makeJob({ location: 'Remote in US', body: 'We build cool stuff.' })]);
    expect(r.droppedHard).toBe(1);
  });

  it('rescues a US-mentioning posting that ALSO targets EMEA / worldwide', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Frontend Engineer',
        location: 'Remote — worldwide',
        body: 'We are US-based but hire worldwide. Remote anywhere.',
      }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('rescues when body explicitly mentions EMEA alongside US', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'Remote in US, UK, and the rest of EMEA. Any timezone OK.',
      }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('keeps a Europe-located posting', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Frontend Engineer',
        location: 'Remote — EMEA',
        body: 'We are a European company hiring across Europe.',
      }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('keeps a "Remote - US" posting whose body welcomes Europe (label ≠ requirement)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Frontend Engineer',
        location: 'Remote - US',
        body: 'We are US-based but hire across Europe and EMEA. react typescript remote',
      }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('does not drop a remote posting over an incidental, non-geographic "must be"', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Frontend Engineer',
        location: 'Remote',
        body: 'You must be a strong communicator and team player. react typescript remote',
      }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('drops a posting that requires US work authorization (a real requirement)', () => {
    const r = applyFilters([
      makeJob({
        location: 'Remote',
        body: 'Must be authorized to work in the United States. react typescript remote',
      }),
    ]);
    expect(r.droppedHard).toBe(1);
    expect(r.droppedByRule.hard_location_incompatible).toBe(1);
  });
});

// The bias the old hard_us_or_onsite rule baked in: it dropped US/onsite jobs
// for everyone, which is backwards for a US-based candidate. The geo rule is now
// driven entirely by profile.location, so swapping the profile swaps the outcome
// with no code change. This test would have caught the original US-centric bias.
describe('applyFilters — geo rule is persona-neutral (no privileged country)', () => {
  const usProfile = {
    ...testProfile,
    location: {
      basedIn: 'United States',
      workTypes: ['remote', 'hybrid'],
      acceptedRegions: ['united states', 'usa', 'us', 'north america', 'new york'],
      excludeOutsideAcceptedRegions: true,
    },
  } as unknown as FilterProfile;
  const us = createFilters(usProfile).applyFilters;
  const eu = applyFilters; // the fixture is an EU (Spain) profile

  const usJob = () =>
    makeJob({
      title: 'Senior Frontend Engineer',
      location: 'Remote — US',
      body: 'You must be authorized to work in the United States. react typescript next.js anthropic claude.',
    });
  const euJob = () =>
    makeJob({
      title: 'Senior Frontend Engineer',
      location: 'Remote — Europe',
      body: 'You must be based in the EU. react typescript next.js anthropic claude.',
    });

  it('US profile keeps the US job and drops the Europe-only job', () => {
    expect(us([usJob()]).kept).toHaveLength(1);
    expect(us([euJob()]).kept).toHaveLength(0);
  });

  it('EU profile drops the US job and keeps the Europe job — same code, opposite outcome', () => {
    expect(eu([usJob()]).kept).toHaveLength(0);
    expect(eu([euJob()]).kept).toHaveLength(1);
  });

  it('drops customer support engineer (compound non-eng)', () => {
    const r = applyFilters([makeJob({ title: 'Senior Customer Support Engineer' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops field operations / field engineering compounds', () => {
    const r = applyFilters([makeJob({ title: 'Head of Field Engineering Operations' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops developer relations / devrel', () => {
    const r = applyFilters([makeJob({ title: 'Senior Developer Relations Engineer' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('drops non-engineering exec titles (VP/CMO/CFO/COO)', () => {
    expect(applyFilters([makeJob({ title: 'VP of Product' })]).kept).toHaveLength(0);
    expect(applyFilters([makeJob({ title: 'Chief Marketing Officer' })]).kept).toHaveLength(0);
  });

  it('drops jobs with non-http URL schemes', () => {
    const r = applyFilters([makeJob({ url: 'javascript:alert(1)' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('reports the rule that fired in droppedByRule', () => {
    const r = applyFilters([
      makeJob({ title: 'Junior Software Engineer' }),
      makeJob({ title: 'Marketing Manager' }),
      makeJob({ url: 'javascript:alert(1)' }),
    ]);
    expect(r.droppedByRule.junior_title).toBe(1);
    expect(r.droppedByRule.missing_senior_req).toBe(1);
    expect(r.droppedByRule.unsafe_url).toBe(1);
  });

  it('drops non-frontend engineering specialties', () => {
    const cases = [
      'Senior Product Security Engineer',
      'Senior Data Engineer',
      'Staff DevOps Engineer',
      'Principal Site Reliability Engineer',
      'Lead Infrastructure Engineer',
      'Senior QA Engineer',
      'Senior Network Engineer',
    ];
    for (const title of cases) {
      const r = applyFilters([makeJob({ title })]);
      expect(r.kept, `should drop: ${title}`).toHaveLength(0);
    }
  });

  it('keeps frontend / fullstack / mobile / web / generic engineering titles', () => {
    const cases = [
      'Senior Frontend Engineer',
      'Staff Full-Stack Engineer',
      'Senior Mobile Engineer',
      'Senior Software Engineer',
      'Tech Lead',
      'Senior Engineering Manager',
      'Head of Engineering',
    ];
    for (const title of cases) {
      const r = applyFilters([
        makeJob({ title, body: 'react typescript next.js anthropic remote' }),
      ]);
      expect(r.kept, `should keep: ${title}`).toHaveLength(1);
    }
  });

  it('drops business/product/customer/country lead+manager roles', () => {
    const cases = [
      'Lead Client Growth Manager',
      'Country Lead Spain Portugal',
      'Senior Product Manager',
      'Customer Success Manager',
      'Senior Account Manager',
      'Regional Lead',
      'Operations Manager',
    ];
    for (const title of cases) {
      const r = applyFilters([makeJob({ title })]);
      expect(r.kept, `should drop: ${title}`).toHaveLength(0);
    }
  });

  it('drops analyst / trader / data scientist / researcher titles', () => {
    const cases = [
      'Lead Product Analyst',
      'Senior Data Analyst',
      'Senior OTC Trader',
      'Senior Data Scientist',
    ];
    for (const title of cases) {
      const r = applyFilters([makeJob({ title })]);
      expect(r.kept, `should drop: ${title}`).toHaveLength(0);
    }
  });
});

describe('applyFilters — scoring', () => {
  it('awards web3 signals (+20 title, +20 stack)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Blockchain Engineer',
        body: 'wagmi viem hardhat react typescript next.js remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.category).toBe('web3');
    expect(r.kept[0]?.fitScore).toBeGreaterThanOrEqual(60);
  });

  it('awards AI signals (+20 title, +20 stack)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior AI Engineer',
        body: 'anthropic claude vercel ai sdk react typescript remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.category).toBe('ai');
  });

  it('assigns web3+ai when both fire', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'web3 wallet anthropic claude react typescript remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.category).toBe('web3+ai');
  });

  it('caps fitScore at 100 before penalty', () => {
    const r = applyFilters([
      makeJob({
        title: 'Staff Senior Engineer',
        body: 'web3 wagmi anthropic claude react typescript next.js graphql tailwind remote worldwide',
      }),
    ]);
    const job = r.kept[0];
    expect(job).toBeDefined();
    if (job) {
      expect(job.fitScore).toBeLessThanOrEqual(100);
      expect(job._signals?.capped).toBe(true);
    }
  });

  it('applies the out-of-region penalty (not a hard drop) when excludeOutsideAcceptedRegions is off', () => {
    // Same EU fixture but soft-mode: out-of-region jobs are penalized, not dropped.
    const softProfile = {
      ...testProfile,
      location: {
        ...(testProfile as unknown as FilterProfile).location,
        excludeOutsideAcceptedRegions: false,
      },
    } as unknown as FilterProfile;
    const soft = createFilters(softProfile).applyFilters;
    const r = soft([
      makeJob({
        title: 'Senior Frontend Engineer',
        body: 'react typescript next.js anthropic claude. Must be located in the United States. EST hours required.',
        location: 'New York',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?._signals?.outOfRegionPenalty).toBe(-10);
  });

  it('drops jobs with fitScore < 30', () => {
    const r = applyFilters([
      makeJob({ title: 'Senior Engineer', body: 'java spring boot kafka', postedAt: null }),
    ]);
    expect(r.droppedScore).toBeGreaterThanOrEqual(0);
  });

  it('records signals on kept jobs', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'react typescript anthropic claude remote',
      }),
    ]);
    expect(r.kept[0]?._signals).toBeDefined();
    expect(r.kept[0]?._signals?.aiStack).toBe(20);
    expect(r.kept[0]?._signals?.stackPrimary).toBe(10);
    expect(r.kept[0]?._signals?.seniorTitle).toBe(10);
  });

  it('awards +10 role title bonus', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Frontend Engineer',
        body: 'react typescript anthropic remote',
      }),
    ]);
    expect(r.kept[0]?._signals?.roleTitle).toBe(10);
  });

  it('halves stackPrimary weight when only one stack keyword appears', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'You will work with React on our platform. anthropic claude remote.',
      }),
    ]);
    // Only "react" once → tiered to half-weight (10 → 5).
    expect(r.kept[0]?._signals?.stackPrimary).toBe(5);
  });

  it('boosts stackPrimary 1.5× when stack keywords appear 4+ times', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'react components, react hooks, react router, react context, typescript everywhere, next.js. anthropic claude remote.',
      }),
    ]);
    // 6 occurrences of stackPrimary → 1.5× boost (10 → 15).
    expect(r.kept[0]?._signals?.stackPrimary).toBe(15);
  });

  it('boosts roleBody 1.5× on multiple role-specific phrases', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'Own the design system, ship react components, drive accessibility, optimise web vitals, and mentor on responsive design. anthropic claude remote.',
      }),
    ]);
    expect(r.kept[0]?._signals?.roleBody).toBe(15);
  });

  it('does not award role title bonus to generic Software Engineer titles', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Software Engineer',
        body: 'react typescript anthropic remote',
      }),
    ]);
    expect(r.kept[0]?._signals?.roleTitle).toBe(0);
  });

  it('awards +10 roleBody bonus when body has role-specific frontend phrases', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Software Engineer',
        body: 'You will ship react components and own our design system. Remote.',
      }),
    ]);
    expect(r.kept[0]?._signals?.roleBody).toBe(10);
  });

  it('does not award roleBody for generic backend body', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'Build microservices in Go using gRPC and protobuf. anthropic claude remote.',
      }),
    ]);
    expect(r.kept[0]?._signals?.roleBody).toBe(0);
  });

  it('ignores AI/web3 keywords in company boilerplate at end of body', () => {
    // Pad role description so "anthropic" appears past the 1500-char window.
    const padding = 'java spring boot postgres kafka backend microservices. '.repeat(50);
    const body = `Senior Backend Engineer working on payment infrastructure. ${padding}\n\nAbout Acme: We are an Equal Opportunity Employer and use Anthropic Claude internally for support tooling.`;
    const r = applyFilters([
      makeJob({
        title: 'Senior Backend Engineer',
        body,
        location: 'Berlin',
      }),
    ]);
    if (r.kept.length > 0) {
      expect(r.kept[0]?._signals?.aiStack).toBe(0);
    }
  });

  it('detects AI/web3 keywords when they appear in the role description (not boilerplate)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'Build AI agents using Anthropic Claude and the Vercel AI SDK in React. Remote.',
      }),
    ]);
    expect(r.kept[0]?._signals?.aiStack).toBe(20);
  });
});

describe('applyFilters — title plurals', () => {
  it('accepts "engineers" plural in title', () => {
    const r = applyFilters([
      makeJob({
        title: 'We are hiring engineers',
        body: 'anthropic claude agents react typescript',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
  });

  it('accepts "developers" plural', () => {
    const r = applyFilters([
      makeJob({
        title: 'Hiring developers for AI team',
        body: 'anthropic claude react typescript',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
  });
});

describe('applyFilters — role interests', () => {
  // Build a profile variant that overrides only the role list, keeping the
  // fixture's weights/keywords (so hard-drops and scoring are unchanged).
  function withRoles(roles: FilterProfile['roles']): FilterProfile {
    return { ...(testProfile as FilterProfile), roles };
  }

  it('records empty roleMatches for a non-role engineering title', () => {
    const r = applyFilters([
      makeJob({ title: 'Senior Software Engineer', body: 'java spring anthropic claude remote' }),
    ]);
    expect(r.kept[0]?.roleMatches).toEqual([]);
  });

  it('records the matched role id in roleMatches', () => {
    const r = applyFilters([
      makeJob({ title: 'Senior Frontend Engineer', body: 'react anthropic remote' }),
    ]);
    expect(r.kept[0]?.roleMatches).toEqual(['frontend']);
  });

  it('tags a job that matches multiple roles, in role-list order', () => {
    const { applyFilters: applyMulti } = createFilters(
      withRoles([
        { id: 'frontend', label: 'Frontend Engineer', titleMatch: ['frontend', 'react'] },
        { id: 'product', label: 'Product Engineer', titleMatch: ['product engineer'] },
      ]),
    );
    const r = applyMulti([
      makeJob({ title: 'Senior Frontend Product Engineer', body: 'anthropic claude remote' }),
    ]);
    expect(r.kept[0]?.roleMatches).toEqual(['frontend', 'product']);
    expect(r.kept[0]?._signals?.roleTitle).toBe(10);
  });

  it('awards the role title bonus to a secondary role match', () => {
    const { applyFilters: applyMulti } = createFilters(
      withRoles([
        { id: 'frontend', label: 'Frontend Engineer', titleMatch: ['frontend'] },
        { id: 'product', label: 'Product Engineer', titleMatch: ['product engineer'] },
      ]),
    );
    const r = applyMulti([
      makeJob({ title: 'Senior Product Engineer', body: 'anthropic claude remote' }),
    ]);
    expect(r.kept[0]?.roleMatches).toEqual(['product']);
    expect(r.kept[0]?._signals?.roleTitle).toBe(10);
  });

  it('rescues a title-matching role from the excluded-specialty hard drop', () => {
    const { applyFilters: applyRescue } = createFilters(
      withRoles([{ id: 'data', label: 'Data Engineer', titleMatch: ['data engineer'] }]),
    );
    const r = applyRescue([
      makeJob({ title: 'Senior Data Engineer', body: 'python spark anthropic claude remote' }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.roleMatches).toEqual(['data']);
  });

  it('still drops an excluded specialty when no role matches it', () => {
    const r = applyFilters([
      makeJob({ title: 'Senior Data Engineer', body: 'python anthropic claude remote' }),
    ]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedByRule.title_excluded_specialty).toBe(1);
  });
});
