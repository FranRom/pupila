# CLAUDE.md

Guidance for future Claude Code sessions working in this repo.

## Overview

`job-hunt` is a personal job aggregator that runs daily on GitHub Actions. It fetches listings from 13 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS feeds, JSON job boards, Hacker News, HTML scrapers, an Aave Next.js scraper, and `ashby-private` — a config-driven fetcher for orgs hosted on Ashby with the public posting-API disabled), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json`, an RSS feed at `data/feed.xml`, and an auto-regenerated `JOBS.md` table. The hand-written `README.md` is the project doc and is **not** rewritten by the pipeline. No external services. No DB. Output lives in this repo.

The pipeline is tuned for: senior/lead/staff frontend, web3 (EVM + Solana), and AI engineering roles, remote / EMEA / worldwide.

## Stack

- Node 22 LTS, ESM, TypeScript 5.9 (NodeNext)
- Biome 2.4 (lint + format, single config in `biome.json`)
- pnpm 10
- Vitest 3 (tests in `tests/`, run via `pnpm test` — 120 cases)
- simple-git-hooks (pre-commit `lint && typecheck`)
- Single runtime dep: `fast-xml-parser`. Native `fetch` only.

## Run locally

```bash
pnpm install                # also installs the pre-commit hook
pnpm run dev                # tsx, no build step (this is what CI runs too)
pnpm start                  # built output: requires pnpm run build first
pnpm run typecheck          # tsc --noEmit on src/, then on src/+tests/ via tsconfig.test.json
pnpm run lint               # biome check
pnpm run lint:fix            # biome check --write
pnpm test                   # vitest run (120 unit tests)
pnpm run test:watch         # vitest watch mode
pnpm run ui                 # local-only UI: Vite dev server on http://127.0.0.1:5173, reads data/jobs.json
pnpm run ai-review          # local-only: shells out to `claude -p` to write data/ai-reviews.json
pnpm run ai-review --top=50 # raise the per-run cap (default 20 highest-fitScore unreviewed)
pnpm run ai-review --force  # re-review entries that already exist
pnpm run ai-review --ids=a,b # review specific job ids only
pnpm run daily              # convenience: pnpm run dev && pnpm run ai-review (morning routine)
```

The pipeline writes to `data/jobs.json` (slim — `body` field stripped), `data/feed.xml` (RSS 2.0 of new jobs), `JOBS.md`, optionally `data/archive/<YYYY-MM>.json` on day 1 of the month, and per-source raw dumps in `data/raw/<source>-<YYYY-MM-DD>.json` (gitignored). `README.md` is hand-maintained — never overwrite it from code.

Pre-commit runs `lint && typecheck` automatically. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for emergency commits.

## Repo layout

```
src/
  index.ts          # orchestrator
  types.ts          # Job, Source, Category, ApplicationStatus, AppliedEntry, FetcherResult, Raw* shapes
  utils.ts          # fetchWithTimeout (1-retry), isSafeUrl, sha1, stripHtml, readJsonOrNull, ...
  rss.ts            # shared fast-xml-parser wrapper
  normalize.ts      # one normalize<Source> per source -> Job (uses withSalary() for parsed salary fields)
  salary.ts         # parseSalary(): raw string -> { min, max, currency } (annual integer, ISO code)
  filters.ts        # hard excludes + scoring + category + _signals (loads config/profile.json)
  applied.ts        # loads config/applied.json, attaches AppliedEntry to Job by URL hash
  dedup.ts          # 2-pass dedup, priority-aware tiebreak
  render.ts         # JOBS.md markdown (applied, ✨ new, 🗑 removed, 🚨 source-health, status/salary in title)
  feed.ts           # RSS 2.0 generator -> data/feed.xml (top 50 ✨ new jobs)
  fetchers/
    _shared.ts                                              # fetchMultiSlug orchestration helper
    ashby.ts            greenhouse.ts       lever.ts        # ATS APIs (public, multi-slug)
    ashby-private.ts                                        # multi-slug GraphQL for hidden Ashby orgs
    aave.ts                                                 # first-party scraper (Next.js __NEXT_DATA__)
    aijobsnet.ts        cryptojobslist.ts   web3career.ts   # boards / scrapers
    hn-hiring.ts        hn-jobs.ts                          # Hacker News
    remoteok.ts         remotive.ts         weworkremotely.ts

