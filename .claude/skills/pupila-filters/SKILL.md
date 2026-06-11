---
name: pupila-filters
description: How to tune job filter scoring, hard-drop rules, or debug why a specific job was kept/dropped via _signals. Use when adjusting weights in config/profile.json, adding a hard-exclude rule, tuning keyword lists, debugging fitScore, or interpreting the per-job _signals breakdown.
metadata:
  scope: pupila
---

All filter logic lives in `src/filters.ts`. Weights + keyword lists load from `config/profile.json` at runtime via `loadProfile()` (NOT a static import — the file is gitignored and auto-bootstrapped from `config/profile.default.json` on first run). Adjusting weights or keywords is a **non-code edit** to `profile.json`.

## Decision tree: what kind of change are you making?

| Task | Edit | Skill section |
|---|---|---|
| Change a scoring weight (e.g. seniority +15 → +20) | `config/profile.json#weights.<field>` | "Tuning weights" below |
| Add/remove a keyword (e.g. another Rust framework) | `config/profile.json#keywords.<list>` | "Tuning keywords" below |
| Add a new hard-drop rule | `src/filters.ts` (`HARD_RULES` array) | "Adding a hard-drop rule" below |
| Add a new positive signal type | `src/types.ts` + `config/profile.json#weights` + `src/filters.ts` | "Adding a new positive signal" below |
| Diagnose why a job has fitScore=N | Inspect `_signals` on the job | "Debugging via `_signals`" below |

## Order of operations (in `applyFilters`)

1. **Hard excludes** — URL safety, junior/intern titles, location-incompatible (persona-neutral — see "Location & work type" below), non-engineering compounds, leadership, non-frontend eng (since user is a frontend engineer), non-tech roles.
2. **Body preparation** — `preparedScoringBody()` strips boilerplate (EEO, privacy, "About us") and truncates to `scoringBodyMaxChars` (default 1500). Keyword scoring runs against this — prevents footer text like "we use Anthropic Claude internally" from landing a +20 AI signal on a backend role. **Hard-drops still see the full body.**
3. **Soft scoring** — additive, capped at `maxScore` (100):
   - Categories — each configured `CategoryDef` whose keywords match adds its `weight` once (binary); default `weight` 0 = pure label. Replaces the old hardcoded web3/ai signals. A job is tagged with every match (`Job.categories`).
   - Stack (+10 React/Next/TS, +5 RN/Expo, +5 GraphQL/Tailwind/Vite) — **tiered**
   - Seniority (+15 lead/staff/principal/head, +10 senior/sr) — binary
   - Frontend title (+10) — binary
   - Frontend body (+10) — **tiered**
   - Location (+10 when the job matches an accepted region / is remote — driven by the `location` block) — binary
   - Freshness (+10 within 7d, +5 within 14d) — binary
4. **Negative** — `outOfRegionPenalty` (default -10) if the job is region-locked outside the candidate's accepted regions and they haven't opted into hard-excluding. Applied **after** capping. (Persona-neutral; replaced the old US-centric penalty.)
5. **Drop** — anything with `fitScore < minScoreToKeep` (default 30).
6. **Categories** — `job.categories` = ids of every `CategoryDef` whose keywords matched (multi-label, config order); `[]` when none (renders under synthetic "Other"). Defined in `config/profile.json#categories`, generated from the brief on Regenerate or edited on the Profile tab. Each entry: `{ id, label, keywords, scope?, weight?, limit? }`.

## Tiered weighting

`tieredWeight(count, baseWeight)` scales by occurrence:

| Matches | Weight |
|---|---|
| 0 | 0 |
| 1 | `floor(base * 0.5)` |
| 2–3 | `base` |
| 4+ | `floor(base * 1.5)` |

Implemented with global-flag regexes (`STACK_PRIMARY_G`, `STACK_RN_G`, `STACK_OTHER_G`, `BODY_FRONTEND_KW_G`) + `countMatches`. Other signals stay binary.

See [`references/scoring-tiers.md`](references/scoring-tiers.md) for the full tier table and per-signal regex catalog.

## Tuning weights

Edit `config/profile.json#weights.<field>`. Re-run `pnpm run dev` (or just `pnpm run ui` — it reads the same file). No code change needed.

## Tuning keywords

Edit `config/profile.json#keywords.<list>`. `compileKw()` joins each list with `|` and wraps in `\b...\b/i` at runtime. Lists currently include:

- `seniorReq`, `engineeringKw` (whitelists — kept jobs must match these)
- `nonEngineering`, `nonFrontendEng`, `nonEngLeadership`, `nonEngCompound`, `nonEngRole`, `nonTechRole` (blacklists — drop on title match)
- `stackPrimary`, `stackRn`, `stackOther` (scoring signals)
- `profile.json#categories[]`: user-defined taxonomy (`{ id, label, keywords, scope?, weight?, limit? }`). Each match tags `job.categories` and adds `weight` to the score. Replaced the old hardcoded `web3*`/`ai*` keyword groups. **Category `keywords` are plain LITERAL terms, not regex** (unlike every list above): they're matched whole-word + case-insensitive by `compileCategoryKeywords()` in `src/filters.ts`, which anchors with alphanumeric lookarounds instead of `\b`, so punctuation-edged terms work (`c++`, `c#`, `.net`) and a dot between words is optional (`node.js` also matches `nodejs`). List both for other variants (`agent`/`agents`). Edit by hand, regenerate from the brief, or use the Profile-tab editor (`ui/src/CategoryPreferences.tsx`); validated by `sanitizeCategories()` (literal-only, no regex compile) in `src/lib/profile-generator.ts`.
- `profile.json#roles[]` — target job titles (`{ id, label, titleMatch, bodyMatch? }`); drive `roleTitle`/`roleBody` + `job.roleMatches` + the hard-drop rescue (see `references/scoring-tiers.md`)
- `locationLock`, `onsiteOnly`, `worldwideRemote` — persona-neutral geo *extraction* groups (no country names); the keep/drop decision compares them against `profile.json#location` (see "Location & work type" below)
- `locationRemote` — fallback remote signal only used when a profile has no `location` block

