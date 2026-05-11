// LLM-driven personalization layer for config/profile.json.
//
// Given the candidate brief (config/candidate-brief.md), shells out to the
// local LLM CLI and returns a small "personalization delta" describing
// which keyword arrays + weights should be set for this candidate.
//
// We deliberately ask the LLM for a SMALL JSON object (not the full
// profile.json), so:
//   1. Hallucinated/missing fields can't break the live profile.
//   2. Universal sections (junior excludes, US-only filter, scoring config,
//      etc.) stay frozen — the LLM only ever fills personal stuff.
//   3. The merge step is pure, side-effect-free, and easy to test.

import { type LlmProvider, runLlm } from './llm.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface PersonalizationDelta {
  weights: Partial<{
    web3TitleBody: number;
    web3Stack: number;
    aiTitleBody: number;
    aiStack: number;
    stackPrimary: number;
    stackRn: number;
    stackOther: number;
    frontendTitle: number;
    frontendBody: number;
  }>;
  keywords: Partial<{
    w3TitleBody: string[];
    w3Stack: string[];
    aiTitleBody: string[];
    aiStack: string[];
    stackPrimary: string[];
    stackRn: string[];
    stackOther: string[];
    titleFrontend: string[];
    bodyFrontend: string[];
    titleExcludedSpecialties: string[];
  }>;
}

// NOTE: These are duplicated in ui/src/constants/profileKeys.ts because the
// UI runs in the browser and can't import this module (depends on Node
// child_process via runLlm). Keep both lists in sync.
const PERSONAL_WEIGHT_KEYS: ReadonlyArray<keyof PersonalizationDelta['weights']> = [
  'web3TitleBody',
  'web3Stack',
  'aiTitleBody',
  'aiStack',
  'stackPrimary',
  'stackRn',
  'stackOther',
  'frontendTitle',
  'frontendBody',
];

const PERSONAL_KEYWORD_KEYS: ReadonlyArray<keyof PersonalizationDelta['keywords']> = [
  'w3TitleBody',
  'w3Stack',
  'aiTitleBody',
  'aiStack',
  'stackPrimary',
  'stackRn',
  'stackOther',
  'titleFrontend',
  'bodyFrontend',
  'titleExcludedSpecialties',
];

// ── Prompt + parsing ────────────────────────────────────────────────────────

export function buildProfilePrompt(brief: string): string {
  return `You are configuring a job-matching tool for a candidate. Given the candidate brief
below, output a JSON object that tells the matching engine which keywords to score
and which to exclude.

Output ONLY valid JSON — no markdown fences, no preamble, no commentary.

SCHEMA (every field is OPTIONAL — only include what applies to this candidate):

{
  "weights": {
    // Set 10–20 for stack/domain groups the candidate works in. Omit (or 0) otherwise.
    "stackPrimary":   10,    // primary framework/language match in body
    "stackRn":        10,    // mobile-specific match
    "stackOther":     5,     // adjacent/supporting tech
    "frontendTitle":  10,    // when title is frontend/fullstack/web/mobile
    "frontendBody":   10,    // when body uses frontend-specific phrases
    "web3TitleBody":  20,    // candidate cares about crypto/blockchain
    "web3Stack":      20,
    "aiTitleBody":    20,    // candidate cares about AI/LLM/agents
    "aiStack":        20
  },
  "keywords": {
    // Each value is an array of case-insensitive regex fragments.
    // Use \\\\b for word boundaries when needed. Keep entries short, lowercase.
    "stackPrimary":             ["react", "next\\\\.?js", "typescript"],
    "stackRn":                  ["react.?native", "expo"],
    "stackOther":               ["graphql", "tailwind", "vite"],
    "titleFrontend":            ["frontend", "fullstack", "web", "mobile"],
    "bodyFrontend":             ["design system", "spa", "ssr", "accessibility"],
    "w3TitleBody":              ["web3", "blockchain", "smart contract", "ethereum"],
    "w3Stack":                  ["solidity", "ethers", "viem", "wagmi"],
    "aiTitleBody":              ["ai", "llm", "agent", "rag"],
    "aiStack":                  ["openai", "anthropic", "langchain", "mcp"],
    "titleExcludedSpecialties": [
      "backend engineers?", "data engineers?", "devops engineers?",
      "site reliability", "platform engineers?", "infrastructure engineers?",
      "qa engineers?", "embedded", "firmware", "ml engineers?", "machine learning"
    ]
  }
}

RULES
1. Read the brief's "what they're looking for" and "what to avoid" paragraphs carefully.
2. titleExcludedSpecialties is the killer feature — list every specialty the candidate
   wants to AVOID. Each entry hard-drops matching titles (e.g. "Java Backend Engineer").
3. If the candidate isn't interested in a domain (e.g. no web3 mention), OMIT that
   weight and keyword group entirely (don't write empty arrays).
4. Use lowercase, regex-safe strings. No unanchored single letters.
5. Be specific to the brief — do not invent stacks the candidate didn't mention.

CANDIDATE BRIEF
${brief.trim()}`;
}

export function stripFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:[a-z]+)?\n?/i, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length > 0);
}