config/
  slugs.json        # tier-S Ashby/Greenhouse/Lever slug arrays
  profile.json      # scoring weights + keyword lists (non-code tuning surface)
  applied.json      # hand-edited list of jobs you've applied to

tests/
  filters.test.ts          # 33 cases — hard drops, droppedByRule, scoring, plurals, frontendBody, boilerplate, tiered weighting
  dedup.test.ts            # 10 cases — id/title collapse, priority, compareJobs salary/postedAt/id chain
  applied.test.ts          # 4 cases  — STATUS_EMOJI map + summarizeApplied grouping/ordering
  salary.test.ts           # 15 cases — K/M suffix, currency detection, hourly→annual, free-text fallback
  feed.test.ts             # 6 cases  — RSS skeleton, escaping, sort, 50-item cap
  aave.test.ts             # 7 cases  — __NEXT_DATA__ extraction + normalizer
  ashby-private.test.ts    # 9 cases  — GraphQL list/detail parsers + slug-to-company derivation
  ai-review-parse.test.ts  # 9 cases  — markdown-fence stripping, invalid verdicts, missing fields, dirty arrays
  normalize-hn.test.ts     # 7 cases  — hn-hiring header parsing, plausible-company guard, role-pattern fallback
  utils.test.ts            # 20 cases — URL safety, stripHtml, time math, human date formatter

ui/                 # local-only browser dashboard (Vite + React)
  index.html        # Vite entry
  vite.config.ts    # explicit `root` set via fileURLToPath so `pnpm run ui` works from repo root
  tsconfig.json     # bundler module resolution + DOM lib + JSX
  src/
    main.tsx        # ReactDOM.createRoot
    App.tsx         # single-component MVP: filter + sort + table over data/jobs.json
    types.ts        # local copy of Job/Source/Category/AppliedEntry (slim — no body, no _signals)
    styles.css      # CSS variables + dark mode via prefers-color-scheme
    vite-env.d.ts   # /// <reference types="vite/client" /> for CSS-import typing

tsconfig.json       # rootDir=src/, strict NodeNext
tsconfig.test.json  # extends above with rootDir=. so tests/ typecheck without leaking into the build

.github/
  workflows/
    jobs.yml        # daily cron + auto-commit (commits jobs.json + archive + JOBS.md)
    keepalive.yml   # weekly cron to keep schedules alive
    check.yml       # PR/push: lint + typecheck + test + audit
  dependabot.yml    # weekly npm + github-actions PRs
```

> **CodeQL workflow removed.** Code Scanning isn't available on private repos without GitHub Advanced Security. If the repo ever goes public, restore `.github/workflows/codeql.yml` from commit `7397117`.

## How to add a new fetcher

1. Add a Raw shape to `src/types.ts` (e.g. `RawFooBoard`).
2. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<FetcherResult<Raw>>` — i.e. returning `{ items: Raw[]; errors: string[] }`. **Never throw.** Catch all errors internally, push them onto the `errors` array, and return.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `utils.ts` (30s timeout, 1 retry on 5xx/network).
   - Pass `JSON_HEADERS` or `RSS_HEADERS` so the request looks like a real browser.
   - For multi-slug/multi-page fetchers, **use `fetchMultiSlug` from `src/fetchers/_shared.ts`** — it handles the Promise.all + per-slug try/catch + console.error logging + flatMap-aggregate scaffolding. The fetcher only owns the per-slug extraction (URL construction + response shape mapping). See `ashby.ts`, `greenhouse.ts`, `lever.ts` for the canonical pattern.
3. Add the literal source name to the `Source` union in `src/types.ts`.
4. Add a normalizer to `src/normalize.ts`: `normalize<Name>(items, fetchedAt): Job[]`.
5. Wire it into `src/index.ts`:
   - Import `fetch<Name>` and `normalize<Name>`.
   - Add a line to the `Promise.all` block: `processFetcher('<source>', fetch<Name>, normalize<Name>, fetchedAt, today)`.
6. Add the new source to `SOURCE_PRIORITY` in `src/dedup.ts` and to the `SOURCES` list in `src/render.ts`.
7. Add at least one test in `tests/` covering the parser if it's an HTML scraper.

Smoke-test locally before wiring it into `index.ts`:

```bash
npx tsx -e "import('./src/fetchers/<name>.ts').then(async m => { const r = await m.fetch<Name>(); console.log('count:', r.items.length, 'errors:', r.errors, 'first:', r.items[0]); })"
```

