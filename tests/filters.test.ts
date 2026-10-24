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
    categories: [],
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

  it('keeps SWE-abbreviated titles past the senior_req filter', () => {
    const r = applyFilters([makeJob({ title: 'Full-Stack SWE, Data Acquisition' })]);
    expect(r.droppedHard).toBe(0);
  });

  it('drops body with hard US-only pattern', () => {
    const r = applyFilters([makeJob({ body: 'Candidates must be located in the United States.' })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedHard).toBe(1);
  });

  it('rescues when the title carries the eligibility region ("MLE (UK/EU)")', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior MLE (UK/EU)',
        location: 'London',
        body: 'react typescript next.js',
      }),
    ]);
    expect(r.droppedByRule.hard_location_incompatible).toBeUndefined();
  });

  it('keeps a remote posting whose location field bare-names a non-accepted region ("Remote, USA") — no explicit requirement', () => {
    // A remote posting's location field often just states where the team/hub
    // sits, not a requirement on the candidate. Only explicit restriction
    // language (locationLock, or a role-specific "for candidates located in
    // X" sentence) should drop a remote posting — see the next test.
    const r = applyFilters([
      makeJob({ location: 'Remote, USA', body: 'We do many things and ship products.' }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.droppedHard).toBe(0);
  });

  it('drops a non-remote (onsite) posting whose location field names a non-accepted region', () => {
    const r = applyFilters([
      makeJob({
        location: 'Remote, USA',
        remote: false,
        body: 'We do many things and ship products.',
      }),
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

  it('keeps a remote "remote in US" posting with no explicit requirement in the body', () => {
    const r = applyFilters([makeJob({ location: 'Remote in US', body: 'We build cool stuff.' })]);
    expect(r.droppedHard).toBe(0);
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

  it('keeps a plain "Remote" posting with no region named (company location is irrelevant)', () => {
    const r = applyFilters([
      makeJob({ location: 'Remote', body: 'react typescript next.js remote' }),
    ]);
    expect(r.droppedHard).toBe(0);
    expect(r.kept).toHaveLength(1);
  });

  it('keeps generic remote/worldwide synonyms even without an accepted-region word', () => {
    const locations = [
      'Global',
      'Worldwide',
      'Distributed',
      'Fully remote',
      'Remote anywhere',
      'Remote (Anywhere)',
      'Remote - Global',
    ];
    for (const location of locations) {
      const r = applyFilters([makeJob({ location, body: 'react typescript remote' })]);
      expect(r.droppedHard, `expected "${location}" to be kept`).toBe(0);
    }
  });

  it('keeps a remote non-US out-of-region label too (LATAM) — bare label, no requirement, rule is not US-specific either way', () => {
    const r = applyFilters([
      makeJob({ location: 'Remote - LATAM', body: 'react typescript remote' }),
    ]);
    expect(r.droppedHard).toBe(0);
  });

  it('drops a non-remote out-of-region label (LATAM, onsite) — the rule is not US-specific', () => {
    const r = applyFilters([
      makeJob({ location: 'Remote - LATAM', remote: false, body: 'react typescript remote' }),
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

  // The rescue used to scan location AND body together, so ordinary marketing
  // copy ("used by developers worldwide", "a global team") rescued roles whose
  // stated location was explicitly elsewhere. Seen live on three boards at once:
  // Pinecone "US Remote", Vercel "Hybrid - San Francisco", A.Team
  // "Americas, Europe, Israel" all survived an APAC-only profile.
  describe('rescue is scoped: marketing prose must not override a stated location', () => {
    const apacProfile = {
      ...testProfile,
      location: {
        basedIn: 'Thailand',
        workTypes: ['remote'],
        acceptedRegions: ['worldwide', 'apac', 'asia', 'thailand'],
        excludeOutsideAcceptedRegions: true,
      },
    } as unknown as FilterProfile;
    const apac = createFilters(apacProfile).applyFilters;

    it('keeps a remote US-based role whose body merely mentions "worldwide" — bare location, no explicit requirement', () => {
      // "US Remote" names where the team sits, not a requirement on the
      // candidate; nothing here explicitly restricts eligibility to the US.
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'US Remote',
        body: 'Our vector database is used by developers worldwide. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('drops an onsite role whose body calls the company "global"', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Hybrid - San Francisco',
        remote: false,
        body: 'Join our global team building the frontend cloud. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('keeps a remote role whose stated regions are all outside the accepted set — bare label, no explicit requirement', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Americas, Europe, Israel',
        body: 'Work with global companies on AI projects. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('drops a NON-remote role whose stated regions are all outside the accepted set', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Americas, Europe, Israel',
        remote: false,
        body: 'Work with global companies on AI projects. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('keeps a role whose LOCATION field says Worldwide — the bare token is the eligibility statement', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Worldwide',
        body: 'Build agent systems. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('keeps "Home based - Worldwide"', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Home based - Worldwide',
        body: 'react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('keeps a geo-labelled role whose BODY states explicit hiring eligibility', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Remote - United States',
        body: 'We hire globally and you can work from anywhere. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('keeps a role whose body names an accepted region — original intent preserved', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Remote - United States',
        body: 'We also hire across APAC. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('keeps a null-location posting with no stated requirement (Hacker News shape)', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: null,
        body: 'Small team building agent tooling. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('drops a role whose body explicitly restricts to one named city, despite a generic "work from anywhere" perks bullet', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Brazil',
        body: 'This is a remote role for candidates located in Belo Horizonte, Brazil. Benefits: Competitive salary. Work from anywhere. High ownership. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('drops a role restricted to "candidates must be located in" a non-accepted country', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Remote',
        body: 'Candidates must be located in Portugal. We offer flexible hours and work from anywhere within the country. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('drops a role restricted to a city name with diacritics (Florianópolis)', () => {
      // Regression: an ASCII-only [a-z] capture group silently failed to
      // match accented city names, letting these specific postings through
      // while otherwise-identical ASCII-named-city postings from the same
      // company correctly dropped.
      const job = makeJob({
        title: 'Staff Software Engineer, Product',
        location: 'Brazil',
        body: 'This is a remote role for candidates located in Florianópolis, Brazil. Benefits: Work from anywhere. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('drops a role restricted to a city name with diacritics (São Paulo)', () => {
      const job = makeJob({
        title: 'Staff Software Engineer, Product',
        location: 'Brazil',
        body: 'This is a remote role for candidates located in São Paulo, Brazil. Benefits: Work from anywhere. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('keeps the role-restriction statement when the named place IS accepted', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: 'Remote',
        body: 'This is a remote role for candidates located in Thailand. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('drops an HN-shaped posting whose header states "REMOTE (US-only)" with no location field at all', () => {
      // Reproduces the exact case observed live: HN "who's hiring" posts carry
      // no structured location field (job.location is null), and the only
      // eligibility signal is this header shorthand in the body/title text.
      const job = makeJob({
        title: 'Python + TypeScript Engineers',
        location: null,
        body: "Fusionbox | Python + TypeScript Engineers | United States | Full-time | REMOTE (US-only) We're a software engineering consultancy. react typescript next.js",
      });
      expect(apac([job]).kept).toHaveLength(0);
    });

    it('does not drop a posting for an unrelated "(async only)" qualifier — not a geographic restriction', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: null,
        body: 'We are remote (async only) friendly and communicate over docs. react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });

    it('keeps a "(Thailand-only)" restriction since Thailand is an accepted region', () => {
      const job = makeJob({
        title: 'Senior Software Engineer',
        location: null,
        body: 'This role is REMOTE (Thailand-only). react typescript next.js',
      });
      expect(apac([job]).kept).toHaveLength(1);
    });
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
  it('tags the web3 category (+20) and contributes to score', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Blockchain Engineer',
        body: 'wagmi viem hardhat react typescript next.js remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.categories).toEqual(['web3']);
    expect(r.kept[0]?._signals?.categories.web3).toBe(20);
    expect(r.kept[0]?.fitScore).toBeGreaterThanOrEqual(60);
  });

  it('tags the ai category (+20)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior AI Engineer',
        body: 'anthropic claude vercel ai sdk react typescript remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.categories).toEqual(['ai']);
    expect(r.kept[0]?._signals?.categories.ai).toBe(20);
  });

  it('multi-labels a job matching both web3 and ai (config order)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'web3 wallet anthropic claude react typescript remote',
      }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]?.categories).toEqual(['web3', 'ai']);
  });

  it('caps fitScore at 100 before penalty', () => {
    const r = applyFilters([
      makeJob({
        title: 'Staff Frontend Engineer',
        body: 'web3 wagmi anthropic claude. Ship react components, own the design system, drive accessibility, responsive design, web vitals. react react react typescript next.js graphql tailwind remote worldwide',
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
    expect(r.kept[0]?._signals?.categories.ai).toBe(20);
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
      expect(r.kept[0]?.categories ?? []).not.toContain('ai');
    }
  });

  it('detects AI/web3 keywords when they appear in the role description (not boilerplate)', () => {
    const r = applyFilters([
      makeJob({
        title: 'Senior Engineer',
        body: 'Build AI agents using Anthropic Claude and the Vercel AI SDK in React. Remote.',
      }),
    ]);
    expect(r.kept[0]?._signals?.categories.ai).toBe(20);
  });
});

describe('applyFilters — category keyword matching (literal terms)', () => {
  function withCategory(keywords: string[]) {
    const profile = {
      ...testProfile,
      categories: [{ id: 'tag', label: 'Tag', keywords, weight: 20 }],
    } as unknown as FilterProfile;
    return createFilters(profile).applyFilters;
  }
  const tagsFor = (run: ReturnType<typeof withCategory>, snippet: string) =>
    run([makeJob({ title: 'Senior Engineer', body: `${snippet} react typescript remote` })]).kept[0]
      ?.categories ?? [];

  it('relaxes a dot between words: node.js matches both "node.js" and "nodejs"', () => {
    const run = withCategory(['node.js']);
    expect(tagsFor(run, 'we use node.js daily')).toContain('tag');
    expect(tagsFor(run, 'we use nodejs daily')).toContain('tag');
  });

  it('matches punctuation-edged keywords that \\b would break (c++)', () => {
    const run = withCategory(['c++']);
    expect(tagsFor(run, 'strong c++ background')).toContain('tag');
    expect(tagsFor(run, 'plain c developer')).not.toContain('tag');
  });

  it('keeps standalone-dot keywords exact (.net does not match the word "net")', () => {
    const run = withCategory(['.net']);
    expect(tagsFor(run, 'asp .net core')).toContain('tag');
    expect(tagsFor(run, 'net income growth')).not.toContain('tag');
  });

  it('still anchors plain words (ai does not match inside "email")', () => {
    const run = withCategory(['ai']);
    expect(tagsFor(run, 'senior ai work')).toContain('tag');
    expect(tagsFor(run, 'check your email often')).not.toContain('tag');
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

describe('applyFilters — stale-posting age cutoff', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  function withMaxAge(maxAgeDays: number | undefined) {
    const profile = {
      ...testProfile,
      scoring: { ...testProfile.scoring, maxAgeDays },
    } as unknown as FilterProfile;
    return createFilters(profile).applyFilters;
  }

  it('is inert when maxAgeDays is unset (default profile keeps old postings)', () => {
    const r = applyFilters([makeJob({ postedAt: daysAgo(90) })]);
    expect(r.kept).toHaveLength(1);
  });

  it('drops a posting older than maxAgeDays', () => {
    const run = withMaxAge(20);
    const r = run([makeJob({ postedAt: daysAgo(25) })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedByRule.stale_posting).toBe(1);
  });

  it('keeps a posting within maxAgeDays', () => {
    const run = withMaxAge(20);
    const r = run([makeJob({ postedAt: daysAgo(10) })]);
    expect(r.kept).toHaveLength(1);
  });

  it('does not rescue a stale posting via a role match — age applies regardless of fit', () => {
    const { applyFilters: applyRoled } = createFilters({
      ...testProfile,
      scoring: { ...testProfile.scoring, maxAgeDays: 20 },
      roles: [{ id: 'frontend', label: 'Frontend Engineer', titleMatch: ['frontend engineer'] }],
    } as unknown as FilterProfile);
    const r = applyRoled([makeJob({ title: 'Senior Frontend Engineer', postedAt: daysAgo(25) })]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedByRule.stale_posting).toBe(1);
  });

  it('keeps a job with a missing postedAt even when maxAgeDays is set (no evidence of staleness)', () => {
    const run = withMaxAge(20);
    const r = run([makeJob({ postedAt: null })]);
    expect(r.kept).toHaveLength(1);
  });

  it('keeps a job with an unparsable postedAt even when maxAgeDays is set', () => {
    const run = withMaxAge(20);
    const r = run([makeJob({ postedAt: 'not-a-date' })]);
    expect(r.kept).toHaveLength(1);
  });
});

describe('applyFilters — confirmed-not-remote (trusted-source work-type gate)', () => {
  function withWorkTypes(workTypes: readonly string[]) {
    const profile = {
      ...testProfile,
      location: { ...testProfile.location, workTypes },
    } as unknown as FilterProfile;
    return createFilters(profile).applyFilters;
  }

  it('is inert on the default fixture profile (accepts hybrid, so remote-only gate is off)', () => {
    const r = applyFilters([makeJob({ source: 'lever', remote: false, location: 'Remote' })]);
    expect(r.kept).toHaveLength(1);
  });

  it('drops a confirmed non-remote posting from a trusted source when the candidate is remote-only', () => {
    const run = withWorkTypes(['remote']);
    const r = run([
      makeJob({ source: 'lever', remote: false, location: 'Europe', tags: ['on-site'] }),
    ]);
    expect(r.kept).toHaveLength(0);
    expect(r.droppedByRule.confirmed_not_remote).toBe(1);
  });

  it.each([
    'hybrid',
    'on-site',
    'OnSite',
    'Hybrid',
  ])('drops on an explicit %s workplace type', (tag) => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'ashby', remote: false, location: 'Europe', tags: [tag] })]);
    expect(r.droppedByRule.confirmed_not_remote).toBe(1);
  });

  // A missing workplace type collapses to remote:false in the Ashby / Lever
  // normalizers; a region label alone is not evidence the role is on-site.
  it.each([
    'Europe',
    'EMEA',
    'Anywhere',
    'Distributed',
  ])('keeps a region-labelled posting (%s) with no workplace type', (location) => {
    const run = withWorkTypes(['remote']);
    for (const source of ['ashby', 'lever'] as const) {
      const r = run([makeJob({ source, remote: false, location, tags: ['unspecified'] })]);
      expect(r.droppedByRule.confirmed_not_remote).toBeUndefined();
    }
  });

  it('keeps recruitee flag authoritative (a plain boolean, no third state)', () => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'recruitee', remote: false, location: 'Europe' })]);
    expect(r.droppedByRule.confirmed_not_remote).toBe(1);
  });

  it('is inert when workTypes is empty (no preference expressed)', () => {
    const run = withWorkTypes([]);
    const r = run([makeJob({ source: 'lever', remote: false, tags: ['on-site'] })]);
    expect(r.droppedByRule.confirmed_not_remote).toBeUndefined();
  });

  it('does not treat a posting whose location says Remote as confirmed on-site', () => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'ashby', remote: false, location: 'Worldwide, Remote' })]);
    expect(r.droppedByRule.confirmed_not_remote).toBeUndefined();
  });

  it('still drops when the location pairs Remote with hybrid / on-site wording', () => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'ashby', remote: false, location: 'Hybrid, Remote Europe' })]);
    expect(r.droppedByRule.confirmed_not_remote).toBe(1);
  });

  it('does not apply to a heuristic-remote source, even when remote-only', () => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'greenhouse', remote: false, location: 'Remote' })]);
    expect(r.kept).toHaveLength(1);
  });

  it('keeps a trusted-source job that is actually remote', () => {
    const run = withWorkTypes(['remote']);
    const r = run([makeJob({ source: 'lever', remote: true, location: 'Remote' })]);
    expect(r.kept).toHaveLength(1);
  });

  it('is inert when the candidate also accepts onsite work', () => {
    const run = withWorkTypes(['remote', 'onsite']);
    const r = run([makeJob({ source: 'lever', remote: false, location: 'Remote' })]);
    expect(r.kept).toHaveLength(1);
  });

  it('is inert with no location profile at all (fresh fork, no default deny)', () => {
    const { applyFilters: applyNoLoc } = createFilters({
      ...testProfile,
      location: undefined,
    } as unknown as FilterProfile);
    const r = applyNoLoc([makeJob({ source: 'lever', remote: false, location: 'Remote' })]);
    expect(r.kept).toHaveLength(1);
  });
});

