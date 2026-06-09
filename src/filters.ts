import { readFile } from 'node:fs/promises';
import type { Category, Job, JobSignals, RoleInterest } from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

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
  usCentricPenalty: number;
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
  const BODY_HARD_US_OR_ONSITE = compileKw(K.bodyHardUsOrOnsite);
  const NON_US_RESCUE = compileKw(K.nonUsRescue);
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
  const LOC_REMOTE = compileKw(K.locationRemote);
  const REMOTE_WORLD = compileKw(K.remoteWorld);
  const US_CENTRIC_SOFT = compileKw(K.usCentricSoft);

  function preparedScoringBody(rawBody: string): string {
    const stripped = rawBody.replace(BOILERPLATE_HEADERS_RE, '').trim();
    return stripped.slice(0, S.scoringBodyMaxChars);
  }

  const HARD_RULES: readonly HardRule[] = [
    { name: 'unsafe_url', test: (job) => !isSafeUrl(job.url) },
    { name: 'junior_title', test: (job) => TITLE_JUNIOR.test(job.title) },
    { name: 'missing_senior_req', test: (job) => !TITLE_SENIOR_REQ.test(job.title) },
    {
      // Includes job.location so a posting whose body never mentions geography
      // but whose location field says "United States" still drops. The rescue
      // skips the drop if the same haystack also mentions a non-US region the
      // candidate can target (worldwide / EMEA / Europe).
      name: 'hard_us_or_onsite',
      test: (job) => {
        const haystack = `${job.location ?? ''}\n${job.body}`;
        if (!BODY_HARD_US_OR_ONSITE.test(haystack)) return false;
        return !NON_US_RESCUE.test(haystack);
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
        locationRemote: LOC_REMOTE.test(locText) ? W.locationRemote : 0,
        freshness7d: fresh7 ? W.freshness7d : 0,
        freshness14d: !fresh7 && withinDays(job.postedAt, 14) ? W.freshness14d : 0,
      };

      const positiveSum = Object.values(positives).reduce((a, b) => a + b, 0);
      const web3 = positives.web3TitleBody > 0 || positives.web3Stack > 0;
      const ai = positives.aiTitleBody > 0 || positives.aiStack > 0;

      const signals: JobSignals = {
        ...positives,
        usCentricPenalty: 0,
        rawTotal: positiveSum,
        capped: positiveSum > S.maxScore,
      };

      let score = Math.min(positiveSum, S.maxScore);

      if (US_CENTRIC_SOFT.test(body) && !REMOTE_WORLD.test(body)) {
        signals.usCentricPenalty = W.usCentricPenalty;
        score += W.usCentricPenalty;
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