## How to add a tier-S company

All three slug arrays live in `config/slugs.json` — adding a company is a non-code edit. Pick the right ATS based on where the company hosts:

| ATS | JSON key | URL pattern (find slug here) |
|---|---|---|
| Ashby | `ashby` | `jobs.ashbyhq.com/<slug>` |
| Greenhouse | `greenhouse` | `boards.greenhouse.io/<slug>` |
| Lever | `lever` | `jobs.lever.co/<slug>` |

The `TIER_S_ASHBY_SLUGS` / `TIER_S_SLUGS` / `TIER_S_LEVER_SLUGS` exports in each fetcher file are now thin re-exports of the JSON config.

Probe before adding (each ATS exposes a public board endpoint that returns 200 + JSON if the slug is live):

```bash
curl -sI "https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"
curl -sI "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs"
curl -sI "https://api.lever.co/v0/postings/<slug>?mode=json"
```

Slugs that 404 are logged and skipped silently, so it's safe to leave a known-bad slug in the list while waiting for upstream to restore it.

If a target company isn't on any of the three big ATSes, it might still be on Ashby's hosted-board GraphQL even when the public posting-API returns 404 — try `https://jobs.ashbyhq.com/<slug>` in a browser; if that loads, just append the slug to `config/slugs.json#ashbyPrivate` (the `ashby-private` fetcher in `src/fetchers/ashby-private.ts` will pick it up — no new code needed). Genuine custom ATSes (Webflow CMS, Next.js careers pages, etc.) need their own per-company HTML scraper — `src/fetchers/aave.ts` is the canonical example for Next.js `__NEXT_DATA__` extraction.

## Filter rules

All in `src/filters.ts`. **Weights and keyword lists are loaded from [`config/profile.json`](./config/profile.json) at startup** — `compileKw()` joins each keyword array with `|` and wraps in `\b...\b/i`. Adjusting a weight or adding a keyword is a non-code change.

The hard-drop chain is a named-rule list (`HARD_RULES` in `filters.ts`) — `applyFilters` runs `Array.find` over the rules, increments `droppedHard`, and tallies the rule name in `droppedByRule`. The breakdown surfaces in JOBS.md next to the hard-drop count (e.g. `(missing_senior_req=812, title_non_eng_role=64, ...)`) so you can see at a glance which rule does the heavy lifting. To add a new hard-drop check, append a `{ name, test }` entry to `HARD_RULES` — no other plumbing needed.

Applied in this order:

1. **Hard excludes** (drop entirely)
   - URL is not http/https (security gate via `isSafeUrl`)
   - Title contains junior/jr/intern/entry-level/associate/graduate/trainee/apprentice
   - Title does NOT contain a senior_req keyword (senior/sr/staff/principal/lead/head/director/engineer(s)/developer(s)/architect(s))
   - Body matches a hard US-only/onsite pattern (uses **full body**, not the truncated scoring body — onsite language at the bottom of a posting must still count)
   - Title or body matches a non-engineering pattern AND title lacks an engineering keyword
   - Title matches `TITLE_NON_ENG_COMPOUND`: customer support/success engineer, sales engineer, solutions engineer, developer relations/advocate/experience, devrel, field engineering/operations, business/sales/people operations, partner(ships) engineer, technical sourcer/recruiter, forward deployed/implementation/onboarding engineer, gtm, go-to-market. These titles contain the word "Engineer" but aren't real engineering.
   - Title matches `TITLE_NON_ENG_LEADERSHIP`: VP/Vice President, CMO, CRO, CFO, COO.
   - Title matches `TITLE_NON_FRONTEND_ENG`: product security / data / devops / sre / infrastructure / platform / qa / network / firmware / embedded engineer (the user is a frontend engineer; these specialties are out of scope).
   - Title matches `TITLE_NON_ENG_ROLE`: lead/manager roles for client/account/customer/business/product/operations/regional/country (real "engineering lead" roles still pass via the seniorReq engineering keyword).
   - Title matches `TITLE_NON_TECH_ROLE`: analyst, trader, scientist, researcher.
