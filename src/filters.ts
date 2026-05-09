import profileJson from '../config/profile.json' with { type: 'json' };
import type { Category, Job, JobSignals } from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

export type FilterProfile = typeof profileJson;

// Match-nothing regex for empty keyword lists. `(?!)` is a negative lookahead
// of the empty string, which is impossible — so .test() always returns false
// and .match() always returns null. Lets callers pass empty arrays without
// special-casing.
const NEVER_MATCH = /(?!)/;
const NEVER_MATCH_GLOBAL = /(?!)/g;

function compileKw(fragments: readonly string[] | undefined): RegExp {
  if (!fragments || fragments.length === 0) return NEVER_MATCH;
  return new RegExp(`\\b(${fragments.join('|')})\\b`, 'i');
}

function compileKwGlobal(fragments: readonly string[] | undefined): RegExp {
  if (!fragments || fragments.length === 0) return NEVER_MATCH_GLOBAL;
  return new RegExp(`\\b(${fragments.join('|')})\\b`, 'gi');
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

const BOILERPLATE_HEADERS_RE =
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
  const W3_TITLE_BODY = compileKw(K.w3TitleBody);
  const W3_STACK = compileKw(K.w3Stack);
  const AI_TITLE_BODY = compileKw(K.aiTitleBody);
  const AI_STACK = compileKw(K.aiStack);
  const STACK_PRIMARY_G = compileKwGlobal(K.stackPrimary);
  const STACK_RN_G = compileKwGlobal(K.stackRn);
  const STACK_OTHER_G = compileKwGlobal(K.stackOther);
  const TITLE_LEAD = compileKw(K.titleLead);
  const TITLE_SENIOR = compileKw(K.titleSenior);
  const TITLE_FRONTEND_KW = compileKw(K.titleFrontend);
  const BODY_FRONTEND_KW_G = compileKwGlobal(K.bodyFrontend);
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
    { name: 'hard_us_or_onsite', test: (job) => BODY_HARD_US_OR_ONSITE.test(job.body) },
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

  function applyFilters(jobs: Job[]): FilterResult {
    let droppedHard = 0;
    let droppedScore = 0;
    const kept: Job[] = [];
    const droppedByRule: Record<string, number> = {};

    for (const job of jobs) {
      const title = job.title;
      const body = job.body;

      const violated = HARD_RULES.find((rule) => rule.test(job));
      if (violated) {
        droppedHard++;
        droppedByRule[violated.name] = (droppedByRule[violated.name] ?? 0) + 1;
        continue;
      }

      const scoringBody = preparedScoringBody(body);
      const scoringTitleAndBody = `${title}\n${scoringBody}`;
      const locText = `${job.location ?? ''} ${scoringBody}`;
      const fresh7 = withinDays(job.postedAt, 7);

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
        frontendTitle: TITLE_FRONTEND_KW.test(title) ? W.frontendTitle : 0,
        frontendBody: tieredWeight(countMatches(BODY_FRONTEND_KW_G, scoringBody), W.frontendBody),
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

      kept.push({ ...job, fitScore: score, category, _signals: signals });
    }

    return { kept, droppedHard, droppedScore, droppedByRule };
  }

  return { applyFilters };
}

const defaultFilter = createFilters(profileJson);
export const applyFilters = defaultFilter.applyFilters;
