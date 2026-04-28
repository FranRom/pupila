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
}

export function applyFilters(jobs: Job[]): FilterResult {
  let droppedHard = 0;
  let droppedScore = 0;
  const kept: Job[] = [];

  for (const job of jobs) {
    const title = job.title;
    const body = job.body;
    const scoringBody = preparedScoringBody(body);
    const scoringTitleAndBody = `${title}\n${scoringBody}`;

    if (!isSafeUrl(job.url)) {
      droppedHard++;
      continue;
    }
    if (TITLE_JUNIOR.test(title)) {
      droppedHard++;
      continue;
    }
    if (!TITLE_SENIOR_REQ.test(title)) {
      droppedHard++;
      continue;
    }
    if (BODY_HARD_US_OR_ONSITE.test(body)) {
      droppedHard++;
      continue;
    }
    const fullTitleAndBody = `${title}\n${body}`;
    if (NON_ENGINEERING.test(fullTitleAndBody) && !TITLE_ENGINEERING_KW.test(title)) {
      droppedHard++;
      continue;
    }
    if (TITLE_NON_ENG_COMPOUND.test(title)) {
      droppedHard++;
      continue;
    }
    if (TITLE_NON_ENG_LEADERSHIP.test(title)) {
      droppedHard++;
      continue;
    }
    if (TITLE_NON_FRONTEND_ENG.test(title)) {
      droppedHard++;
      continue;
    }
    if (TITLE_NON_ENG_ROLE.test(title)) {
      droppedHard++;
      continue;
    }
    if (TITLE_NON_TECH_ROLE.test(title)) {
      droppedHard++;
      continue;
    }

    const signals: JobSignals = {
      web3TitleBody: 0,
      web3Stack: 0,
      aiTitleBody: 0,
      aiStack: 0,
      stackPrimary: 0,
      stackRn: 0,
      stackOther: 0,
      leadTitle: 0,
      seniorTitle: 0,
      frontendTitle: 0,
      frontendBody: 0,
      locationRemote: 0,
      freshness7d: 0,
      freshness14d: 0,
      usCentricPenalty: 0,
      rawTotal: 0,
      capped: false,
    };
    let web3 = false;
    let ai = false;

    if (W3_TITLE_BODY.test(scoringTitleAndBody)) {
      signals.web3TitleBody = W.web3TitleBody;
      web3 = true;
    }
    if (W3_STACK.test(scoringBody)) {
      signals.web3Stack = W.web3Stack;
      web3 = true;
    }
    if (AI_TITLE_BODY.test(scoringTitleAndBody)) {
      signals.aiTitleBody = W.aiTitleBody;
      ai = true;
    }
    if (AI_STACK.test(scoringBody)) {
      signals.aiStack = W.aiStack;
      ai = true;
    }
    if (STACK_PRIMARY.test(scoringBody)) signals.stackPrimary = W.stackPrimary;
    if (STACK_RN.test(scoringBody)) signals.stackRn = W.stackRn;
    if (STACK_OTHER.test(scoringBody)) signals.stackOther = W.stackOther;
    if (TITLE_LEAD.test(title)) signals.leadTitle = W.leadTitle;
    if (TITLE_SENIOR.test(title)) signals.seniorTitle = W.seniorTitle;
    if (TITLE_FRONTEND_KW.test(title)) signals.frontendTitle = W.frontendTitle;
    if (BODY_FRONTEND_KW.test(scoringBody)) signals.frontendBody = W.frontendBody;

    const locText = `${job.location ?? ''} ${scoringBody}`;
    if (LOC_REMOTE.test(locText)) signals.locationRemote = W.locationRemote;

    if (withinDays(job.postedAt, 7)) signals.freshness7d = W.freshness7d;
    else if (withinDays(job.postedAt, 14)) signals.freshness14d = W.freshness14d;

    const positiveSum =
      signals.web3TitleBody +
      signals.web3Stack +
      signals.aiTitleBody +
      signals.aiStack +
      signals.stackPrimary +
      signals.stackRn +
      signals.stackOther +
      signals.leadTitle +
      signals.seniorTitle +
      signals.frontendTitle +
      signals.frontendBody +
      signals.locationRemote +
      signals.freshness7d +
      signals.freshness14d;
    signals.rawTotal = positiveSum;
    signals.capped = positiveSum > S.maxScore;

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

  return { kept, droppedHard, droppedScore };
}