2. **Body preparation for scoring.** `preparedScoringBody()` strips known company boilerplate (EEO, privacy notice, accommodations, "About us") and truncates the remainder to `scoringBodyMaxChars` (default 1500). All keyword scoring runs against this prepared body — prevents footer text like "we use Anthropic Claude internally" from landing a +20 AI signal on a backend role. Hard-drop checks above still see the **full** body.
3. **Soft scoring** (additive, capped at `maxScore` = 100):
   - Web3 signals (+20 title/body, +20 stack) — binary
   - AI signals (+20 title/body, +20 stack) — binary
   - Stack signals (+10 React/Next/TS, +5 RN/Expo, +5 GraphQL/Tailwind/Vite) — **tiered** (see below)
   - Seniority (+15 lead/staff/principal/head, +10 senior/sr) — binary
   - Frontend title (+10 if title contains frontend/fullstack/web/mobile) — binary
   - Frontend body (+10 if body contains role-specific frontend phrases like "design system" / "ship components" / "accessibility") — **tiered**
   - Location (+10 remote/EMEA/CET/Spain/anywhere) — binary
   - Freshness (+10 within 7 days, +5 within 14 days) — binary

   **Tiered weighting** applies to the four signals marked _tiered_ via `tieredWeight(count, baseWeight)` in `filters.ts`: 0 mentions = 0, 1 = `floor(base * 0.5)` (half), 2–3 = base, 4+ = `floor(base * 1.5)` (1.5× boost). Implemented with global-flag regexes (`STACK_PRIMARY_G`, `STACK_RN_G`, `STACK_OTHER_G`, `BODY_FRONTEND_KW_G`) + `countMatches`. The other signals stay binary because they're inherently low-cardinality and gaming them with repetition isn't a real concern.
4. **Negative**: -10 if body hints US-centric without remote-worldwide language. Applied after capping.
5. **Drop** anything with `fitScore < minScoreToKeep` (default 30).
6. **Category**: `web3+ai` if both web3 and AI signals fired, else `web3`, `ai`, or `general`.

To adjust a weight, edit `config/profile.json#weights.<field>`. To add a keyword to an existing list, edit `config/profile.json#keywords.<list>`. For new signal types or new hard-drop branches, edit `applyFilters` in `filters.ts` directly.

**Adding a new positive signal.** Append the field to the `JobSignals` interface in `types.ts`, add its weight to `config/profile.json#weights`, and append one line to the `positives` object literal in `applyFilters`. The sum is computed via `Object.values(positives).reduce(...)` so you don't need to remember to update an addition chain — it auto-includes any new field.

### Debugging fitScore via `_signals`

Every kept job in `data/jobs.json` has a `_signals` object showing exactly which scoring rules fired:

```jsonc
"_signals": {
  "web3TitleBody": 0,    "web3Stack": 20,
  "aiTitleBody": 20,     "aiStack": 20,
  "stackPrimary": 10,    "stackRn": 0,    "stackOther": 0,
  "leadTitle": 0,        "seniorTitle": 10,
  "frontendTitle": 10,   "frontendBody": 10,
  "locationRemote": 10,
  "freshness7d": 10,     "freshness14d": 0,
  "usCentricPenalty": 0,
  "rawTotal": 110,       "capped": true
}
```

When tuning regexes, run `pnpm run dev`, then `jq '.[0]._signals' data/jobs.json` (or read it directly) to see the breakdown of the top job. `rawTotal` is the un-capped positive sum; `capped: true` means positives summed > 100 before clamping; `usCentricPenalty` is applied after capping.

## Application tracking

`config/applied.json` is a hand-edited list of jobs you've applied to. Schema in `src/types.ts`:

```ts
type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
interface AppliedEntry { url: string; status: ApplicationStatus; date: string; notes?: string }
```

`src/applied.ts` exports:
- `STATUS_EMOJI` — the emoji prefix shown in `JOBS.md` titles (📝 / 💬 / 🎯 / ❌ / ⏸).
- `loadAppliedMap(path?)` — reads the JSON, hashes each `url` with `sha1(normalizeUrl(...))` (the same identity used for `Job.id`), and returns a `Map<idHash, AppliedEntry>`.
- `summarizeApplied(entries)` — produces the one-line summary header (e.g. `🎯 1 offer · 💬 2 interview · 📝 5 applied`).

Wired in `src/index.ts` after dedup+sort: every kept job gets `job.applied = appliedMap.get(job.id)` when matched. `render.ts` then:
1. Renders a "📋 Application status" section at the top of `JOBS.md` (above "✨ New since last run") if any applied entries exist, sorted by date desc.
2. Prefixes the title cell with the status emoji in every category section so already-applied jobs are still visible (deliberate — you may want to follow up or compare against a duplicate posting).

