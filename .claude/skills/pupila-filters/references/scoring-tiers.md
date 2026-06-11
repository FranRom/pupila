# Scoring tiers + signal regex catalog

Companion deep-dive for the `pupila-filters` skill. Open this only when you need the exact regex set or the tier multiplier maths.

## Tier multipliers (`tieredWeight`)

```
count = 0  → 0
count = 1  → floor(base * 0.5)
count 2-3  → base
count >= 4 → floor(base * 1.5)
```

Worked example with `base = 10` (stackPrimary):

| Matches | Weight |
|---|---|
| 0 | 0 |
| 1 | 5 |
| 2 | 10 |
| 3 | 10 |
| 4 | 15 |
| 5+ | 15 |

## Signal catalog (current — verify against `src/filters.ts` if uncertain)

| Signal | Type | Max | Regex group (global flag set) |
|---|---|---|---|
| `categories[<id>]` | binary | each category's `weight` | per-category keyword list from `profile.json#categories` (e.g. a `web3` or `ai` `CategoryDef`). Keywords are plain LITERAL terms (not regex), matched whole-word via `compileCategoryKeywords()` (alphanumeric lookarounds, not `\b`), so `c++`/`.net` work and `node.js` also matches `nodejs`. Matched against title+body, or body-only when `scope: 'body'`. Recorded in `_signals.categories` keyed by id; replaces the old fixed `web3*`/`ai*` signals. |
| `stackPrimary` | **tiered** | 10/5/15 | React, Next.js, TypeScript |
| `stackRn` | **tiered** | 5/2/7 | React Native, Expo |
| `stackOther` | **tiered** | 5/2/7 | GraphQL, Tailwind, Vite |
| `leadTitle` | binary | 15 | lead/staff/principal/head/director |
| `seniorTitle` | binary | 10 | senior/sr (matched only if `leadTitle` didn't fire) |
| `roleTitle` | binary | 10 | title matches any configured role interest's `titleMatch` (see `profile.json#roles[].titleMatch`) |
| `roleBody` | **tiered** | 10/5/15 | strongest role's body phrases (`profile.json#roles[].bodyMatch`), e.g. "design system", "accessibility", "a11y" |
| `locationRemote` | binary | 10 | job matches an accepted region (`profile.json#location.acceptedRegions` / `basedIn`) or is remote |
| `freshness7d` | binary | 10 | postedAt within 7 days |
| `freshness14d` | binary | 5 | postedAt within 14 days (only if 7d didn't fire) |
| `outOfRegionPenalty` | binary | **-10** | job region-locked outside accepted regions, when not hard-excluding (applied AFTER capping; persona-neutral — see the `pupila-filters` "Location & work type" section) |

The exact regex sources live in `config/profile.json#keywords.*`. The `_G` global-flag variants for tiered signals are built once at module scope from those lists via `compileKw(...kw, 'g')`.

## Role interests (`profile.json#roles[]`)

Each role is `{ id, label, titleMatch, bodyMatch? }`. The shared `roleTitle` / `roleBody` weights price a match; the role list defines *what* matches. Per job:

- `job.roleMatches` = ids of roles whose `titleMatch` fired on the title (role-list order). Drives the UI role badges + Role filter.
- A non-empty `roleMatches` **rescues** the job from the title-based hard drops `non_engineering`, `title_excluded_specialty`, and `title_non_eng_role` — so a declared secondary role (e.g. Product Engineer) survives even when the avoid-list would otherwise kill it. Person-level drops (junior, missing-senior, location, unsafe-url) still apply.
- `roleBody` is the tiered weight of the single strongest role's `bodyMatch` count (max across roles), so overlapping role keywords don't double-count.

Empty/absent `roles` → `roleTitle`/`roleBody` never fire and nothing is rescued (pre-feature behavior).

## Cap behavior

`maxScore = 100`. Positives sum first, then clamp, then apply `outOfRegionPenalty`. So a job with rawTotal 120 that's region-locked out lands at `100 - 10 = 90`, not `120 - 10 = 110` clamped.

## Boilerplate stripping (in `preparedScoringBody`)

Strips:

- EEO / equal-opportunity boilerplate
- Privacy / data-handling sections
- Accommodations / reasonable-adjustments
- "About us" / "About <company>" intros
- Truncates to `scoringBodyMaxChars` (default 1500) after stripping

Hard-drops still see the FULL body (the truncation is only for scoring keyword counts).

## When to update this file

- New positive signal added → append a row.
- Tier multipliers tweaked → update the worked example.
- New regex group → append to the catalog.

Don't let this file drift more than a commit behind `src/filters.ts`. If you tune scoring, update this in the same commit.