## Adding a hard-drop rule

`HARD_RULES` in `src/filters.ts` is a named-rule list. `applyFilters` runs `Array.find` over the rules, increments `droppedHard`, and tallies the rule name in `droppedByRule`. Breakdown surfaces in `JOBS.md` (e.g. `(missing_senior_req=812, ...)`).

```ts
HARD_RULES.push({
  name: 'descriptive_rule_name',
  test: (job, ctx) => /* return true to drop */,
});
```

No other plumbing — just append.

## Adding a new positive signal

1. Append the field to `JobSignals` in `src/types.ts`.
2. Add the weight to `config/profile.json#weights`.
3. Append one line to the `positives` object literal in `applyFilters`.

The sum is `Object.values(positives).reduce(...)` — auto-includes any new field. **No need to update the sum site.**

## Location & work type (persona-neutral geo)

Geo handling is driven entirely by the `location` block in `config/profile.json` — **no country is privileged** (a US-based and an EU-based profile get opposite outcomes from the same code; see the symmetry test in `tests/filters.test.ts`). Editable on the Profile tab (`ui/src/LocationPreferences.tsx`) or derived from the brief during Regenerate.

```jsonc
"location": {
  "basedIn": "Spain",                              // where the candidate lives (single)
  "workTypes": ["remote", "hybrid"],               // accepted arrangements: remote | hybrid | onsite
  "acceptedRegions": ["europe", "emea", "eu", "spain"], // region terms they'll work in (lowercased)
  "excludeOutsideAcceptedRegions": true            // true = hard-drop out-of-region; false = soft-penalize
}
```

**How `hard_location_incompatible` decides (rescue-first):**

1. **Work-type gate** — if the candidate doesn't accept `onsite`, the job isn't remote, and the text matches `onsiteOnly` → drop.
2. **Region gate** (only when `excludeOutsideAcceptedRegions` *and* a region preference exists):
   - **Rescue first** — if the posting names an accepted region / `basedIn` / `worldwideRemote` *anywhere*, **keep** it (a "Remote - US" label whose body welcomes Europe survives). `regionAccepted()` deliberately does NOT treat a bare "remote" as a region.
   - Else **drop** if the stated location names a specific non-accepted place (`locationFieldOutOfRegion()` — strips generic-remote tokens; "Remote" alone → empty residual → kept; "Remote, US" → "us" → dropped) **or** the body declares a real lock (`locationLock` — work authorization / must-be-based-in / timezone-required).

Key invariants:
- `workTypes` is only *lightly* wired: `onsite` controls the drop gate, `remote` feeds the `+locationRemote` bonus. **`hybrid` is currently inert** (captured but unused).
- Bare "Remote"/"Worldwide"/"Global"/"Distributed" are always kept — a job does NOT need a region word to survive. Only an explicit non-accepted location requirement drops it.
- Empty `acceptedRegions` + empty `basedIn` → region logic is inert (a fresh fork drops nothing on geography).
- `locationLock`/`onsiteOnly`/`worldwideRemote` are neutral *extraction* groups; tune the *candidate's* preference in the `location` block, not those lists.

UI/data plumbing: `useLocation` hook + `api.location` ↔ `GET/PUT /api/profile-location` (`ui/plugins/profile.ts`); `sanitizeLocation()` validates both LLM and UI input (`src/lib/profile-generator.ts`).

## Debugging via `_signals`

Every kept job carries a `_signals` object showing which scoring rules fired:

```jsonc
"_signals": {
  "categories": { "web3": 20, "ai": 20 },  // id → weight contributed; mirrors job.categories
  "stackPrimary": 10, "stackRn": 0, "stackOther": 0,
  "leadTitle": 0, "seniorTitle": 10,
  "roleTitle": 10, "roleBody": 10, "locationRemote": 10,
  "freshness7d": 10, "freshness14d": 0, "outOfRegionPenalty": 0,
  "rawTotal": 100, "capped": false
}
```

- `_signals.categories` keys are exactly `job.categories`; a value of 0 = a matched pure-label category.
- `rawTotal` is the un-capped positive sum.
- `capped: true` means positives summed > 100 before clamping.
- `outOfRegionPenalty` is applied **after** capping.

### Inspecting in-place

```bash
pnpm run dev
jq '.[0]._signals' data/jobs.json                                  # first job
jq '.[] | select(.id == "<sha1>") | ._signals' data/jobs.json      # specific job
jq '.[] | select(._signals.rawTotal > 100) | {company,title}' data/jobs.json  # capped
```

### In the UI

The Jobs-tab detail panel (click a row) renders the `_signals` breakdown alongside the AI take and meta. Tier-coloured cells: green ≥80, gold 50–79, muted <50.

## Updating tests when tuning

When tuning a regex or weight, update tests in the same commit. The frozen fixture lives at `tests/fixtures/test-profile.json` — bake new expected scores into `tests/filters.test.ts` (40 cases). Don't loosen the assertion to make a failing test pass.

## Related

- `src/filters.ts` — all logic.
- `tests/filters.test.ts` — every hard-drop branch, scoring signal, tiered weighting, boilerplate stripping.
- `config/profile.json` (gitignored) / `config/profile.default.json` (committed baseline).
- `pupila-ai-review` skill — when filters and AI verdicts disagree, the brief is usually the lever.