**Don't filter applied jobs out of the main list.** The user explicitly asked for them to remain visible.

## Dedup

In `src/dedup.ts`:
1. By `id` (sha1 of normalized URL).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

Tiebreak: highest `fitScore` wins; on ties, the source with higher `SOURCE_PRIORITY` wins. Order: aave = ashby-private > ashby > lever > greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok.

## Final sort (`compareJobs`)

`src/dedup.ts` exports a `compareJobs(a, b)` comparator that the orchestrator uses for the post-dedup sort. Order:

1. `fitScore` desc (primary)
2. `salaryMax` desc (transparent-comp companies float up among score-tied roles; `null` is treated as 0 so unstated comp sinks below stated comp)
3. `postedAt` desc (newest first)
4. `id` asc (deterministic tiebreak so day-over-day diffs are stable when everything else ties)

The comparator is exported (not just inlined) so it can be unit-tested directly in `tests/dedup.test.ts`.

## New-since / removed-since diff

Right before writing the new `data/jobs.json`, the orchestrator reads the **previous** committed copy via `readJsonOrNull`, builds two sets (previous IDs, current IDs), and computes:

- `newJobs = current − previous` → "✨ New since last run" section (top 20 by `fitScore` desc, also drives `data/feed.xml`).
- `removedJobs = previous − current` → "🗑 Removed since last run" section (top 10 by previous `fitScore`).

Both lists become counts in `RenderStats.newCount` / `removedCount` and are passed to `renderReadme(jobs, stats, newJobs, removedJobs)`.

On the very first run (no previous file or unparseable file) `previous === null` and both diffs are treated as empty (sections are omitted entirely). Don't change this — it prevents the first run from declaring "all 900 jobs are new" when there's no baseline.

The read happens **after** filter+dedup+sort but **before** `writeJson('data/jobs.json', ...)`, so the new file overwrites the old one cleanly.

## RSS feed

[`src/feed.ts`](./src/feed.ts) emits a hand-rolled RSS 2.0 XML to `data/feed.xml` containing the top 50 `newJobs` by `fitScore`. The XML is hand-built (not via fast-xml-parser) because we control the content shape — `escapeXml` covers the five entity classes. The workflow's auto-commit `file_pattern` includes `data/feed.xml`. To subscribe: point any RSS reader at `https://raw.githubusercontent.com/FranRom/job-hunt/main/data/feed.xml`.

## Salary parsing

[`src/salary.ts`](./src/salary.ts) `parseSalary(raw)` returns `{ min, max, currency }`, normalizing to **annual integers** (USD/EUR/etc., minor units stripped). It handles `$120K-$180K`, `€80,000 - €110,000`, `100K-150K USD`, hourly via `2080` annualization, M-suffixed ($1M-$2M), single-value salaries, currency code or symbol detection, and rejects sub-$1000 amounts as noise. Returns `{ null, null, null }` for free-text like "competitive". Hooked into [`src/normalize.ts`](./src/normalize.ts) via a `withSalary()` spread so adding a future salary-emitting source is one line.

`Job.salary` (raw string for display) and `Job.salaryMin / salaryMax / salaryCurrency` (parsed) are both populated. The display column in `JOBS.md` keeps using `salary`; future filtering/sorting can use the numeric fields.

## Source-health alarms

`src/render.ts` flags fetchers whose `fetched === 0` OR `errors > 0` in the **current run**: a 🚨 banner appears above the Stats section, and the offending sources get a 🚨 prefix in the by-source list. Single-run signal only — no historical tracking. Catches silent breakage (web3career and aijobsnet markup changes have hit us before). If a normally-quiet source legitimately returns 0 (e.g. cryptojobslist while upstream is down), it'll alarm — that's still useful surfacing.

## GitHub Actions

Three workflows total:

- **`.github/workflows/jobs.yml`** — `0 7 * * *` daily + `workflow_dispatch`. Runs `pnpm run dev` (no build step). Auto-commits `data/jobs.json`, `data/feed.xml`, the `data/archive` directory, and `JOBS.md` if anything changed. `permissions: contents: write`. The auto-commit pattern uses the `data/archive` directory (not a glob) because `data/archive/*.json` errors when no files match — keep `data/archive/.gitkeep` so the directory always exists.
- **`.github/workflows/check.yml`** — every push to `main` and every PR. Lint, typecheck, test, audit. `permissions: contents: read`.
- **`.github/workflows/keepalive.yml`** — `0 12 * * 0` weekly. Touches `.keepalive` so GitHub doesn't disable the daily schedule after 60 days of repo inactivity.

