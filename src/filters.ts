import type { Category, Job } from './types.js';
import { withinDays } from './utils.js';

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
    const titleAndBody = `${title}\n${body}`;

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
    if (NON_ENGINEERING.test(titleAndBody) && !TITLE_ENGINEERING_KW.test(title)) {
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

    let score = 0;
    let web3 = false;
    let ai = false;

    if (W3_TITLE_BODY.test(titleAndBody)) {
      score += 20;
      web3 = true;
    }
    if (W3_STACK.test(body)) {
      score += 20;
      web3 = true;
    }
    if (AI_TITLE_BODY.test(titleAndBody)) {
      score += 20;
      ai = true;
    }
    if (AI_STACK.test(body)) {
      score += 20;
      ai = true;
    }

    if (STACK_PRIMARY.test(body)) score += 10;
    if (STACK_RN.test(body)) score += 5;
    if (STACK_OTHER.test(body)) score += 5;

    if (TITLE_LEAD.test(title)) score += 15;
    if (TITLE_SENIOR.test(title)) score += 10;

    const locText = `${job.location ?? ''} ${body}`;
    if (LOC_REMOTE.test(locText)) score += 10;

    if (withinDays(job.postedAt, 7)) score += 10;
    else if (withinDays(job.postedAt, 14)) score += 5;

    score = Math.min(score, 100);

    if (US_CENTRIC_SOFT.test(body) && !REMOTE_WORLD.test(body)) score -= 10;

    if (score < 30) {
      droppedScore++;
      continue;
    }

    let category: Category = 'general';
    if (web3 && ai) category = 'web3+ai';
    else if (web3) category = 'web3';
    else if (ai) category = 'ai';

    kept.push({ ...job, fitScore: score, category });
  }

  return { kept, droppedHard, droppedScore };
}
