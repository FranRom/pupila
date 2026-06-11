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

import {
  CATEGORY_SCOPES,
  type CategoryDef,
  type LocationProfile,
  type RoleInterest,
  WORK_TYPES,
} from '../types.js';
import { type LlmProvider, runLlm } from './llm.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface PersonalizationDelta {
  weights: Partial<{
    stackPrimary: number;
    stackRn: number;
    stackOther: number;
    roleTitle: number;
    roleBody: number;
  }>;
  keywords: Partial<{
    stackPrimary: string[];
    stackRn: string[];
    stackOther: string[];
    titleExcludedSpecialties: string[];
  }>;
  // Target job titles the candidate wants (e.g. Senior Frontend Engineer,
  // Product Engineer). Omitted when the brief names no clear roles.
  roles?: RoleInterest[];
  // Job categories tailored to this candidate (the config-driven replacement for
  // the old fixed web3/ai groups). Each carries keywords + an optional weight.
  // Omitted when the brief names no clear domain focus.
  categories?: CategoryDef[];
  // Candidate location preferences derived from the brief. Omitted when the
  // brief gives no usable location signal.
  location?: LocationProfile;
}

// NOTE: These are duplicated in ui/src/constants/profileKeys.ts because the
// UI runs in the browser and can't import this module (depends on Node
// child_process via runLlm). Keep both lists in sync.
const PERSONAL_WEIGHT_KEYS: ReadonlyArray<keyof PersonalizationDelta['weights']> = [
  'stackPrimary',
  'stackRn',
  'stackOther',
  'roleTitle',
  'roleBody',
];

const PERSONAL_KEYWORD_KEYS: ReadonlyArray<keyof PersonalizationDelta['keywords']> = [
  'stackPrimary',
  'stackRn',
  'stackOther',
  'titleExcludedSpecialties',
];

// Bound the role list the LLM can emit (defense-in-depth, same spirit as the
// keyword caps below).
const MAX_ROLES = 8;

// ── Prompt + parsing ────────────────────────────────────────────────────────

