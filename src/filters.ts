import profile from '../config/profile.json' with { type: 'json' };
import type { Category, Job, JobSignals } from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

const W = profile.weights;
const S = profile.scoring;

function compileKw(fragments: readonly string[]): RegExp {
  return new RegExp(`\\b(${fragments.join('|')})\\b`, 'i');
}

const TITLE_JUNIOR = compileKw(profile.keywords.junior);
const TITLE_SENIOR_REQ = compileKw(profile.keywords.seniorReq);
const TITLE_ENGINEERING_KW = compileKw(profile.keywords.engineering);
const NON_ENGINEERING = compileKw(profile.keywords.nonEngineering);
const TITLE_NON_ENG_COMPOUND = compileKw(profile.keywords.titleNonEngCompound);
const TITLE_NON_ENG_LEADERSHIP = compileKw(profile.keywords.titleNonEngLeadership);
const TITLE_NON_FRONTEND_ENG = compileKw(profile.keywords.titleNonFrontendEng);
const TITLE_NON_ENG_ROLE = compileKw(profile.keywords.titleNonEngRole);
const TITLE_NON_TECH_ROLE = compileKw(profile.keywords.titleNonTechRole);
const BODY_HARD_US_OR_ONSITE = compileKw(profile.keywords.bodyHardUsOrOnsite);
const W3_TITLE_BODY = compileKw(profile.keywords.w3TitleBody);
const W3_STACK = compileKw(profile.keywords.w3Stack);
const AI_TITLE_BODY = compileKw(profile.keywords.aiTitleBody);
const AI_STACK = compileKw(profile.keywords.aiStack);
const STACK_PRIMARY = compileKw(profile.keywords.stackPrimary);
const STACK_RN = compileKw(profile.keywords.stackRn);
const STACK_OTHER = compileKw(profile.keywords.stackOther);
const TITLE_LEAD = compileKw(profile.keywords.titleLead);
const TITLE_SENIOR = compileKw(profile.keywords.titleSenior);
const TITLE_FRONTEND_KW = compileKw(profile.keywords.titleFrontend);
const BODY_FRONTEND_KW = compileKw(profile.keywords.bodyFrontend);
const LOC_REMOTE = compileKw(profile.keywords.locationRemote);
const REMOTE_WORLD = compileKw(profile.keywords.remoteWorld);
const US_CENTRIC_SOFT = compileKw(profile.keywords.usCentricSoft);

const BOILERPLATE_HEADERS_RE =
  /\b(equal opportunity employer|eeo (statement|notice)|privacy notice|notice (to|for) (applicants|candidates)|reasonable accommodations?|diversity and inclusion|our commitment to diversity|background check|e-verify|why join (us|<company>)|about (us|<company>|the company|our company))\b[\s\S]*$/i;

function preparedScoringBody(rawBody: string): string {
  const stripped = rawBody.replace(BOILERPLATE_HEADERS_RE, '').trim();
  return stripped.slice(0, S.scoringBodyMaxChars);
}

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
  { name: 'title_non_frontend_eng', test: (job) => TITLE_NON_FRONTEND_ENG.test(job.title) },
  { name: 'title_non_eng_role', test: (job) => TITLE_NON_ENG_ROLE.test(job.title) },
  { name: 'title_non_tech_role', test: (job) => TITLE_NON_TECH_ROLE.test(job.title) },
];

export function applyFilters(jobs: Job[]): FilterResult {
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
      stackPrimary: STACK_PRIMARY.test(scoringBody) ? W.stackPrimary : 0,
      stackRn: STACK_RN.test(scoringBody) ? W.stackRn : 0,
      stackOther: STACK_OTHER.test(scoringBody) ? W.stackOther : 0,
      leadTitle: TITLE_LEAD.test(title) ? W.leadTitle : 0,
      seniorTitle: TITLE_SENIOR.test(title) ? W.seniorTitle : 0,
      frontendTitle: TITLE_FRONTEND_KW.test(title) ? W.frontendTitle : 0,
      frontendBody: BODY_FRONTEND_KW.test(scoringBody) ? W.frontendBody : 0,
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