`.github/dependabot.yml` opens weekly grouped PRs for npm + github-actions.

**Pinning.** All third-party actions in every workflow are referenced by full 40-char commit SHA, not a floating `@v4` / `@v5` tag, with the version in a trailing comment. When updating an action, replace both the SHA and the comment. Dependabot will keep these current via PRs.

To trigger the daily run manually: `gh workflow run jobs.yml`.

## Tests

Vitest, 120 cases across 10 files in `tests/` with `*.test.ts` glob. Run via `pnpm test` (CI) or `pnpm run test:watch` (interactive).

- **`tests/utils.test.ts`** (20): `isSafeUrl` allowlist, `normalizeUrl` (utm strip, scheme reject), `stripHtml`, `normalizeText`, `sha1Hex`, `relativeTime`, `withinDays`, `formatDateTimeUTC` (human-readable "DD Month YYYY, HH:MM UTC").
- **`tests/normalize-hn.test.ts`** (7): `normalizeHnHiring` header extraction with `|` and em-dash separators, plausible-company guard (rejects whole-body leak, sentence-like candidates, >60 char strings), role-pattern fallback when no header is present.
- **`tests/filters.test.ts`** (33): every hard-drop branch (junior, senior_req, US-only, compound non-eng, non-frontend eng, non-eng role, non-tech role, exec, URL scheme), `droppedByRule` rule attribution, every score signal, category derivation, score capping with `_signals.capped`, US-centric penalty, plural title acceptance, frontendTitle/frontendBody bonuses, boilerplate stripping (AI keywords in EEO footer must NOT score), tiered keyword weighting (1 mention = half-weight, 4+ = 1.5× boost across `stackPrimary` and `frontendBody`).
- **`tests/dedup.test.ts`** (10): id collapse, normalized company+title collapse, fitScore tiebreak, source priority tiebreak (`ashby > greenhouse > remoteok`, `lever > web3career`), empty input, plus 5 cases for `compareJobs` covering the four-key chain (fitScore desc → salaryMax desc with null-as-zero → postedAt desc → id asc).
- **`tests/applied.test.ts`** (4): `STATUS_EMOJI` map presence, `summarizeApplied` empty input, grouping/counting, ordering (offer → interview → applied → withdrawn → rejected).
- **`tests/salary.test.ts`** (15): K/M suffix parsing, comma-grouped numbers, currency symbol vs code detection (USD/EUR/GBP/CAD), hourly→annual conversion via 2080 hours, single-value salaries, sub-$1000 rejection, free-text fallback, range inversion handling.
- **`tests/feed.test.ts`** (6): RSS 2.0 skeleton + channel metadata, item title with fit score prefix, XML escaping (`&`, `<`, `>`), `fitScore desc` ordering, 50-item cap, salary surfaced in description.
- **`tests/aave.test.ts`** (7): `__NEXT_DATA__` extraction from raw HTML and `normalizeAave` mapping (URL build, body strip, postedAt, location/remote inference).
- **`tests/ashby-private.test.ts`** (9): GraphQL `parseListResponse` / `parseDetailResponse` shape handling and `normalizeAshbyPrivate` slug-to-company derivation (`chainlink-labs` → "Chainlink Labs", `matter-labs` → "Matter Labs"), brief-only fallback when detail is null, stable id derivation.

When tuning a filter regex or scoring weight (in `config/profile.json` or `filters.ts`), update the test in the same commit. The `check.yml` workflow runs the full suite on every PR.

`tsconfig.test.json` extends `tsconfig.json` with `rootDir: "."` and `include: ["src/**/*", "tests/**/*"]`. The `pnpm typecheck` script runs both: first `tsc --noEmit` against `tsconfig.json` (the production build config) to catch issues that would block compilation, then `tsc --noEmit -p tsconfig.test.json` to typecheck the tests without leaking them into the build's `rootDir`.

## Local UI (`pnpm run ui`)

