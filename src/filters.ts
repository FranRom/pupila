import { readFile } from 'node:fs/promises';
import type { Category, Job, JobSignals, LocationProfile, RoleInterest } from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

/** Escape a plain location term so it's safe to drop into a regex alternation. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Profile is loaded at runtime (not statically imported) so that:
//   (a) config/profile.json can be gitignored — it's personal data
//       (sector preferences, stack, what specialties to avoid),
//   (b) missing profile produces a clear actionable error at startup
//       rather than a build-time module resolution failure.
// Universal scoring rules (junior excludes, US-only filter, etc.) still
// live in the JSON alongside the personal slices — the file is a single
// source of truth even though it's not committed.
export interface FilterScoring {
  minScoreToKeep: number;
  maxScore: number;
  scoringBodyMaxChars: number;
}

export interface FilterWeights {
  web3TitleBody: number;
  web3Stack: number;
  aiTitleBody: number;
  aiStack: number;
  stackPrimary: number;
  stackRn: number;
  stackOther: number;
  // Shared per-match bonus for any role interest (title match / body phrases).
  // The role definitions themselves live in `FilterProfile.roles`.
  roleTitle: number;
  roleBody: number;
  leadTitle: number;
  seniorTitle: number;
  locationRemote: number;
  freshness7d: number;
  freshness14d: number;
  // Negative penalty for a job region-locked outside the candidate's accepted
  // regions (persona-neutral; replaces the old US-centric penalty).
  outOfRegionPenalty: number;
}

export interface FilterProfile {
  scoring: FilterScoring;
  weights: FilterWeights;
  // Keywords map allows `_comment_*` string keys alongside arrays — the
  // accessor in createFilters casts through unknown and only reads arrays.
  keywords: Record<string, readonly string[] | string | undefined>;
  // Target job titles the candidate is interested in. A title matching any
  // role's `titleMatch` earns the `roleTitle` bonus, is tagged in
  // `Job.roleMatches`, and is rescued from the title-based hard drops.
  // Optional so older/minimal profiles still load (treated as no roles).
  roles?: readonly RoleInterest[];
  // Candidate location preferences. When present, drives the persona-neutral
  // geo filter + location scoring. Optional so older/minimal profiles still
  // load (the geo hard-drop is inert without it).
  location?: LocationProfile;
}

/** Loads and parses config/profile.json. Throws ENOENT if missing — callers should gate. */
export async function loadProfile(path = 'config/profile.json'): Promise<FilterProfile> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as FilterProfile;
}

// Match-nothing regex for empty keyword lists. `(?!)` is a negative lookahead
// of the empty string, which is impossible — so .test() always returns false
// and .match() always returns null. Lets callers pass empty arrays without
// special-casing.
const NEVER_MATCH = /(?!)/;
const NEVER_MATCH_GLOBAL = /(?!)/g;

// Neutral, universal vocabulary for "this is a remote/flexible arrangement"
// rather than a place. Stripped from a job's stated location to decide whether
// what remains names a specific region. Persona-agnostic — not a preference.
const GENERIC_REMOTE_TOKENS =
  /\b(remote|worldwide|world ?wide|global|globally|anywhere|hybrid|on[- ]?site|onsite|distributed|flexible|work from home|wfh|n\/?a|tbd|various|multiple|locations?)\b/gi;