// Drop regex fragments that would crash `new RegExp()` in compileKw, plus
// cap entries-per-group + entry length to keep the compiled expression
// from blowing up. Catastrophic backtracking is still possible with valid
// regex syntax, but bounded length + count makes it much harder.
const MAX_KEYWORDS_PER_GROUP = 30;
const MAX_KEYWORD_LENGTH = 80;

// MED-6: heuristic guard against catastrophic-backtracking patterns.
// Pairs with MAX_KEYWORDS_PER_GROUP + MAX_KEYWORD_LENGTH for layered defense.
// Heuristic, not a proof — covers the common shapes the LLM produces when
// it goes off-script.
const NESTED_QUANTIFIER = /(\([^)]*[+*][^)]*\))[+*]/;
const REPEATED_GROUP = /(\([^)]*\))\1/;
const MAX_QUANTIFIERS = 5;
function isComplexityRisky(pattern: string): boolean {
  if (NESTED_QUANTIFIER.test(pattern)) return true;
  if (REPEATED_GROUP.test(pattern)) return true;
  const quantifierCount = (pattern.match(/[+*?{]/g) ?? []).length;
  if (quantifierCount > MAX_QUANTIFIERS) return true;
  return false;
}

function sanitizeKeywords(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.length > MAX_KEYWORD_LENGTH) continue;
    if (isComplexityRisky(v)) continue;
    try {
      // Throws SyntaxError on invalid pattern (unbalanced groups, bad quantifier).
      new RegExp(v);
    } catch {
      continue;
    }
    out.push(v);
    if (out.length >= MAX_KEYWORDS_PER_GROUP) break;
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Parse the LLM response into a strictly-typed delta. Unknown keys are
// dropped, malformed values are skipped (never throws on bad sub-fields —
// returns whatever we could safely extract).
export function parsePersonalizationDelta(raw: string): PersonalizationDelta {
  const cleaned = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON output. Raw output was:\n${cleaned.slice(0, 500)}\n\nParse error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM output was JSON but not an object.');
  }

  const root = parsed as Record<string, unknown>;
  const delta: PersonalizationDelta = { weights: {}, keywords: {} };

  if (typeof root.weights === 'object' && root.weights !== null) {
    const w = root.weights as Record<string, unknown>;
    for (const key of PERSONAL_WEIGHT_KEYS) {
      const v = w[key];
      if (isFiniteNumber(v) && v > 0) {
        delta.weights[key] = Math.min(Math.round(v), 50);
      }
    }
  }

  if (typeof root.keywords === 'object' && root.keywords !== null) {
    const k = root.keywords as Record<string, unknown>;
    for (const key of PERSONAL_KEYWORD_KEYS) {
      const v = k[key];
      if (isStringArray(v)) {
        const safe = sanitizeKeywords(v);
        if (safe.length > 0) delta.keywords[key] = safe;
      }
    }
  }

  return delta;
}

// ── Main entrypoint ─────────────────────────────────────────────────────────

export async function generateProfileFromBrief(
  briefMarkdown: string,
  provider?: LlmProvider,
  onChunk?: (chunk: string) => void,
): Promise<PersonalizationDelta> {
  if (!briefMarkdown.trim()) {
    throw new Error('Cannot generate profile: candidate brief is empty.');
  }
  const prompt = buildProfilePrompt(briefMarkdown);
  const raw = await runLlm(prompt, provider, onChunk);
  return parsePersonalizationDelta(raw);
}

// ── Merge logic ─────────────────────────────────────────────────────────────

// The shape we read/write to disk. Loose Record<> typing because profile.json
// has many universal fields we don't need to model here — we only care about
// merging the personal slices.
export interface ProfileShape {
  weights: Record<string, number>;
  keywords: Record<string, string[] | undefined>;
  [key: string]: unknown;
}

export interface MergeResult {
  profile: ProfileShape;
  weightsChanged: string[];
  keywordsChanged: string[];
}

export function mergeProfile(base: ProfileShape, delta: PersonalizationDelta): MergeResult {
  // Defensive against hand-edited profile.json that nulled out a section.
  if (!base.weights || typeof base.weights !== 'object') {
    throw new Error('config/profile.json is missing the .weights object');
  }
  if (!base.keywords || typeof base.keywords !== 'object') {
    throw new Error('config/profile.json is missing the .keywords object');
  }
  const next: ProfileShape = {
    ...base,
    weights: { ...base.weights },
    keywords: { ...base.keywords },
  };

  const weightsChanged: string[] = [];
  for (const [key, value] of Object.entries(delta.weights)) {
    if (typeof value !== 'number') continue;
    if (next.weights[key] !== value) weightsChanged.push(key);
    next.weights[key] = value;
  }

  const keywordsChanged: string[] = [];
  for (const [key, value] of Object.entries(delta.keywords)) {
    if (!Array.isArray(value)) continue;
    const before = next.keywords[key] ?? [];
    if (before.join('|') !== value.join('|')) keywordsChanged.push(key);
    next.keywords[key] = value;
  }

  return { profile: next, weightsChanged, keywordsChanged };
}