export function buildProfilePrompt(brief: string): string {
  return `You are configuring a job-matching tool for a candidate. Given the candidate brief
below, output a JSON object that tells the matching engine which keywords to score
and which to exclude.

Output ONLY valid JSON — no markdown fences, no preamble, no commentary.

SCHEMA (every field is OPTIONAL — only include what applies to this candidate):

{
  "weights": {
    // Set 10–20 for stack groups the candidate works in. Omit (or 0) otherwise.
    "stackPrimary":   10,    // primary framework/language match in body
    "stackRn":        10,    // mobile-specific match
    "stackOther":     5,     // adjacent/supporting tech
    "roleTitle":      10,    // when the title matches one of the target roles below
    "roleBody":       10     // when the body uses phrases specific to a target role
  },
  "keywords": {
    // Each value is an array of case-insensitive regex fragments.
    // Use \\\\b for word boundaries when needed. Keep entries short, lowercase.
    "stackPrimary":             ["react", "next\\\\.?js", "typescript"],
    "stackRn":                  ["react.?native", "expo"],
    "stackOther":               ["graphql", "tailwind", "vite"],
    "titleExcludedSpecialties": [
      "backend engineers?", "data engineers?", "devops engineers?",
      "site reliability", "platform engineers?", "infrastructure engineers?",
      "qa engineers?", "embedded", "firmware", "ml engineers?", "machine learning"
    ]
  },
  "categories": [
    // The candidate's DOMAIN buckets — one per distinct field they care about.
    // Jobs get tagged with EVERY category whose keywords match, which groups
    // them in the dashboard. Read these from the brief; do NOT default to web3/ai
    // unless the candidate actually mentions them. A fintech dev → payments /
    // compliance; a devtools dev → developer-tools / infra; etc.
    // keywords are PLAIN words/phrases (NOT regex): matched whole-word and
    // case-insensitively. Punctuation is literal (c++, c#, .net all work); a dot
    // between words is optional, so "node.js" also catches "nodejs". List both
    // forms for other variants (agent/agents).
    {
      "id": "web3",                     // short kebab-case slug, unique
      "label": "Web3",                  // human-readable, shown in the UI + JOBS.md
      "keywords": ["web3", "blockchain", "smart contract", "ethereum", "solidity", "viem", "wagmi"],
      "weight": 20                      // optional: points added to fitScore when matched (omit for a pure label)
    },
    {
      "id": "ai",
      "label": "AI",
      "keywords": ["ai", "llm", "agent", "agents", "rag", "openai", "anthropic", "langchain"],
      "weight": 20
    }
  ],
  "roles": [
    // One entry per DISTINCT job title the candidate is targeting. A title
    // matching any role's titleMatch earns the roleTitle bonus, is tagged on the
    // job, and is rescued from the title-based hard drops (incl. titleExcludedSpecialties).
    {
      "id": "frontend",                 // short kebab-case slug, unique
      "label": "Senior Frontend Engineer", // human-readable, shown in the UI
      "titleMatch": ["frontend", "front.end", "fullstack", "web engineer"],
      "bodyMatch": ["design system", "component library", "ssr", "accessibility"]
    },
    {
      "id": "product",
      "label": "Product Engineer",
      "titleMatch": ["product engineer"]
    }
  ],
  "location": {
    // Where the candidate lives + the geography they'll work in. Persona-neutral:
    // do NOT privilege any country — read it from the brief.
    "basedIn": "Spain",                              // the country (or city) the candidate lives in
    "workTypes": ["remote", "hybrid"],               // subset of "remote" | "hybrid" | "onsite" they accept
    "acceptedRegions": ["europe", "emea", "spain"],  // lowercase region/market terms they can work in
    "excludeOutsideAcceptedRegions": true            // true if they ONLY want jobs in those regions
  }
}

RULES
1. Read the brief's "what they're looking for" and "what to avoid" paragraphs carefully.
2. titleExcludedSpecialties is the killer feature — list every specialty the candidate
   wants to AVOID. Each entry hard-drops matching titles (e.g. "Java Backend Engineer").
3. roles: create ONE entry per distinct target title named in the brief (the candidate may
   want several, e.g. "Senior Frontend Engineer" AND "Product Engineer"). Each needs a unique
   "id", a human "label", and a "titleMatch" regex list; "bodyMatch" is optional. Do NOT add a
   titleExcludedSpecialties entry that would contradict a target role.
4. categories: create ONE entry per distinct DOMAIN the candidate cares about (e.g. web3, ai,
   fintech, devtools, gaming, healthtech). Each needs a unique "id", a human "label", and a
   "keywords" list of PLAIN words/phrases (NOT regex — matched whole-word, case-insensitive; list
   both singular and plural if needed). "weight" is optional (10-20 if matching should also raise
   the score, omit for a pure label). Derive them from the brief — do NOT default to web3/ai unless
   the candidate mentions those fields. OMIT the whole "categories" array if the brief names no
   clear domain focus (don't invent buckets).
5. Use lowercase, regex-safe strings. No unanchored single letters.
6. Be specific to the brief — do not invent stacks or roles the candidate didn't mention.
7. location: read paragraph 1 (primary location) + paragraph 2 (location preference). Set "basedIn"
   to where they live. "workTypes" lists the arrangements they accept (omit "onsite" if they want
   remote/hybrid only). "acceptedRegions" lists the markets they can work in (e.g. a Europe-based
   remote candidate → ["europe","emea"]; add their country). Set "excludeOutsideAcceptedRegions": true
   only when the brief says they want jobs ONLY in those regions; otherwise false. If the brief is
   silent on geography, OMIT the whole "location" object.

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

// Category keywords are LITERAL terms (the filter escapes them before matching),
// so unlike the regex keyword groups they need no regex validation — just trim,
// lowercase, dedupe, and cap length/count. Keeps `node.js`, `c++` etc. intact
// instead of dropping them as "invalid regex".
function sanitizeLiteralKeywords(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = v.trim().toLowerCase();
    if (!t || t.length > MAX_KEYWORD_LENGTH) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_KEYWORDS_PER_GROUP) break;
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Validate + sanitize an arbitrary `roles` value (LLM output or a UI edit) into
// safe RoleInterest[]. Drops malformed roles, caps the count. Shared by the
// LLM-parse path and the UI's PUT /api/profile-roles endpoint.
export function sanitizeRoles(value: unknown): RoleInterest[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeRole)
    .filter((r): r is RoleInterest => r !== null)
    .slice(0, MAX_ROLES);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Bounds for category validation (defense-in-depth, same spirit as MAX_ROLES /
// the keyword caps). A category whose keywords all fail sanitization is dropped.
const MAX_CATEGORIES = 12;
const MAX_CATEGORY_WEIGHT = 50;
const MAX_CATEGORY_LIMIT = 200;

// Validate + sanitize an arbitrary `categories` value (LLM output or a UI edit)
// into safe CategoryDef[]. Drops malformed entries, dedupes by id, caps the
// count. Shared by the LLM-parse path and the UI's PUT /api/profile-categories.
export function sanitizeCategories(value: unknown): CategoryDef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CategoryDef[] = [];
  for (const item of value) {
    const c = sanitizeCategory(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

// Validate one category. Returns null when it lacks a usable id/label or has no
// safe keyword fragment (so a malformed entry can't crash compileKw at runtime).
// `scope`/`weight`/`limit` are optional — omitted when absent or out of range so
// the consumer's defaults ('title-body' / 0 / 20) apply.
function sanitizeCategory(value: unknown): CategoryDef | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (!isNonEmptyString(c.id) || !isNonEmptyString(c.label)) return null;
  if (!isStringArray(c.keywords)) return null;
  const keywords = sanitizeLiteralKeywords(c.keywords);
  if (keywords.length === 0) return null;
  const out: CategoryDef = { id: c.id.trim(), label: c.label.trim(), keywords };
  if (CATEGORY_SCOPES.includes(c.scope as (typeof CATEGORY_SCOPES)[number])) {
    out.scope = c.scope as CategoryDef['scope'];
  }
  if (isFiniteNumber(c.weight) && c.weight > 0) {
    out.weight = Math.min(Math.round(c.weight), MAX_CATEGORY_WEIGHT);
  }
  if (isFiniteNumber(c.limit) && c.limit > 0) {
    out.limit = Math.min(Math.round(c.limit), MAX_CATEGORY_LIMIT);
  }
  return out;
}

const MAX_BASED_IN_LENGTH = 80;
const MAX_ACCEPTED_REGIONS = 30;
const MAX_REGION_LENGTH = 60;

// Validate + coerce an arbitrary `location` value (LLM output or a UI edit) into
// a safe LocationProfile with neutral defaults. Always returns a usable object
// (never throws) — shared by the LLM-parse path and PUT /api/profile-location.
export function sanitizeLocation(value: unknown): LocationProfile {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const basedIn =
    typeof v.basedIn === 'string' ? v.basedIn.trim().slice(0, MAX_BASED_IN_LENGTH) : '';
  const workTypes = Array.isArray(v.workTypes)
    ? WORK_TYPES.filter((t) => (v.workTypes as unknown[]).includes(t))
    : [];
  const acceptedRegions = isStringArray(v.acceptedRegions)
    ? Array.from(
        new Set(
          v.acceptedRegions
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0 && s.length <= MAX_REGION_LENGTH),
        ),
      ).slice(0, MAX_ACCEPTED_REGIONS)
    : [];
  return {
    basedIn,
    workTypes,
    acceptedRegions,
    excludeOutsideAcceptedRegions: v.excludeOutsideAcceptedRegions === true,
  };
}

// True when a sanitized location carries any signal worth persisting (vs the
// empty neutral default the LLM should have omitted).
function locationHasSignal(loc: LocationProfile): boolean {
  return loc.basedIn.length > 0 || loc.workTypes.length > 0 || loc.acceptedRegions.length > 0;
}

// Validate + sanitize one LLM-proposed role. Returns null when it lacks a
// usable id/label or has no safe titleMatch fragment (mirrors the keyword
// sanitization so a malformed role can't crash compileKw at runtime).
function sanitizeRole(value: unknown): RoleInterest | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isNonEmptyString(r.id) || !isNonEmptyString(r.label)) return null;
  if (!isStringArray(r.titleMatch)) return null;
  const titleMatch = sanitizeKeywords(r.titleMatch);
  if (titleMatch.length === 0) return null;
  const role: RoleInterest = { id: r.id.trim(), label: r.label.trim(), titleMatch };
  if (isStringArray(r.bodyMatch)) {
    const bodyMatch = sanitizeKeywords(r.bodyMatch);
    if (bodyMatch.length > 0) role.bodyMatch = bodyMatch;
  }
  return role;
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

  const roles = sanitizeRoles(root.roles);
  if (roles.length > 0) delta.roles = roles;

  const categories = sanitizeCategories(root.categories);
  if (categories.length > 0) delta.categories = categories;

  if (root.location !== undefined) {
    const location = sanitizeLocation(root.location);
    if (locationHasSignal(location)) delta.location = location;
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
  roles?: RoleInterest[];
  categories?: CategoryDef[];
  location?: LocationProfile;
  [key: string]: unknown;
}

export interface MergeResult {
  profile: ProfileShape;
  weightsChanged: string[];
  keywordsChanged: string[];
  rolesChanged: boolean;
  categoriesChanged: boolean;
  locationChanged: boolean;
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

  // Roles are replaced wholesale (not merged) when the delta carries any — the
  // LLM re-derives the full target-role set from the brief each regeneration.
  let rolesChanged = false;
  if (delta.roles && delta.roles.length > 0) {
    const before = JSON.stringify(next.roles ?? []);
    const after = JSON.stringify(delta.roles);
    if (before !== after) rolesChanged = true;
    next.roles = delta.roles;
  }

  // Categories are replaced wholesale (not merged) when the delta carries any —
  // the LLM re-derives the candidate's full domain taxonomy from the brief.
  let categoriesChanged = false;
  if (delta.categories && delta.categories.length > 0) {
    const before = JSON.stringify(next.categories ?? []);
    const after = JSON.stringify(delta.categories);
    if (before !== after) categoriesChanged = true;
    next.categories = delta.categories;
  }

  // Location is replaced wholesale when the delta carries one — the LLM
  // re-derives the candidate's full location preference from the brief.
  let locationChanged = false;
  if (delta.location) {
    const before = JSON.stringify(next.location ?? {});
    const after = JSON.stringify(delta.location);
    if (before !== after) locationChanged = true;
    next.location = delta.location;
  }

  return {
    profile: next,
    weightsChanged,
    keywordsChanged,
    rolesChanged,
    categoriesChanged,
    locationChanged,
  };
}
