import type { Category, Job, JobSignals } from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

const SCORING_BODY_MAX_CHARS = 1500;

const BOILERPLATE_HEADERS_RE =
  /\b(equal opportunity employer|eeo (statement|notice)|privacy notice|notice (to|for) (applicants|candidates)|reasonable accommodations?|diversity and inclusion|our commitment to diversity|background check|e-verify|why join (us|<company>)|about (us|<company>|the company|our company))\b[\s\S]*$/i;

function preparedScoringBody(rawBody: string): string {
  const stripped = rawBody.replace(BOILERPLATE_HEADERS_RE, '').trim();
  return stripped.slice(0, SCORING_BODY_MAX_CHARS);
}

const TITLE_JUNIOR = /\b(junior|jr|intern|entry-?level|associate|graduate|trainee|apprentice)\b/i;

const TITLE_SENIOR_REQ =
  /\b(senior|sr|staff|principal|lead|head|director|engineers?|developers?|architects?)\b/i;

const BODY_HARD_US_OR_ONSITE =
  /\b(must be (authorized|located)[\s\S]{0,40}(united states|US only|US-based only|US citizen)|onsite only|on-site only|in-office only|relocate to (san francisco|new york|nyc))\b/i;

const NON_ENGINEERING =
  /\b(marketing|sales|recruiter|community manager|customer support|business development|legal|compliance|hr |finance |accountant)\b/i;

const TITLE_NON_ENG_COMPOUND =
  /\b(customer (support|success) engineer|sales engineers?|solutions? engineers?|developer (relations|advocate|experience|marketing)|devrel|dev[- ]rel|field engineering|field operations|business operations|sales operations|people operations|partnerships? engineers?|partner engineers?|technical (sourcer|recruiter)|community engineers?|customer engineers?|forward deployed engineers?|implementation engineers?|onboarding engineers?|go[- ]to[- ]market|gtm)\b/i;

const TITLE_NON_ENG_LEADERSHIP =
  /\b(vice president|\bvp\b|chief (operating|marketing|revenue|financial) officer|cmo|cro|cfo|coo)\b/i;

const TITLE_NON_FRONTEND_ENG =
  /\b(security|data|devops|sre|site reliability|reliability|infrastructure|compliance|network|systems|qa|test|automation|hardware|firmware|embedded|integration|application security|appsec|cloud security|product security) engineers?\b/i;

const TITLE_NON_ENG_ROLE =
  /\b(growth|account|customer|product|project|program|brand|content|partnerships?|community|country|regional|market|business|operations|recruiting|talent|sales|marketing|category) (manager|lead|director|head)s?\b/i;

const TITLE_NON_TECH_ROLE =
  /\b(analyst|otc trader|trader|broker|underwriter|portfolio manager|wealth manager|investment manager|data scientist|data science|researcher|economist)\b/i;

const TITLE_FRONTEND_KW =
  /\b(frontend|front-end|fullstack|full-stack|full stack|mobile|web|ui|ux|react)\b/i;

const BODY_FRONTEND_KW =
  /\b(react components?|design system|ship (the )?ui|frontend codebase|single[- ]page application|spa\b|pixel[- ]perfect|responsive design|user interface|accessibility|a11y|css-in-js|web vitals|core web vitals|browser performance|hydration|server[- ]side rendering|ssr|csr|client[- ]side rendering|component library|storybook|figma)\b/i;

const TITLE_ENGINEERING_KW =
  /\b(engineers?|developers?|architects?|programmers?|tech lead|cto|engineering)\b/i;

const W3_TITLE_BODY = /\b(web3|crypto|defi|blockchain|wallet|onchain|on-chain|dapp|nft)\b/i;

const W3_STACK =
  /\b(wagmi|viem|ethers\.?js|web3\.?js|solana|anchor|evm|rainbowkit|walletconnect|reown|hardhat|foundry)\b/i;

const AI_TITLE_BODY = /\b(ai engineer|ml engineer|llm|gen-?ai|generative ai|ai-native)\b/i;

const AI_STACK =
  /\b(anthropic|claude|openai|gpt|vercel ai|ai sdk|langchain|llamaindex|rag|agents?|mcp|prompt engineering)\b/i;

const STACK_PRIMARY = /\b(react|next\.?js|typescript)\b/i;
const STACK_RN = /\b(react native|expo)\b/i;
const STACK_OTHER = /\b(graphql|tailwind|vite)\b/i;

const TITLE_LEAD = /\b(lead|staff|principal|head)\b/i;
const TITLE_SENIOR = /\b(senior|sr)\b/i;

const LOC_REMOTE = /\b(remote|worldwide|emea|europe|cet|spain|global|anywhere)\b/i;

const US_CENTRIC_SOFT =
  /\b(EST hours required|US-only|US only|US-based only|must be (located|authorized) in (the )?(united states|US|america))\b/i;

const REMOTE_WORLD = /\b(remote|worldwide|emea|europe|cet|global|anywhere)\b/i;

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
      signals.web3TitleBody = 20;
      web3 = true;
    }
    if (W3_STACK.test(scoringBody)) {
      signals.web3Stack = 20;
      web3 = true;
    }
    if (AI_TITLE_BODY.test(scoringTitleAndBody)) {
      signals.aiTitleBody = 20;
      ai = true;
    }
    if (AI_STACK.test(scoringBody)) {
      signals.aiStack = 20;
      ai = true;
    }
    if (STACK_PRIMARY.test(scoringBody)) signals.stackPrimary = 10;
    if (STACK_RN.test(scoringBody)) signals.stackRn = 5;
    if (STACK_OTHER.test(scoringBody)) signals.stackOther = 5;
    if (TITLE_LEAD.test(title)) signals.leadTitle = 15;
    if (TITLE_SENIOR.test(title)) signals.seniorTitle = 10;
    if (TITLE_FRONTEND_KW.test(title)) signals.frontendTitle = 10;
    if (BODY_FRONTEND_KW.test(scoringBody)) signals.frontendBody = 10;

    const locText = `${job.location ?? ''} ${scoringBody}`;
    if (LOC_REMOTE.test(locText)) signals.locationRemote = 10;

    if (withinDays(job.postedAt, 7)) signals.freshness7d = 10;
    else if (withinDays(job.postedAt, 14)) signals.freshness14d = 5;

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
    signals.capped = positiveSum > 100;

    let score = Math.min(positiveSum, 100);

    if (US_CENTRIC_SOFT.test(body) && !REMOTE_WORLD.test(body)) {
      signals.usCentricPenalty = -10;
      score -= 10;
    }

    if (score < 30) {
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