describe('applyFilters — bare parenthetical region code in locationLock', () => {
  // Mirrors a real gap: HN "who is hiring" postings never populate the
  // structured `location` field (always null), so a header like
  // "Company | Title | REMOTE (EU)" is only visible to the geo hard-drop via
  // body text. The pre-existing locationLock fragment only caught the
  // "-only"-suffixed form ("Remote (US-only)") — a bare regional code in
  // parens ("(EU)", "(US)", "(UK)") slipped through entirely.
  const apacProfile = {
    ...testProfile,
    location: {
      basedIn: 'Thailand',
      workTypes: ['remote'],
      acceptedRegions: ['worldwide', 'apac', 'asia', 'thailand'],
      excludeOutsideAcceptedRegions: true,
    },
  } as unknown as FilterProfile;
  const apac = createFilters(apacProfile).applyFilters;

  it('drops a job with no location field whose body states a bare non-accepted region code', () => {
    const job = makeJob({
      title: 'Product Engineer',
      location: null,
      body: 'Company | Product Engineer | Full-time | REMOTE (EU) | react typescript next.js',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });

  it('does not drop a bare "(Worldwide)" annotation — still a catch-all, not a lock', () => {
    const job = makeJob({
      title: 'Product Engineer',
      location: null,
      body: 'Company | Product Engineer | Full-time | REMOTE (Worldwide) | react typescript next.js',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('does not drop a bare accepted-region code ("(APAC)") — rescued upstream by ACCEPTED_REGIONS_SPECIFIC', () => {
    const job = makeJob({
      title: 'Product Engineer',
      location: null,
      body: 'Company | Product Engineer | Full-time | REMOTE (APAC) | react typescript next.js',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('still catches the original "-only" suffixed form', () => {
    const job = makeJob({
      title: 'Product Engineer',
      location: null,
      body: 'Company | Product Engineer | Full-time | REMOTE (US-only) | react typescript next.js',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });
});

// A candidate who has worked async with EU/US-based teams from Thailand for
// years is eligible for a job whose team happens to be based in Europe or the
// US — the location field naming that place is not, by itself, a requirement.
// Only explicit restriction language ("Only Europe", a specific timezone
// mandate, "must be based in X", "REMOTE (EU)"-style annotations) means the
// candidate genuinely can't take the role. Before this fix, a bare named
// location alone (via `locationFieldOutOfRegion`) hard-dropped every one of
// these, which is why postings like Ground News ("Staff Engineer, Web Growth
// & Conversion", location "Canada (Remote)", no explicit eligibility
// language) never reached the "real requirement" checks at all.
describe('applyFilters — remote posting with a bare named location is not itself a restriction', () => {
  const apacProfile = {
    ...testProfile,
    location: {
      basedIn: 'Thailand',
      workTypes: ['remote'],
      acceptedRegions: ['worldwide', 'apac', 'asia', 'thailand'],
      excludeOutsideAcceptedRegions: true,
    },
  } as unknown as FilterProfile;
  const apac = createFilters(apacProfile).applyFilters;

  it('keeps a remote posting whose location merely names Canada, with no eligibility statement (Ground News shape)', () => {
    const job = makeJob({
      title: 'Staff Engineer, Web Growth & Conversion',
      location: 'Canada (Remote)',
      body: 'Own the growth engineering roadmap. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('keeps a remote posting whose location merely names a European city, with no eligibility statement (Figma shape)', () => {
    const job = makeJob({
      title: 'Senior Staff Engineer',
      location: 'London, UK (Remote)',
      body: 'Build the design tool loved by millions. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('still drops the same posting once the body states an explicit timezone-only requirement', () => {
    const job = makeJob({
      title: 'Staff Engineer, Web Growth & Conversion',
      location: 'Canada (Remote)',
      body: 'Own the growth engineering roadmap. EST timezone required for daily standups. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });

  it('still drops the same posting once the body explicitly restricts eligibility to that place', () => {
    const job = makeJob({
      title: 'Staff Engineer, Web Growth & Conversion',
      location: 'Canada',
      body: 'This is a remote role for candidates located in Canada. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });

  it('still drops a physically onsite posting in a non-accepted city (no remote option at all)', () => {
    const job = makeJob({
      title: 'Staff Software Engineer',
      location: 'London, UK',
      remote: false,
      body: 'Join us in our London office. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });
});

// A security-clearance requirement (Public Trust, Secret, Top Secret) is a
// distinct kind of explicit restriction from a named location: it's a proxy
// for "must be a US citizen able to pass a federal background investigation,"
// which excludes a non-US-citizen candidate regardless of the "Remote" label
// on the posting. Observed live: a "Senior Front-End Agentic AI Engineer" at
// a VA (Veterans Affairs) contractor, location "United States - Remote,"
// "Clearance: Ability to obtain and maintain a Public Trust" — survived the
// filter because remote + a bare "United States" location isn't itself a
// restriction (the fix above), and none of the existing locationLock phrases
// (work authorization / visa / relocation) matched clearance-specific
// language. This is a real gap, distinct from the geo-region gate: these
// patterns fire regardless of job.remote, since a clearance requirement is a
// hard requirement even for a fully-remote role.
describe('applyFilters — security clearance / public trust is a real restriction, not a bare location', () => {
  it('drops a posting requiring the ability to obtain a Public Trust clearance', () => {
    const job = makeJob({
      title: 'Senior Front-End Agentic AI Engineer',
      location: 'United States - Remote',
      body: 'United States – Remote. Clearance: Ability to obtain and maintain a Public Trust. react typescript next.js.',
    });
    expect(applyFilters([job]).kept).toHaveLength(0);
  });

  it('drops a posting requiring an active Secret clearance', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Remote',
      body: 'Must hold an active Secret clearance. react typescript next.js.',
    });
    expect(applyFilters([job]).kept).toHaveLength(0);
  });

  it('drops a posting requiring Top Secret clearance', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Remote',
      body: 'This role requires Top Secret clearance. react typescript next.js.',
    });
    expect(applyFilters([job]).kept).toHaveLength(0);
  });

  it('drops a posting that requires US citizenship explicitly', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Remote',
      body: 'Must be a US citizen due to federal contract requirements. react typescript next.js.',
    });
    expect(applyFilters([job]).kept).toHaveLength(0);
  });

  it('keeps an ordinary remote posting that merely mentions "trust" in an unrelated sense', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Remote',
      body: 'We trust our engineers to work autonomously. react typescript next.js.',
    });
    expect(applyFilters([job]).kept).toHaveLength(1);
  });
});

// An enumerated list of 2+ specific COUNTRIES (not cities) as the entire
// location field is a stronger signal than a single named place: it usually
// means "these are the only countries we're legally set up to employ a
// remote worker in" (an Employer-of-Record/payroll constraint), even without
// the word "only" anywhere. Observed live: "AI Staff Engineer" at Sauce,
// location "Brazil (Remote), Canada (Remote)" — kept by the earlier fix
// (bare-location-on-remote-job isn't a restriction) even though neither
// country is accepted for a Thailand-based candidate. A single named place
// (e.g. "Auckland" for an Everbridge posting, "join our Auckland engineering
// team") stays governed by the earlier fix and correctly survives — this
// block is specifically about the *multi-country enumeration* case.
describe('applyFilters — closed multi-country location list is a real restriction', () => {
  const apacProfile = {
    ...testProfile,
    location: {
      basedIn: 'Thailand',
      workTypes: ['remote'],
      acceptedRegions: ['worldwide', 'apac', 'asia', 'thailand'],
      excludeOutsideAcceptedRegions: true,
    },
  } as unknown as FilterProfile;
  const apac = createFilters(apacProfile).applyFilters;

  it('drops the Sauce-shaped posting: "Brazil (Remote), Canada (Remote)", neither accepted', () => {
    const job = makeJob({
      title: 'Remote AI Staff Engineer',
      location: 'Brazil (Remote), Canada (Remote)',
      body: 'Join Sauce, a restaurant technology platform, as an AI Staff Engineer. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(0);
  });

  it('keeps a single named place (Auckland) — not an enumeration, team-hub language only', () => {
    const job = makeJob({
      title: 'Staff Software Engineer',
      location: 'Auckland',
      body: 'Join our Auckland engineering team building an agentic AI platform. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('keeps a list of CITIES within one country — likely office hubs, not a hiring boundary', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'New York, San Francisco, Austin (Remote)',
      body: 'Join one of our US hubs. react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('keeps a multi-country list when one of the listed countries IS accepted', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Thailand (Remote), Vietnam (Remote)',
      body: 'react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('keeps a multi-country list rescued by a worldwide/catch-all term alongside it', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Worldwide, Canada',
      body: 'react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });

  it('is inert for a single country alone (governed by the bare-location fix, not this rule)', () => {
    const job = makeJob({
      title: 'Senior Software Engineer',
      location: 'Canada (Remote)',
      body: 'react typescript next.js.',
    });
    expect(apac([job]).kept).toHaveLength(1);
  });
});