// Defensive compile — a single bad regex fragment (likely from an
// LLM-generated profile.json) would otherwise crash `pnpm run dev` at
// startup. Falls back to NEVER_MATCH and warns so the bad keyword group is
// disabled rather than fatal.
function compileKw(fragments: readonly string[] | undefined): RegExp {
  if (!fragments || fragments.length === 0) return NEVER_MATCH;
  try {
    return new RegExp(`\\b(${fragments.join('|')})\\b`, 'i');
  } catch (err) {
    console.warn(
      `[filters] compileKw failed for keyword group; falling back to NEVER_MATCH. Fragments: ${JSON.stringify(fragments).slice(0, 200)}. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NEVER_MATCH;
  }
}

function compileKwGlobal(fragments: readonly string[] | undefined): RegExp {
  if (!fragments || fragments.length === 0) return NEVER_MATCH_GLOBAL;
  try {
    return new RegExp(`\\b(${fragments.join('|')})\\b`, 'gi');
  } catch (err) {
    console.warn(
      `[filters] compileKwGlobal failed for keyword group; falling back to NEVER_MATCH. Fragments: ${JSON.stringify(fragments).slice(0, 200)}. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NEVER_MATCH_GLOBAL;
  }
}

function countMatches(re: RegExp, text: string): number {
  return text.match(re)?.length ?? 0;
}

// Tier the binary keyword score by occurrence count: 1 mention is half-weight,
// 2-3 is the original weight, 4+ gets a 1.5× boost. Lets a body where "react"
// appears 8 times outscore one where it appears once in a "nice to have" list.
function tieredWeight(count: number, baseWeight: number): number {
  if (count === 0) return 0;
  if (count === 1) return Math.floor(baseWeight * 0.5);
  if (count <= 3) return baseWeight;
  return Math.floor(baseWeight * 1.5);
}

export const BOILERPLATE_HEADERS_RE =
  /\b(equal opportunity employer|eeo (statement|notice)|privacy notice|notice (to|for) (applicants|candidates)|reasonable accommodations?|diversity and inclusion|our commitment to diversity|background check|e-verify|why join (us|<company>)|about (us|<company>|the company|our company))\b[\s\S]*$/i;

export interface FilterResult {
  kept: Job[];
  droppedHard: number;
  droppedScore: number;
  droppedByRule: Record<string, number>;
}

interface HardRule {
  name: string;
  test: (job: Job) => boolean;
}

export interface FilterApi {
  applyFilters(jobs: Job[]): FilterResult;
}

/**
 * Build a filter that uses the supplied profile config. Production code uses
 * the on-disk `config/profile.json` (re-exported as `applyFilters` below);
 * tests pass their own fixture so weights/keyword changes in `config/` don't
 * break test assertions.
 */
export function createFilters(profile: FilterProfile): FilterApi {
  const W = profile.weights;
  const S = profile.scoring;
  // The profile JSON intentionally allows `_comment_*` string keys for
  // human-readable docs alongside the keyword arrays. Cast through `unknown`
  // to access only the array-valued lookups.
  const K = profile.keywords as unknown as Record<string, readonly string[] | undefined>;

  const TITLE_JUNIOR = compileKw(K.junior);
  const TITLE_SENIOR_REQ = compileKw(K.seniorReq);
  const TITLE_ENGINEERING_KW = compileKw(K.engineering);
  const NON_ENGINEERING = compileKw(K.nonEngineering);
  const TITLE_NON_ENG_COMPOUND = compileKw(K.titleNonEngCompound);
  const TITLE_NON_ENG_LEADERSHIP = compileKw(K.titleNonEngLeadership);
  const TITLE_EXCLUDED_SPECIALTIES = compileKw(K.titleExcludedSpecialties);
  const TITLE_NON_ENG_ROLE = compileKw(K.titleNonEngRole);
  const TITLE_NON_TECH_ROLE = compileKw(K.titleNonTechRole);
  const W3_TITLE_BODY = compileKw(K.w3TitleBody);
  const W3_STACK = compileKw(K.w3Stack);
  const AI_TITLE_BODY = compileKw(K.aiTitleBody);
  const AI_STACK = compileKw(K.aiStack);
  const STACK_PRIMARY_G = compileKwGlobal(K.stackPrimary);
  const STACK_RN_G = compileKwGlobal(K.stackRn);
  const STACK_OTHER_G = compileKwGlobal(K.stackOther);
  const TITLE_LEAD = compileKw(K.titleLead);
  const TITLE_SENIOR = compileKw(K.titleSenior);
  // Role interests: each carries its own title/body keyword lists. The shared
  // `roleTitle` / `roleBody` weights price a match; the role list itself prices
  // nothing. Inert when `roles` is empty (NEVER_MATCH regexes).
  const ROLES = (profile.roles ?? []).map((role) => ({
    id: role.id,
    title: compileKw(role.titleMatch),
    body: compileKwGlobal(role.bodyMatch),
  }));
  // ── Persona-neutral geo signals ──────────────────────────────────────────
  // Neutral, country-agnostic *extraction* groups (universal, in profile.json):
  //   locationLock    — "this posting is geographically constrained" (onsite-only,
  //                      must-be-located/authorized-in, timezone-required, …)
  //   onsiteOnly      — the subset of locks that mean strictly on-site
  //   worldwideRemote — "open to anyone anywhere" (worldwide / global / anywhere)
  // The keep/drop *decision* compares those against the candidate's profile:
  //   acceptedRegions / basedIn supply the rescue terms; workTypes gate on-site.
  const LOCATION_LOCK = compileKw(K.locationLock);
  const ONSITE_ONLY = compileKw(K.onsiteOnly);
  const WORLDWIDE_REMOTE = compileKw(K.worldwideRemote);
  const loc = profile.location;
  // acceptedRegions / basedIn are plain location names → escape before joining
  // so a stray metachar can't break (or widen) the compiled alternation.
  const ACCEPTED_REGIONS = compileKw(loc?.acceptedRegions?.map(escapeRegExp));
  const BASED_IN = compileKw(loc?.basedIn?.trim() ? [escapeRegExp(loc.basedIn.trim())] : undefined);
  const acceptsOnsite = loc?.workTypes?.includes('onsite') ?? false;
  const acceptsRemote = loc?.workTypes?.includes('remote') ?? true;
  // No region preference expressed → region drops/penalties stay inert (a fresh
  // fork accepts everywhere until the candidate sets regions). The work-type
  // gate still applies independently.
  const hasRegionPrefs = (loc?.acceptedRegions?.length ?? 0) > 0 || !!loc?.basedIn?.trim();
  // Fallback remote group for profiles with no `location` block (back-compat).
  const LOC_REMOTE = compileKw(K.locationRemote);

  // A job's haystack names a region the candidate will work in: an accepted
  // region, their home country, or open-to-anywhere remote. Deliberately does
  // NOT treat a bare "remote" as accepted — a remote-friendly posting can still
  // carry an incompatible lock (e.g. "remote, EST hours required").
  function regionAccepted(haystack: string): boolean {
    return (
      WORLDWIDE_REMOTE.test(haystack) || ACCEPTED_REGIONS.test(haystack) || BASED_IN.test(haystack)
    );
  }

  // True when the job's *stated location* names a specific place the candidate
  // doesn't accept. Generic-remote tokens are neutral vocabulary (not a region),
  // so "Remote" alone → residual empty → not out-of-region; "Remote, USA" →
  // residual "usa" → out-of-region unless USA is an accepted region.
  function locationFieldOutOfRegion(location: string | null): boolean {
    if (!location) return false;
    if (regionAccepted(location)) return false;
    const residual = location
      .toLowerCase()
      .replace(GENERIC_REMOTE_TOKENS, ' ')
      .replace(/[^a-z]+/g, ' ')
      .trim();
    return residual.length > 0;
  }

  function preparedScoringBody(rawBody: string): string {
    const stripped = rawBody.replace(BOILERPLATE_HEADERS_RE, '').trim();
    return stripped.slice(0, S.scoringBodyMaxChars);
  }

  const HARD_RULES: readonly HardRule[] = [
    { name: 'unsafe_url', test: (job) => !isSafeUrl(job.url) },
    { name: 'junior_title', test: (job) => TITLE_JUNIOR.test(job.title) },
    { name: 'missing_senior_req', test: (job) => !TITLE_SENIOR_REQ.test(job.title) },
    {
      // Persona-neutral geo drop. No country is privileged — "US" is just one
      // possible region the candidate may or may not accept. Inert without a
      // `location` profile (older/minimal profiles still load). Two ways to
      // drop, both driven entirely by the candidate's profile:
      //   1. Work-type: the posting is strictly on-site and the candidate
      //      doesn't accept on-site work (and it isn't flagged remote).
      //   2. Region: the posting is geo-constrained to somewhere outside the
      //      candidate's accepted regions and isn't worldwide-remote — only
      //      when they've opted into hard-excluding (excludeOutsideAcceptedRegions).
      name: 'hard_location_incompatible',
      test: (job) => {
        if (!loc) return false;
        const haystack = `${job.location ?? ''}\n${job.body}`;

        // Work-type gate: a strictly on-site posting the candidate won't take.
        if (!acceptsOnsite && !job.remote && ONSITE_ONLY.test(haystack)) return true;

        // Region gate — opt-in, and only when a region preference exists.
        if (!hasRegionPrefs || !loc.excludeOutsideAcceptedRegions) return false;
        // Rescue first: if the posting names a region we accept (or is
        // worldwide-remote) ANYWHERE in its text, keep it — even if a label like
        // "Remote - US" also appears. A US-based company that hires across Europe
        // is a job we want. This is the key: drop only genuine *requirements*.
        if (regionAccepted(haystack)) return false;
        // No accepted region anywhere. Drop when the posting is geo-constrained:
        // (a) its stated location names a specific place, or
        // (b) its body declares a real location/authorization/timezone requirement.
        if (locationFieldOutOfRegion(job.location)) return true;
        if (LOCATION_LOCK.test(haystack)) return true;
        return false;
      },
    },
    {
      name: 'non_engineering',
      test: (job) =>
        NON_ENGINEERING.test(`${job.title}\n${job.body}`) && !TITLE_ENGINEERING_KW.test(job.title),
    },
    { name: 'title_non_eng_compound', test: (job) => TITLE_NON_ENG_COMPOUND.test(job.title) },
    { name: 'title_non_eng_leadership', test: (job) => TITLE_NON_ENG_LEADERSHIP.test(job.title) },
    {
      // Inert when titleExcludedSpecialties is empty (NEVER_MATCH regex).
      name: 'title_excluded_specialty',
      test: (job) => TITLE_EXCLUDED_SPECIALTIES.test(job.title),
    },
    { name: 'title_non_eng_role', test: (job) => TITLE_NON_ENG_ROLE.test(job.title) },
    { name: 'title_non_tech_role', test: (job) => TITLE_NON_TECH_ROLE.test(job.title) },
  ];

  // Hard-drops that a declared role interest overrides: if the title matches a
  // role the candidate is targeting, these title-based exclusions don't apply
  // (so e.g. a "Product Engineer" survives even when "product" looks non-eng).
  // Person-level drops (junior, missing-senior, location, unsafe-url) always apply.
  const ROLE_RESCUABLE_RULES = new Set([
    'non_engineering',
    'title_excluded_specialty',
    'title_non_eng_role',
  ]);

  function applyFilters(jobs: Job[]): FilterResult {
    let droppedHard = 0;
    let droppedScore = 0;
    const kept: Job[] = [];
    const droppedByRule: Record<string, number> = {};

    for (const job of jobs) {
      const title = job.title;
      const body = job.body;

      // Role interests whose title pattern fires on this title (role-list order).
      // Computed up front because it both scores and rescues from hard drops.
      const roleMatches = ROLES.filter((r) => r.title.test(title)).map((r) => r.id);
      const rescued = roleMatches.length > 0;

      const violated = HARD_RULES.find((rule) =>
        rescued && ROLE_RESCUABLE_RULES.has(rule.name) ? false : rule.test(job),
      );
      if (violated) {
        droppedHard++;
        droppedByRule[violated.name] = (droppedByRule[violated.name] ?? 0) + 1;
        continue;
      }

      const scoringBody = preparedScoringBody(body);
      const scoringTitleAndBody = `${title}\n${scoringBody}`;
      const locText = `${job.location ?? ''} ${scoringBody}`;
      const fresh7 = withinDays(job.postedAt, 7);

      // Strongest role-body keyword count across all roles (priced by roleBody).
      const roleBodyCount = ROLES.reduce(
        (max, r) => Math.max(max, countMatches(r.body, scoringBody)),
        0,
      );

      const positives = {
        web3TitleBody: W3_TITLE_BODY.test(scoringTitleAndBody) ? W.web3TitleBody : 0,
        web3Stack: W3_STACK.test(scoringBody) ? W.web3Stack : 0,
        aiTitleBody: AI_TITLE_BODY.test(scoringTitleAndBody) ? W.aiTitleBody : 0,
        aiStack: AI_STACK.test(scoringBody) ? W.aiStack : 0,
        stackPrimary: tieredWeight(countMatches(STACK_PRIMARY_G, scoringBody), W.stackPrimary),
        stackRn: tieredWeight(countMatches(STACK_RN_G, scoringBody), W.stackRn),
        stackOther: tieredWeight(countMatches(STACK_OTHER_G, scoringBody), W.stackOther),
        leadTitle: TITLE_LEAD.test(title) ? W.leadTitle : 0,
        seniorTitle: TITLE_SENIOR.test(title) ? W.seniorTitle : 0,
        roleTitle: roleMatches.length > 0 ? W.roleTitle : 0,
        roleBody: tieredWeight(roleBodyCount, W.roleBody),
        locationRemote: (
          loc
            ? regionAccepted(locText) || (job.remote && acceptsRemote)
            : LOC_REMOTE.test(locText)
        )
          ? W.locationRemote
          : 0,
        freshness7d: fresh7 ? W.freshness7d : 0,
        freshness14d: !fresh7 && withinDays(job.postedAt, 14) ? W.freshness14d : 0,
      };

      const positiveSum = Object.values(positives).reduce((a, b) => a + b, 0);
      const web3 = positives.web3TitleBody > 0 || positives.web3Stack > 0;
      const ai = positives.aiTitleBody > 0 || positives.aiStack > 0;

      const signals: JobSignals = {
        ...positives,
        outOfRegionPenalty: 0,
        rawTotal: positiveSum,
        capped: positiveSum > S.maxScore,
      };

      let score = Math.min(positiveSum, S.maxScore);

      // Out-of-region soft penalty: a geo-locked posting outside the accepted
      // regions that the candidate hasn't opted to hard-exclude. (When they HAVE
      // opted in, such postings were already hard-dropped above.)
      if (loc && hasRegionPrefs && !loc.excludeOutsideAcceptedRegions) {
        const haystack = `${job.location ?? ''}\n${body}`;
        // Same rescue-first logic as the hard rule: only penalize a posting that
        // names no accepted region AND is geo-constrained elsewhere.
        const outOfRegion =
          !regionAccepted(haystack) &&
          (locationFieldOutOfRegion(job.location) || LOCATION_LOCK.test(haystack));
        if (outOfRegion) {
          signals.outOfRegionPenalty = W.outOfRegionPenalty;
          score += W.outOfRegionPenalty;
        }
      }

      if (score < S.minScoreToKeep) {
        droppedScore++;
        continue;
      }

      let category: Category = 'general';
      if (web3 && ai) category = 'web3+ai';
      else if (web3) category = 'web3';
      else if (ai) category = 'ai';

      kept.push({ ...job, fitScore: score, category, roleMatches, _signals: signals });
    }

    return { kept, droppedHard, droppedScore, droppedByRule };
  }

  return { applyFilters };
}