A Vite + React 19 dashboard at `ui/` that reads `data/jobs.json` and `data/ai-reviews.json` directly via JSON import. **Local-only — no auth, no hosting, intentionally not exposed beyond `127.0.0.1:5173`** (the user explicitly chose this over public Pages because a public dashboard surfacing their applied-job statuses could be Google-indexed and visible to recruiters). Don't add a `pnpm run ui:deploy` or wire it into a workflow without explicit instruction.

Single-component MVP (no router, no state-management lib): filter chips for category/source/applied, search box, sortable columns (score / salaryMax / postedAt), dark-mode via `prefers-color-scheme`. Score cells are tier-colored (green ≥80, gold 50-79, muted <50). Long company/title cells are clamped to 2 lines via `display: -webkit-box` (the clamp is on a `<span>` wrapper inside the `<td>` — applying it directly on the `<td>` breaks table-cell layout).

**Expandable rows.** Clicking a row opens a 3-column detail panel with: the LLM "AI take" (summary, verdict reason, wants/offers/red-flags) when `data/ai-reviews.json` has an entry for that job; the `_signals` score breakdown showing which scoring rules fired and what they contributed; meta (location, tags, posted date, id). The Apply link in the row uses `e.stopPropagation()` so it doesn't trigger expand. Verdict badge (`strong-match` / `match` / `weak-match` / `skip`) appears next to the title when an AI review exists.

