import { readFile } from 'node:fs/promises';
import { reconcileLocationLock } from './lib/profile-reconcile.js';
import type {
  CategoryDef,
  Job,
  JobSignals,
  LocationProfile,
  RoleInterest,
  Source,
} from './types.js';
import { isSafeUrl, withinDays } from './utils.js';

/** Escape a plain location term so it's safe to drop into a regex alternation. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile a LITERAL category keyword to a regex fragment: escape it, but let a
// dot that sits BETWEEN two alphanumerics become optional, so "node.js" also
// matches "nodejs" (a common spelling variant of the same tech). Punctuation
// that's meaningful on its own — "c++", "c#", ".net" — stays exact because its
// dot (if any) isn't between two alphanumerics.
function literalKeywordToRegex(kw: string): string {
  return escapeRegExp(kw).replace(/(?<=[a-z0-9])\\\.(?=[a-z0-9])/gi, '\\.?');
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
  // Hard-drop a posting whose `postedAt` is older than this many days.
  // Optional and unset by default (inert — a fresh fork keeps every age).
  // Missing/unparsable `postedAt` is NOT treated as stale (benefit of the
  // doubt — several sources don't always carry a date).
  maxAgeDays?: number;
}

// Point values for the fixed, universal scoring signals (stack, seniority,
// role, location, freshness). Category scoring is NOT here — each category
// carries its own optional `weight` in `FilterProfile.categories` (see
// `CategoryDef`), so adding/renaming a category never touches this interface.
export interface FilterWeights {
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
  // User-defined job categories (the config-driven replacement for the old
  // hardcoded web3/ai/general taxonomy). A job is tagged with every category
  // whose keywords match (`Job.categories`); a category's optional `weight`
  // also adds to the score. Optional so older/minimal profiles still load
  // (no categories → every job is uncategorized → renders under "Other").
  categories?: readonly CategoryDef[];
  // Candidate location preferences. When present, drives the persona-neutral
  // geo filter + location scoring. Optional so older/minimal profiles still
  // load (the geo hard-drop is inert without it).
  location?: LocationProfile;
}

/** Loads and parses config/profile.json. Throws ENOENT if missing — callers should gate. */
export async function loadProfile(path = 'config/profile.json'): Promise<FilterProfile> {
  const raw = await readFile(path, 'utf8');
  const profile = JSON.parse(raw) as FilterProfile;
  // Sibling profile.default.json, when present, supplies the shipped lock fragments.
  const shipped = await readShippedLocationLock(path.replace(/[^/\\]*$/, 'profile.default.json'));
  const personal = profile.keywords?.locationLock;
  if (shipped && Array.isArray(personal)) {
    profile.keywords = {
      ...profile.keywords,
      locationLock: reconcileLocationLock(personal as string[], shipped),
    };
  }
  return profile;
}

async function readShippedLocationLock(defaultPath: string): Promise<string[] | null> {
  try {
    const defaults = JSON.parse(await readFile(defaultPath, 'utf8')) as FilterProfile;
    const list = defaults.keywords?.locationLock;
    return Array.isArray(list) ? (list as string[]) : null;
  } catch {
    return null;
  }
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
  /\b(remote|worldwide|world ?wide|global|globally|anywhere|hybrid|on[- ]?site|onsite|distributed|flexible|work from home|wfh|n\/?a|tbd|blank|various|multiple|locations?)\b/gi;

// Recognized COUNTRY names/codes only — deliberately does not include cities,
// states, or continents. Used to tell "the location field enumerates the
// specific countries this posting can legally be filled in" (a real,
// structural hiring-eligibility constraint, common with EOR/payroll-based
// remote hiring) apart from "the location field just lists the cities where
// the team happens to have people" (not a constraint — see
// `isClosedCountryList` below). Not exhaustive; extend the enumeration as new
// cases surface, same philosophy as `locationLock`'s bare-region-code list —
// an incomplete list only means this specific rule stays inert for an
// unrecognized country name, which is the safe direction to fail in (a miss
// here still falls through to the existing single-name-is-not-a-restriction
// behavior, not a wrongful drop).
const COUNTRY_NAMES = [
  'united states',
  'usa',
  'us',
  'canada',
  'mexico',
  'brazil',
  'argentina',
  'chile',
  'colombia',
  'peru',
  'uruguay',
  'paraguay',
  'bolivia',
  'venezuela',
  'ecuador',
  'costa rica',
  'panama',
  'guatemala',
  'honduras',
  'el salvador',
  'dominican republic',
  'puerto rico',
  'jamaica',
  'united kingdom',
  'uk',
  'ireland',
  'germany',
  'france',
  'spain',
  'italy',
  'portugal',
  'netherlands',
  'belgium',
  'switzerland',
  'austria',
  'poland',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'iceland',
  'czech republic',
  'czechia',
  'slovakia',
  'hungary',
  'romania',
  'bulgaria',
  'greece',
  'croatia',
  'serbia',
  'slovenia',
  'estonia',
  'latvia',
  'lithuania',
  'luxembourg',
  'malta',
  'cyprus',
  'ukraine',
  'russia',
  'turkey',
  'india',
  'pakistan',
  'bangladesh',
  'sri lanka',
  'nepal',
  'china',
  'japan',
  'south korea',
  'philippines',
  'vietnam',
  'indonesia',
  'thailand',
  'singapore',
  'malaysia',
  'australia',
  'new zealand',
  'south africa',
  'nigeria',
  'kenya',
  'egypt',
  'morocco',
  'israel',
  'united arab emirates',
  'uae',
  'saudi arabia',
];

// Exact (whole-string) match only — used against an already letters-only,
// single-spaced residual (see `isClosedCountryList`), never against raw text.
const COUNTRY_NAME_ONLY_RE = new RegExp(`^(${COUNTRY_NAMES.join('|')})$`, 'i');

// Which broader region labels a country belongs to. A candidate who accepts
// "europe"/"emea"/"apac" accepts the countries inside it, so a location like
// "Spain, Portugal" must count as accepted for them. "us" is deliberately not
// listed: it is also an ordinary English word.
const REGION_GROUPS: ReadonlyArray<readonly [aliases: string, countries: readonly string[]]> = [
  [
    'europe european eu emea',
    [
      'germany',
      'france',
      'spain',
      'italy',
      'portugal',
      'netherlands',
      'belgium',
      'austria',
      'poland',
      'sweden',
      'denmark',
      'finland',
      'czech republic',
      'czechia',
      'slovakia',
      'hungary',
      'romania',
      'bulgaria',
      'greece',
      'croatia',
      'slovenia',
      'estonia',
      'latvia',
      'lithuania',
      'luxembourg',
      'malta',
      'cyprus',
      'ireland',
    ],
  ],
  [
    'europe european emea',
    ['united kingdom', 'uk', 'norway', 'switzerland', 'iceland', 'serbia', 'ukraine', 'russia'],
  ],
  ['emea mena middle east', ['israel', 'uae', 'united arab emirates', 'saudi arabia', 'turkey']],
  ['emea africa', ['south africa', 'nigeria', 'kenya', 'egypt', 'morocco']],
  [
    'apac asia asia-pacific',
    [
      'india',
      'pakistan',
      'bangladesh',
      'sri lanka',
      'nepal',
      'china',
      'japan',
      'south korea',
      'philippines',
      'vietnam',
      'indonesia',
      'thailand',
      'singapore',
      'malaysia',
    ],
  ],
  ['apac oceania anz', ['australia', 'new zealand']],
  ['north america americas', ['united states', 'usa', 'canada']],
  [
    'latam latin america americas',
    [
      'mexico',
      'brazil',
      'argentina',
      'chile',
      'colombia',
      'peru',
      'uruguay',
      'paraguay',
      'bolivia',
      'venezuela',
      'ecuador',
      'costa rica',
      'panama',
      'guatemala',
      'honduras',
      'el salvador',
      'dominican republic',
      'puerto rico',
      'jamaica',
    ],
  ],
];
const REGION_OF_COUNTRY = new Map<string, string>(
  REGION_GROUPS.flatMap(([aliases, countries]) => countries.map((c) => [c, aliases] as const)),
);
const COUNTRY_FIND_RE = new RegExp(
  `\\b(${[...REGION_OF_COUNTRY.keys()].sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi',
);

/** Region labels implied by the countries named in a SHORT text (location, title, one clause). */
function regionAliasesFor(text: string): string {
  if (text.length > 200) return '';
  const found = text.match(COUNTRY_FIND_RE);
  if (!found) return '';
  return [...new Set(found.map((c) => REGION_OF_COUNTRY.get(c.toLowerCase()) ?? ''))].join(' ');
}

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

// Compile a category's LITERAL keyword list to a matcher. Unlike `compileKw`
// (which wraps in `\b...\b`), this anchors with alphanumeric lookarounds:
// `(?<![a-z0-9])(...)(?![a-z0-9])`. That behaves like `\b` for plain words ("ai"
// still won't match "email") but ALSO works for keywords whose edges are
// punctuation — `\b` fails right after a "+" or "#", so "c++"/"c#"/".net" would
// never match under `\b`. Each keyword is escaped + dot-relaxed first.
function compileCategoryKeywords(keywords: readonly string[]): RegExp {
  if (keywords.length === 0) return NEVER_MATCH;
  const body = keywords.map(literalKeywordToRegex).join('|');
  try {
    return new RegExp(`(?<![a-z0-9])(${body})(?![a-z0-9])`, 'i');
  } catch (err) {
    console.warn(
      `[filters] compileCategoryKeywords failed; falling back to NEVER_MATCH. Keywords: ${JSON.stringify(keywords).slice(0, 200)}. Error: ${err instanceof Error ? err.message : String(err)}`,
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
// Positive evidence a posting is hybrid / on-site, as opposed to merely not
// confirmed remote: the ATS workplace type (carried in `tags` by the Ashby,
// Lever and Aave normalizers) or hybrid / on-site wording in the location.
const EXPLICIT_NON_REMOTE_TAG = /^(hybrid|on-?site|in[- ]?office|office)$/i;
const EXPLICIT_NON_REMOTE_LOCATION = /\b(hybrid|on-?site|in[- ]office)\b/i;

function hasExplicitNonRemote(job: Job): boolean {
  return (
    job.tags.some((t) => EXPLICIT_NON_REMOTE_TAG.test(t.trim())) ||
    EXPLICIT_NON_REMOTE_LOCATION.test(job.location ?? '')
  );
}

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
  // User-defined categories, compiled once. Each becomes a label + an optional
  // score boost. `scope` picks the haystack ('title-body' default, or body-only
  // for stack-style noise control); `weight` defaults to 0 (pure label). Inert
  // when `categories` is empty/absent (no job gets tagged). Keywords are LITERAL
  // terms (not regex); `compileCategoryKeywords` escapes them, relaxes a dot
  // between words to optional (`node.js` also matches `nodejs`), and anchors with
  // alphanumeric lookarounds so punctuation-edged terms like `c++`/`.net` work.
  const CATEGORIES = (profile.categories ?? []).map((c) => ({
    id: c.id,
    re: compileCategoryKeywords(c.keywords),
    scope: c.scope ?? 'title-body',
    weight: c.weight ?? 0,
  }));
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
  const acceptsHybrid = loc?.workTypes?.includes('hybrid') ?? false;
  const acceptsRemote = loc?.workTypes?.includes('remote') ?? true;
  const acceptsAnyWorkType = (loc?.workTypes?.length ?? 0) > 0;
  // No region preference expressed → region drops/penalties stay inert (a fresh
  // fork accepts everywhere until the candidate sets regions). The work-type
  // gate still applies independently.
  const hasRegionPrefs = (loc?.acceptedRegions?.length ?? 0) > 0 || !!loc?.basedIn?.trim();
  // Fallback remote group for profiles with no `location` block (back-compat).
  const LOC_REMOTE = compileKw(K.locationRemote);

  // Sources whose `remote` flag is read directly off a structured ATS field
  // (Lever's workplaceType, Ashby's isRemote/workplaceType, Recruitee's remote
  // boolean, Aave's workplaceType) rather than inferred from free text. For
  // these, `remote: false` is a CONFIRMED non-remote posting, not just
  // "couldn't tell" — worth gating on directly, since the generic
  // text-pattern ONSITE_ONLY check below misses postings whose body simply
  // never phrases the requirement as "onsite only" (a Binance Lever listing
  // with workplaceType != 'remote' rarely says that in prose). Heuristic
  // sources (greenhouse, personio, bluedoor, every scraper/aggregator) are
  // deliberately excluded — their `false` can genuinely mean "unknown".
  const TRUSTED_REMOTE_SOURCES = new Set<Source>([
    'lever',
    'ashby',
    'ashby-private',
    'aave',
    'recruitee',
  ]);
  // Only enforced for a candidate who configured a location profile AND
  // accepts remote work exclusively (no onsite, no hybrid) — inert for a
  // fresh fork with no `location` block, and inert for anyone who accepts
  // onsite or hybrid arrangements.
  // An empty `workTypes` (the UI unticked everything, or the LLM omitted it)
  // expresses no preference, so it must not read as "remote only".
  const remoteOnly = !!loc && acceptsAnyWorkType && !acceptsOnsite && !acceptsHybrid;

  // A job's haystack names a region the candidate will work in: an accepted
  // region, their home country, or open-to-anywhere remote. Deliberately does
  // NOT treat a bare "remote" as accepted — a remote-friendly posting can still
  // carry an incompatible lock (e.g. "remote, EST hours required").
  // Body-scoped region matcher: accepted regions MINUS the catch-all tokens.
  // A *specific* region named in prose ("we also hire across APAC") is a real
  // eligibility signal; "worldwide"/"global"/"anywhere" in prose is marketing
  // and must not rescue a role whose stated location says otherwise.
  const CATCH_ALL_REGION = /worldwide|global|anywhere/i;
  const ACCEPTED_REGIONS_SPECIFIC = compileKw(
    loc?.acceptedRegions?.filter((r) => !CATCH_ALL_REGION.test(r)).map(escapeRegExp),
  );

  // Body-scoped eligibility phrasing. Unlike the bare tokens in
  // `worldwideRemote` (unambiguous in a location field, marketing in prose),
  // each of these only ever appears in a statement about WHO can be hired.
  const BODY_ELIGIBILITY =
    /\b(work from anywhere|anywhere in the world|from anywhere in the world|we hire (globally|worldwide|anywhere)|hire (globally|worldwide|anywhere)|hiring (globally|worldwide|anywhere)|remote worldwide|worldwide remote|fully remote worldwide|any time ?zone|all time ?zones?|open to candidates from all countries|globally distributed|location[- ]independent)\b/i;

  // A sentence naming the specific place THIS posting is restricted to —
  // distinct from BODY_ELIGIBILITY, which only ever states a permissive
  // (worldwide/anywhere) policy. This one names a restriction, and it takes
  // priority: it describes the role, not generic company perks copy.
  // Capture group uses \p{L} (any Unicode letter), not [a-z] — plain ASCII
  // silently failed to match city names with diacritics ("Florianópolis",
  // "São Paulo"), letting those specific postings slip past this rule
  // entirely while otherwise-identical ASCII-named-city postings from the
  // same company correctly dropped. Requires the `u` flag alongside `i`.
  const ROLE_SPECIFIC_LOCATION_STATEMENT =
    /\b(?:this (?:is a |role is a )?remote role (?:is )?for candidates (?:located|based) in|candidates (?:must|should|need to) be (?:located|based) in|this (?:role|position) is (?:only )?(?:open to|for) candidates (?:located|based) in)\s+([\p{L}][\p{L} ,'-]{1,60})(?=[.\n]|$)/iu;

  function regionAccepted(haystack: string): boolean {
    // A named country also counts via its broader regions: accepting "europe"
    // accepts "Spain, Portugal" (see REGION_GROUPS).
    const expanded = `${haystack} ${regionAliasesFor(haystack)}`;
    return (
      WORLDWIDE_REMOTE.test(expanded) || ACCEPTED_REGIONS.test(expanded) || BASED_IN.test(expanded)
    );
  }

  // True when the job's *stated location* names a specific place the candidate
  // doesn't accept. Generic-remote tokens are neutral vocabulary (not a region),
  // so "Remote" alone → residual empty → not out-of-region; "Remote, USA" →
  // residual "usa" → out-of-region unless USA is an accepted region.
  //
  // Callers MUST gate this on `!job.remote` (see call sites below). For a
  // posting that is actually remote, a bare named place in the location field
  // states where the team/hub happens to sit, not a requirement on the
  // candidate — someone who has worked async with EU/US teams for years is
  // eligible regardless of where the listing says the company is based. Only
  // an explicit restriction (a locationLock phrase, or a role-specific "this
  // role is for candidates located in X" sentence) is real requirement
  // language and should drop the posting. This function stays useful for a
  // non-remote/onsite posting, where the named place genuinely is where the
  // work happens.
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

  // True when the location field enumerates 2+ specific COUNTRIES (not
  // cities), none of them accepted, and nothing broader/catch-all appears
  // anywhere (that's already rescued earlier by `regionAccepted`). This is a
  // distinct, stronger signal than a single named place: a company listing
  // "Brazil (Remote), Canada (Remote)" as the entire location field is
  // typically enumerating the closed set of countries it's legally able to
  // employ a remote worker in (an Employer-of-Record/payroll constraint) —
  // functionally a hard restriction even without the word "only" anywhere.
  // A single named place stays governed by `locationFieldOutOfRegion` +
  // `job.remote` above (team-hub language, not a restriction). Deliberately
  // requires EVERY segment to resolve to a recognized country in
  // `COUNTRY_NAMES` — a list mixing a city ("New York, San Francisco") is far
  // more likely just naming office hubs within one country, not a hiring
  // boundary, and one unrecognized segment is enough to bail out (keep) rather
  // than risk a wrongful drop on a country list this function doesn't know.
  function isClosedCountryList(location: string | null): boolean {
    if (!location) return false;
    const segments = location.split(/[,/;]+/).map((s) => s.trim());
    if (segments.length < 2) return false;
    if (segments.some((segment) => regionAccepted(segment))) return false;
    // A generic segment ("Remote") reduces to nothing; it neither names a
    // country nor breaks the list, so judge the places that remain.
    const residuals = segments
      .map((segment) =>
        segment
          .toLowerCase()
          .replace(GENERIC_REMOTE_TOKENS, ' ')
          .replace(/[^a-z]+/g, ' ')
          .trim(),
      )
      .filter((residual) => residual.length > 0);
    return residuals.length >= 2 && residuals.every((r) => COUNTRY_NAME_ONLY_RE.test(r));
  }

  function preparedScoringBody(rawBody: string): string {
    const stripped = rawBody.replace(BOILERPLATE_HEADERS_RE, '').trim();
    return stripped.slice(0, S.scoringBodyMaxChars);
  }

  // ── Timezone-hours compatibility ─────────────────────────────────────────
  // A posting can be "remote" and region-open yet still require working hours
  // in a zone far from the candidate ("EST hours", "overlap with Pacific",
  // "UTC-8 to UTC-5"). Only evaluated when `location.utcOffset` is set.
  const TZ_MAX_DIFF = loc?.maxTimezoneDiffHours ?? 8;
  // Only a real number enables the timezone rules (`null`/absent = inert).
  const TZ_CANDIDATE_OFFSET =
    typeof loc?.utcOffset === 'number' && Number.isFinite(loc.utcOffset)
      ? loc.utcOffset
      : undefined;
  // Shortest distance around the clock: UTC+10 and UTC-8 are 6h apart, not 18.
  const tzGap = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 24;
    return Math.min(d, 24 - d);
  };
  // A tz mention only counts when it sits next to working-hours language —
  // "headquartered in Pacific Northwest" is not a schedule requirement.
  const TZ_CONTEXT =
    /\b(hours?|overlap|overlapping|time ?zones?|working|business|core|shift|availab\w*|schedule|sync|collaborat\w*|meetings?|stand-?ups?|align(ed)?|within)\b/i;
  const TZ_SOFT =
    /\b(try to|ideally|if possible|where possible|nice to have|preferably|preferred|prefer)\b/i;
  // Case-sensitive abbreviations (uppercase only: "ET"/"PT"/"CT" collide with words).
  const TZ_ABBR: ReadonlyArray<[RegExp, number]> = [
    [/\b(PST|PDT)\b/g, -8],
    [/\b(MST|MDT)\b/g, -7],
    [/\b(CDT)\b/g, -6],
    [/\b(EST|EDT)\b/g, -5],
    [/\b(CET|CEST)\b/g, 1],
    [/\b(BST|GMT)\b(?![+\-−]\s?\d)/g, 0],
    [/\b(JST|KST)\b/g, 9],
    [/\b(SGT|HKT)\b/g, 8],
    [/\b(ICT)\b/g, 7],
    [/\b(AEST|AEDT)\b/g, 10],
    [/\b(NZST|NZDT)\b/g, 12],
  ];
  // Two-letter forms (PT/MT/CT/ET) and CST collide with ordinary text: "a PT
  // contract", "Stamford, CT", "the ET team", "MT models", "China Standard Time".
  // They only count when glued to clock or schedule wording: a time before them
  // ("9-5 ET"), "overlap/aligned with PT", or directly followed by hours/time.
  const TZ_AMBIGUOUS = (abbr: string): RegExp =>
    new RegExp(
      `(?:\\d\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)?\\s?|(?:[Oo]verlap|[Aa]lign(?:ed)?|[Ss]ync(?:ed)?)\\s+(?:with|to)\\s+(?:the\\s+)?)(?:${abbr})\\b(?!\\s*\\(\\s*(?:[Cc]hina|[Cc]uba))|\\b(?:${abbr})\\s+(?:hours?|time|time\\s?zone|business|working|overlap)\\b`,
      'g',
    );
  const TZ_ABBR_AMBIGUOUS: ReadonlyArray<[RegExp, number]> = [
    [TZ_AMBIGUOUS('PT'), -8],
    [TZ_AMBIGUOUS('MT'), -7],
    [TZ_AMBIGUOUS('CT|CST'), -6],
    [TZ_AMBIGUOUS('ET'), -5],
  ];
  // Named zones / regions, case-insensitive.
  const TZ_NAMED: ReadonlyArray<[RegExp, number]> = [
    [/\bpacific(?: standard| daylight)?(?: time| hours|\s?time ?zone)/gi, -8],
    [/\bmountain(?: standard| daylight)?(?: time| hours|\s?time ?zone)/gi, -7],
    [/\bcentral(?: standard| daylight)? (?:time|hours|time ?zone)/gi, -6],
    [/\beastern(?: standard| daylight)?(?: time| hours|\s?time ?zone)/gi, -5],
    [
      /\b(?:usa|american|north american?|americas|canadian|latam|latin american?)\s+(?:business |working |core |normal |daytime |standard )?(?:hours|time ?zones?)/gi,
      -5,
    ],
    // "US"/"U.S." only in capitals: lowercase "us hours" is just English
    // ("saves us hours every week").
    [
      /\b(?:US|U\.S\.A?\.?)\s+(?:business |working |core |normal |daytime |standard )?(?:hours|time ?zones?)/g,
      -5,
    ],
    [
      /\b(?:european|europe|eu|emea|uk)\s+(?:business |working |core |normal |daytime )?(?:hours|time ?zones?)/gi,
      1,
    ],
    [
      /\b(?:apac|asia(?:n)?|asia-pacific)\s+(?:business |working |core |normal |daytime )?(?:hours|time ?zones?)/gi,
      8,
    ],
  ];
  const TZ_NUMERIC = /\b(?:UTC|GMT)\s?([+\-−])\s?(\d{1,2})(?::?(\d{2}))?\b/g;

  // Zones written out in full, plus bare region words — the latter count ONLY
  // inside a sentence that already talks about hours/time zones, so "Europe"
  // elsewhere in the body (office lists) adds nothing.
  const TZ_SPELLED: ReadonlyArray<[RegExp, number]> = [
    [/\bcentral european(?: summer)?(?: time| hours)?/gi, 1],
    [/\b(?:western european|greenwich|british)(?: summer| mean)?(?: time| hours)/gi, 0],
  ];
  const TZ_BARE_REGIONS: ReadonlyArray<[RegExp, number]> = [
    [/\b(?:europe|european|emea|eu)\b/gi, 1],
    [/\b(?:uk|united kingdom|britain)\b/gi, 0],
    [/\b(?:middle east|gulf|uae|dubai)\b/gi, 4],
    [/\bafrica\b/gi, 2],
    [/\bindia\b/gi, 5.5],
    [/\b(?:apac|asia(?:n)?|asia-pacific|singapore|philippines|manila|hong kong)\b/gi, 8],
    [/\b(?:australia|sydney|melbourne)\b/gi, 10],
    [/\bnew zealand\b/gi, 12],
  ];

  /** True when every working-hours zone the text names is > TZ_MAX_DIFF from the candidate. */
  function timezoneIncompatible(text: string): boolean {
    if (TZ_CANDIDATE_OFFSET === undefined) return false;
    const offsets: number[] = [];
    const collect = (
      sentence: string,
      re: RegExp,
      offsetFor: (m: RegExpExecArray) => number,
      needsContext: boolean,
      requireNear = false,
    ) => {
      re.lastIndex = 0;
      for (let m = re.exec(sentence); m !== null; m = re.exec(sentence)) {
        // Bare abbreviations ("PST" can be a team acronym) must sit right next
        // to working-hours language, not merely share a sentence with it.
        if (
          requireNear &&
          !TZ_CONTEXT.test(
            sentence.slice(
              Math.max(0, m.index - 40),
              Math.min(sentence.length, m.index + m[0].length + 40),
            ),
          )
        ) {
          continue;
        }
        // Named-region patterns already embed "hours"/"time zone" in the match.
        if (!needsContext || /hours|time ?zone/i.test(m[0])) offsets.push(offsetFor(m));
        if (m[0].length === 0) re.lastIndex++;
      }
    };
    // A zone counts only inside a sentence that talks about working hours /
    // overlap — and ALL zones in that sentence are read together, so
    // "LATAM (GMT-3) or the Philippines (GMT+8)" is not judged on GMT-3 alone.
    // HTML tags and run-on bodies are split into ~sentence-sized chunks.
    // URLs are stripped first ("…/coordination_hours" is a link, not a schedule).
    const cleaned = text.replace(/https?:\/\/\S+/g, ' ');
    // A capital-letter ending only splits after TWO capitals ("… PST. Rust …"),
    // so "U.S. business hours" is not cut at its abbreviation dot.
    for (const sentence of cleaned.split(/(?<=(?:[a-z0-9)\]]|[A-Z]{2})[.!?;])\s+|\n+|<[^>]*>/)) {
      if (sentence.length < 3) continue;
      // A stated preference ("try to overlap", "ideally", "preferred") is not a
      // requirement — leave those to the AI review rather than hard-dropping.
      if (TZ_SOFT.test(sentence)) continue;
      // Zones named in EARLIER sentences must not unlock the bare-region rescue
      // below, which is scoped to this sentence.
      const offsetsBefore = offsets.length;
      const hasContext = TZ_CONTEXT.test(sentence);
      // Without working-hours language only matches that embed "hours"/"time
      // zone" themselves ("Eastern hours") count — "9am-3pm Pacific Time" alone
      // is a clock reference, not a schedule requirement.
      for (const [re, off] of TZ_NAMED) collect(sentence, re, () => off, !hasContext);
      if (!hasContext) continue;
      for (const [re, off] of TZ_ABBR) collect(sentence, re, () => off, false, true);
      for (const [re, off] of TZ_ABBR_AMBIGUOUS) collect(sentence, re, () => off, false);
      for (const [re, off] of TZ_SPELLED) collect(sentence, re, () => off, false);
      collect(
        sentence,
        TZ_NUMERIC,
        (m) => {
          const sign = m[1] === '+' ? 1 : -1;
          return sign * (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0));
        },
        false,
      );
      // Bare regions only matter when a far zone was ALSO named here (they
      // can rescue it, never trigger a drop on their own).
      if (offsets.length > offsetsBefore) {
        for (const [re, off] of TZ_BARE_REGIONS) {
          re.lastIndex = 0;
          if (re.test(sentence)) offsets.push(off);
        }
      }
    }
    if (offsets.length === 0) return false;
    // Any stated zone within reach of the candidate (e.g. "CET or EST") keeps the job.
    return offsets.every((o) => tzGap(o, TZ_CANDIDATE_OFFSET) > TZ_MAX_DIFF);
  }

  // ── Remote posting tied to a far-away place ──────────────────────────────
  // A remote posting whose stated location names ONLY places in time zones far
  // from the candidate ("Remote, USA", "San Francisco", "Canada") is a hiring
  // region in practice, whatever the team-hub reasoning above says. Reversed
  // on purpose: instead of whitelisting every acceptable country (Poland,
  // UAE, ...), only a recognised FAR place can drop a job — unknown places
  // are kept. Persona-neutral: "far" is measured from `location.utcOffset`.
  const FAR_PLACES: ReadonlyArray<[RegExp, number]> = [
    [
      /\b(?:california|san francisco|bay area|silicon valley|seattle|portland|los angeles|san diego|san jose|palo alto|mountain view|sunnyvale|menlo park|redwood city|foster city|san mateo|santa clara|cupertino|oakland|irvine|santa monica|vancouver|oregon|washington state)\b/,
      -8,
    ],
    [
      /\b(?:usa?|u\.s\.a?\.?|united states(?: of america)?|america|americas|north america|canada|canadian|new york(?: city)?|nyc|brooklyn|boston|chicago|austin|denver|boulder|atlanta|miami|dallas|houston|philadelphia|pittsburgh|raleigh|salt lake city|toronto|montreal|ottawa|calgary|nashville|charlotte|minneapolis|detroit|columbus|scottsdale|phoenix|texas|florida|massachusetts|colorado|georgia usa|virginia|north carolina|illinois|ohio|pennsylvania|michigan|new jersey|washington,? d\.?c\.?|puerto rico)\b/,
      -5,
    ],
    [
      /\b(?:latam|latin america|south america|mexico|mexico city|brazil|brasil|são paulo|sao paulo|argentina|buenos aires|chile|colombia|bogot[aá]|medell[ií]n|peru|lima|uruguay|ecuador|costa rica|panama|guatemala|dominican republic|bolivia|paraguay|venezuela)\b/,
      -4,
    ],
    // Outside the Americas, so the rule works for a candidate based anywhere
    // (a US candidate drops "Remote, Singapore"; a Thai one keeps it).
    [
      /\b(?:united kingdom|uk|britain|england|scotland|ireland|portugal|iceland|london|dublin|lisbon)\b/,
      0,
    ],
    [
      /\b(?:europe|european union|eu|emea|germany|france|spain|italy|netherlands|belgium|switzerland|austria|poland|sweden|norway|denmark|finland|czech republic|czechia|hungary|romania|bulgaria|croatia|serbia|slovenia|slovakia|greece|estonia|latvia|lithuania|luxembourg|malta|cyprus|ukraine|berlin|paris|amsterdam|madrid|barcelona|warsaw|prague|stockholm|vienna|zurich|munich)\b/,
      1,
    ],
    [/\b(?:africa|south africa|nigeria|kenya|egypt|morocco|cape town|lagos|nairobi|cairo)\b/, 2],
    [
      /\b(?:middle east|mena|uae|dubai|abu dhabi|united arab emirates|saudi arabia|qatar|bahrain|kuwait|oman|israel|tel aviv|turkey)\b/,
      3,
    ],
    [/\b(?:india|bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai)\b/, 5.5],
    [/\b(?:thailand|bangkok|vietnam|hanoi|ho chi minh|jakarta|indonesia)\b/, 7],
    [
      /\b(?:apac|asia(?:-pacific)?|singapore|philippines|manila|hong kong|china|beijing|shanghai|taiwan|taipei|malaysia|kuala lumpur)\b/,
      8,
    ],
    [/\b(?:japan|tokyo|south korea|korea|seoul)\b/, 9],
    [/\b(?:australia|sydney|melbourne|brisbane|perth)\b/, 10],
    [/\b(?:new zealand|auckland|wellington)\b/, 12],
  ];
  // Two-letter US state codes → standard-time UTC offset (west coast -8, mountain
  // -7, central -6, east -5).
  const US_STATE_OFFSETS = new Map<string, number>([
    ...['CA', 'WA', 'OR', 'NV'].map((c) => [c, -8] as const),
    ...['AZ', 'UT', 'CO'].map((c) => [c, -7] as const),
    ...['TX', 'MN', 'WI', 'MO', 'OK', 'TN'].map((c) => [c, -6] as const),
    ...['NY', 'MA', 'FL', 'GA', 'NC', 'VA', 'OH', 'PA', 'MI', 'NJ', 'DC', 'MD', 'SC'].map(
      (c) => [c, -5] as const,
    ),
  ]);
  const BODY_REGION_RESCUE = (body: string) =>
    ACCEPTED_REGIONS_SPECIFIC.test(body) || BODY_ELIGIBILITY.test(body);

  function remoteLocationTiedToFarPlace(job: Job): boolean {
    if (TZ_CANDIDATE_OFFSET === undefined || !job.remote || !job.location) return false;
    if (regionAccepted(`${job.title}\n${job.location}`)) return false;
    if (BODY_REGION_RESCUE(job.body)) return false;
    const segments = job.location
      .split(/[,;/|()]+|\s-\s|\bor\b|\band\b/i)
      .map((seg) => seg.replace(GENERIC_REMOTE_TOKENS, ' ').replace(/\s+/g, ' ').trim())
      .filter((seg) => seg.length > 0);
    if (segments.length === 0) return false;
    return segments.every((seg) => {
      const stateOffset = US_STATE_OFFSETS.get(seg);
      if (stateOffset !== undefined) return tzGap(stateOffset, TZ_CANDIDATE_OFFSET) > TZ_MAX_DIFF;
      if (seg === 'CAN') return tzGap(-5, TZ_CANDIDATE_OFFSET) > TZ_MAX_DIFF;
      const lower = seg.toLowerCase();
      const hit = FAR_PLACES.find(([re]) => re.test(lower));
      return hit !== undefined && tzGap(hit[1], TZ_CANDIDATE_OFFSET) > TZ_MAX_DIFF;
    });
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
        // Rescue, but SCOPED. This used to scan `haystack` (location AND body),
        // which silently defeated the whole gate: "worldwide" and "global"
        // appear in ordinary marketing copy — "used by developers worldwide",
        // "a global team" — so a body blurb rescued roles whose stated location
        // was "US Remote" or "Hybrid - San Francisco". Observed live on three
        // boards at once.
        //
        // The distinction is WHERE the term appears:
        //   - In the stated location, a bare "Worldwide"/"Anywhere" IS the
        //     eligibility statement. Rescue on it.
        //   - In the body, only explicit hiring language or a specific named
        //     region counts — which preserves the original intent that a
        //     US-based company hiring across Europe is a job we want.
        // The title counts as stated location too: eligibility suffixes like
        // "MLE (UK/EU)" or "Support Engineer (APAC)" are the posting's own
        // region statement, and marketing vocabulary doesn't appear in titles.
        if (regionAccepted(`${job.title}\n${job.location ?? ''}`)) return false;
        // A posting can carry two conflicting body signals at once: a generic,
        // company-wide perks bullet ("Competitive salary / Work from anywhere /
        // High ownership...") alongside a role-specific eligibility sentence
        // ("This is a remote role for candidates located in Belo Horizonte,
        // Brazil."). The role-specific sentence describes THIS opening, not
        // company culture, so it must win over the generic phrase elsewhere in
        // the same body. Observed live: six country-specific LawnStarter
        // postings — each explicitly restricted to one named LatAm city/country
        // — were all rescued by a shared "Work from anywhere" perks bullet.
        const roleLocation = job.body.match(ROLE_SPECIFIC_LOCATION_STATEMENT);
        if (roleLocation && !regionAccepted(roleLocation[1] ?? '')) return true;
        if (BODY_REGION_RESCUE(job.body)) {
          return false;
        }
        // No accepted region anywhere. Drop when the posting is geo-constrained:
        // (a) it's NOT remote and names a specific out-of-region place — a
        //     genuinely onsite/physical posting there, or
        // (b) its location enumerates 2+ specific countries, none accepted —
        //     a closed hiring-eligibility list even for a remote posting, or
        // (c) its body (or location) declares a real requirement — explicit
        //     lock language, not just a named place a remote team sits in.
        if (!job.remote && locationFieldOutOfRegion(job.location)) return true;
        if (isClosedCountryList(job.location)) return true;
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
    {
      // Remote posting whose stated location is only far-away places (see
      // `remoteLocationTiedToFarPlace`). Rescued by an accepted/worldwide
      // region in title or location, or explicit eligibility language in the
      // body. NOT role-rescuable. Inert without `location.utcOffset`.
      name: 'remote_location_far_zone',
      test: (job) => remoteLocationTiedToFarPlace(job),
    },
    {
      // Required working hours in a zone far from the candidate's (see
      // `timezoneIncompatible`). Region-open "remote" postings still slip past
      // hard_location_incompatible when the hours requirement is only in prose.
      // NOT in ROLE_RESCUABLE_RULES: a great role can't change the clock.
      name: 'hard_timezone_incompatible',
      test: (job) => timezoneIncompatible(`${job.title}\n${job.body}`),
    },
    {
      // Confirmed-non-remote from a structurally trusted source (see
      // TRUSTED_REMOTE_SOURCES above) for a remote-only candidate. Deliberately
      // NOT in ROLE_RESCUABLE_RULES below — same rationale as
      // hard_location_incompatible: a great role fit doesn't change whether
      // the candidate can physically/legally take an onsite posting.
      name: 'confirmed_not_remote',
      test: (job) =>
        remoteOnly &&
        !job.remote &&
        TRUSTED_REMOTE_SOURCES.has(job.source) &&
        // A missing workplace type reads as "not remote" (Ashby: remote =
        // isRemote || workplaceType === 'Remote'; Lever: no 'remote' match), so
        // `remote: false` alone only means "not confirmed remote". Drop only on
        // positive evidence of hybrid / on-site: the normalised workplace type
        // (a tag) or hybrid / on-site wording in the stated location. Recruitee's
        // flag is a plain boolean with no third state, so it stays authoritative.
        // A location that literally says Remote ("Remote", "Worldwide, Remote")
        // is never confirmed on-site unless it also says hybrid / on-site.
        (job.source === 'recruitee' || hasExplicitNonRemote(job)) &&
        !(
          /\b(remote|worldwide)\b/i.test(job.location ?? '') &&
          !/\b(hybrid|on-?site)\b/i.test(job.location ?? '')
        ),
    },
    {
      // Age gate, independent of how good the match otherwise is — a stale
      // posting is a stale posting even for a perfect role match, so this is
      // deliberately NOT in ROLE_RESCUABLE_RULES below. Inert when
      // `maxAgeDays` is unset. A missing/unparsable `postedAt` is kept, not
      // dropped — absence of a date isn't evidence of staleness.
      name: 'stale_posting',
      test: (job) => {
        if (S.maxAgeDays == null || !job.postedAt) return false;
        const posted = new Date(job.postedAt).getTime();
        if (Number.isNaN(posted)) return false;
        const ageDays = (Date.now() - posted) / (24 * 60 * 60 * 1000);
        return ageDays > S.maxAgeDays;
      },
    },
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

      // Category matching (config-driven, replaces the hardcoded web3/ai block).
      // A job is tagged with every category whose keywords hit; a matched
      // category's weight is added once (binary, like the old web3/ai signals).
      const categoryScores: Record<string, number> = {};
      const matchedCategories: string[] = [];
      for (const c of CATEGORIES) {
        const haystack = c.scope === 'body' ? scoringBody : scoringTitleAndBody;
        if (c.re.test(haystack)) {
          matchedCategories.push(c.id);
          categoryScores[c.id] = c.weight;
        }
      }
      const categorySum = Object.values(categoryScores).reduce((a, b) => a + b, 0);

      const positives = {
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

      const positiveSum = Object.values(positives).reduce((a, b) => a + b, 0) + categorySum;

      const signals: JobSignals = {
        categories: categoryScores,
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
        // names no accepted region AND is geo-constrained elsewhere. Same
        // remote guard as the hard rule — a bare named place in a remote
        // posting isn't a requirement, only explicit lock language (or a
        // closed multi-country list) is.
        const outOfRegion =
          !regionAccepted(haystack) &&
          ((!job.remote && locationFieldOutOfRegion(job.location)) ||
            isClosedCountryList(job.location) ||
            LOCATION_LOCK.test(haystack));
        if (outOfRegion) {
          signals.outOfRegionPenalty = W.outOfRegionPenalty;
          score += W.outOfRegionPenalty;
        }
      }

      if (score < S.minScoreToKeep) {
        droppedScore++;
        continue;
      }

      kept.push({
        ...job,
        fitScore: score,
        categories: matchedCategories,
        roleMatches,
        _signals: signals,
      });
    }

    return { kept, droppedHard, droppedScore, droppedByRule };
  }

  return { applyFilters };
}