**Group by company (default on).** When the `Group by company` checkbox is on, jobs fold by lower-cased `company` field. Single-job "groups" render flat (no header noise) — only multi-job companies get a collapsible header row showing top score + role count + a one-line preview of the top role. Click the header to reveal the rest. The active sort key (`fitScore` / `salaryMax` / `postedAt`) drives both the within-group order and the inter-group order (using each group's top job as the comparator). Toggle off for a flat view.

**URL-encoded state.** All filter / sort / group / expand state syncs to `window.location.search` via `history.replaceState` (no back-button spam). Keys: `q` (search), `cat`, `src`, `applied=1`, `sort`, `dir=asc`, `group=0` (only when off, since on is the default), `expanded=<jobId>`, `co=<lowercased-company>`. Defaults are omitted from the URL to keep it short. On load the App reads the URL once via a `useMemo` lazy initializer; afterwards a single `useEffect` writes back any state change. **Don't use `pushState`** — every keystroke would create a history entry.

`ui/src/types.ts` is a deliberate copy of the relevant subset of `src/types.ts` (`Job`, `JobSignals`, `AppliedEntry`, `AiReview`, `AiReviews`). The pipeline strips `body` from the persisted `data/jobs.json`, but **`_signals` is kept** so the UI can render it without re-running scoring. Don't rewrite ui/src/types.ts to import from `src/types.ts` — that pulls in `with { type: 'json' }` config imports that don't resolve in the browser context.

The HTML has `<meta name="robots" content="noindex,nofollow">` as belt-and-suspenders even though it's local-only.

`pnpm run typecheck` runs all three TS configs: `tsconfig.json`, `tsconfig.test.json`, and `ui/tsconfig.json`.

## AI per-job review (`pnpm run ai-review`)

[`src/ai-review.ts`](./src/ai-review.ts) is a **local-only** companion to the daily pipeline that augments selected jobs with an LLM review. It shells out to `claude -p "<prompt>"` per job, which uses the user's Claude Code subscription (e.g. Max plan) — **not** the Anthropic API, so there are no per-token charges. **Don't try to run this from GitHub Actions.** A workflow runner can't auth as the Max-subscribed user; if you ever want a hosted run you'd need to switch to the Anthropic API SDK with an API key (separate billing).

**Inputs:**
- `data/jobs.json` — the slim list (committed)
- `data/jobs-bodies.json` — sidecar with full bodies (gitignored, regenerated by `pnpm run dev` so the AI step has the body to review)
- `data/ai-reviews.json` — existing reviews (committed; starts as `{}`)
- `config/candidate-brief.md` — natural-language description of who the candidate is and what they're avoiding. Hand-edited. The prompt embeds it verbatim, so this is the main lever for tuning what "match" / "skip" actually mean.

**Output:** `data/ai-reviews.json`, a `Record<jobId, AiReview>` map. Each `AiReview` carries a one-sentence summary, 3 bullets each for `wants` / `offers` / `redFlags`, a verdict (`strong-match | match | weak-match | skip`), and a one-sentence `reason` explaining the verdict (especially when the LLM disagrees with the rule-based fitScore). The script writes after every successful review so a Ctrl-C or rate-limit kill leaves a partial-but-valid file.

**Selection logic.** Default: top 20 by `fitScore` that aren't already in `ai-reviews.json`. Reviews for jobs no longer in `jobs.json` are pruned automatically each run. CLI flags: `--top=N`, `--force` (re-review existing), `--ids=a,b,c` (specific ids).

**Prompt → JSON parsing.** The LLM occasionally wraps its JSON in markdown fences despite explicit instructions; [`src/ai-review-parse.ts`](./src/ai-review-parse.ts) strips them and falls back to safe defaults for missing/invalid fields rather than throwing — partial reviews are still useful. Tests in [`tests/ai-review-parse.test.ts`](./tests/ai-review-parse.test.ts) (9 cases) cover fenced JSON, invalid verdicts, missing fields, dirty arrays, and malformed input.

**Daily workflow:**
```bash
pnpm run daily       # = `pnpm run dev && pnpm run ai-review` — fetch + write data/jobs.json + ai-reviews.json
pnpm run ui          # browse with verdicts + score breakdowns inline
git add data/jobs.json data/feed.xml data/ai-reviews.json JOBS.md
git commit -m "chore: daily run + ai reviews"
```

`config/candidate-brief.md` ships with a starter that should be edited once and then left alone. It's the only natural-language config in the repo (everything else is JSON / TS).

## Pre-commit

`simple-git-hooks` is registered via the `prepare` lifecycle script. The hook runs:

```bash
pnpm run lint && pnpm run typecheck
```

Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` when you really need to land a WIP. Don't make a habit of it.

## Security checklist for new fetchers / parsers

- Use `fetchWithTimeout` from `utils.ts` (timeout + retry + abort built-in).
- Do not embed user-controllable strings in HTML attributes; use `escapeHtmlAttr` in `render.ts`.
- All scraped URLs flow through the filter's `isSafeUrl` gate — don't bypass it.
- All scraped bodies flow through `stripHtml` before any regex/scoring.
- New external HTTP endpoints get added to a tier-S slug list when applicable; ad-hoc URLs in code should be reviewed.

## Conventional commits

Use the conventional commits style:

- `feat:` new fetcher / filter rule / output section
- `fix(fetchers):` upstream URL change, parser bug
- `chore:` housekeeping, scaffolding
- `ci:` workflow changes
- `docs:` README/CLAUDE.md changes

## Known upstream issues (as of 2026-04)

- `cryptojobslist.com` is fully Cloudflare-challenged for HTML and the `api.cryptojobslist.com/jobs.rss` endpoint currently returns an empty channel. The fetcher gracefully returns `[]`; will pick up jobs again if upstream restores the feed.
- **All 5 web3 holdouts from the original spec are now covered.** `morpho`, `magiceden`, `li.fi` were on the public Ashby posting-API after all (added to `config/slugs.json#ashby`). `aave` is scraped via the Next.js `__NEXT_DATA__` blob on `aave.com/careers` (`src/fetchers/aave.ts`). `chainlink-labs` is scraped via Ashby's private `non-user-graphql` endpoint at `jobs.ashbyhq.com/api/non-user-graphql` (`src/fetchers/ashby-private.ts`, slug list in `config/slugs.json#ashbyPrivate`). The Greenhouse stale-slug list was reduced from 14 → 8 by removing the always-404 entries (aave, chainlink, morpho, lifi, magiceden, ledger). A 100-candidate sweep across web3 / AI / dev-tools tier-S companies turned up no other orgs using the Ashby-private pattern — chainlink-labs appears unique. The fetcher is config-driven anyway, so adding a future hit is a single-line edit.
- `web3.career` and `aijobs.net` (formerly `ai-jobs.net`) removed RSS — both are scraped from HTML via small inline regex parsers, which means a markup change upstream will silently break them. If a fetcher returns `0` for several days, eyeball the HTML for new selectors.
- `aijobs.net` is dominated by spam-aggregator listings (one posting cloned to 50 cities). The fetcher dedups by base ID via the `-idNNNNN-` slug pattern, which collapses an entire page down to 2–5 distinct postings. Don't be alarmed at the low kept count.
- `hn-jobs` routinely keeps 0–2 entries because YC company posts rarely match the senior+stack signal threshold. Filtering working as intended, not a bug.
