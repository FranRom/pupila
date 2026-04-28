# CLAUDE.md

Guidance for future Claude Code sessions working in this repo.

## Overview

`job-hunt` is a personal job aggregator that runs daily on GitHub Actions. It fetches listings from 11 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS feeds, JSON job boards, Hacker News, and HTML scrapers), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json` + an auto-regenerated `JOBS.md` table. The hand-written `README.md` is the project doc and is **not** rewritten by the pipeline. No external services. No DB. Output lives in this repo.

The pipeline is tuned for: senior/lead/staff frontend, web3 (EVM + Solana), and AI engineering roles, remote / EMEA / worldwide.

## Stack

- Node 22 LTS, ESM, TypeScript 5.9 (NodeNext)
- Biome 2.4 (lint + format, single config in `biome.json`)
- pnpm 10
- Vitest 3 (tests in `tests/`, run via `pnpm test`)
- simple-git-hooks (pre-commit `lint && typecheck`)
- Single runtime dep: `fast-xml-parser`. Native `fetch` only.

## Run locally

```bash
pnpm install                # also installs the pre-commit hook
pnpm run dev                # tsx, no build step (this is what CI runs too)
pnpm start                  # built output: requires pnpm run build first
pnpm run typecheck          # tsc --noEmit
pnpm run lint               # biome check
pnpm run lint:fix           # biome check --write
pnpm test                   # vitest run (41 unit tests)
pnpm run test:watch         # vitest watch mode
```

The pipeline writes to `data/jobs.json` (slim — `body` field stripped), `JOBS.md`, optionally `data/archive/<YYYY-MM>.json` on day 1 of the month, and per-source raw dumps in `data/raw/<source>-<YYYY-MM-DD>.json` (gitignored). `README.md` is hand-maintained — never overwrite it from code.

Pre-commit runs `lint && typecheck` automatically. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for emergency commits.

## Repo layout

```
src/
  index.ts          # orchestrator
  types.ts          # Job, Source, Category, FetcherResult, Raw* shapes
  utils.ts          # fetchWithTimeout (1-retry), isSafeUrl, sha1, stripHtml, ...
  rss.ts            # shared fast-xml-parser wrapper
  normalize.ts      # one normalize<Source> per source -> Job
  filters.ts        # hard excludes + scoring + category + _signals
  dedup.ts          # 2-pass dedup, priority-aware tiebreak
  render.ts         # JOBS.md markdown generator
  fetchers/
    ashby.ts            greenhouse.ts       lever.ts        # ATS APIs (largest signal)
    aijobsnet.ts        cryptojobslist.ts   web3career.ts   # boards / scrapers
    hn-hiring.ts        hn-jobs.ts                          # Hacker News
    remoteok.ts         remotive.ts         weworkremotely.ts

config/
  slugs.json        # tier-S Ashby/Greenhouse/Lever slug arrays

tests/
  filters.test.ts   # 19 cases — hard drops, scoring, plurals
  dedup.test.ts     # 5 cases — id/title collapse, priority
  utils.test.ts     # 17 cases — URL safety, stripHtml, time math

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
   - For multi-slug/multi-page fetchers, aggregate `errors` from each sub-call so partial failures are visible in stats.
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

If a target company isn't on any of the three big ATSes (Aave, Chainlink, Morpho, LiFi, Magic Eden are examples), it probably has a custom ATS — that's a new fetcher.

## Filter rules

All in `src/filters.ts`. Applied in this order:

1. **Hard excludes** (drop entirely)
   - URL is not http/https (security gate via `isSafeUrl`)
   - Title contains junior/jr/intern/entry-level/associate/graduate/trainee/apprentice
   - Title does NOT contain a senior_req keyword (senior/sr/staff/principal/lead/head/director/engineer(s)/developer(s)/architect(s))
   - Body matches a hard US-only/onsite pattern
   - Title or body matches a non-engineering pattern AND title lacks an engineering keyword
   - Title matches the **compound non-eng** regex (`TITLE_NON_ENG_COMPOUND`): customer support/success engineer, sales engineer, solutions engineer, developer relations/advocate/experience, devrel, field engineering/operations, business/sales/people operations, partner(ships) engineer, technical sourcer/recruiter, forward deployed/implementation/onboarding engineer, gtm, go-to-market. These titles contain the word "Engineer" but aren't real engineering — added because Vercel/Coinbase non-eng roles were scoring 100 and crowding the top of `JOBS.md`.
   - Title matches `TITLE_NON_ENG_LEADERSHIP`: VP/Vice President, CMO, CRO, CFO, COO.
2. **Soft scoring** (additive, capped at 100):
   - Web3 signals (+20 title/body, +20 stack)
   - AI signals (+20 title/body, +20 stack)
   - Stack signals (+10 React/Next/TS, +5 RN/Expo, +5 GraphQL/Tailwind/Vite)
   - Seniority (+15 lead/staff/principal/head, +10 senior/sr)
   - Location (+10 remote/EMEA/CET/Spain/anywhere)
   - Freshness (+10 within 7 days, +5 within 14 days)
3. **Negative**: -10 if body hints US-centric without remote-worldwide language. (No already-applied list.)
4. **Drop** anything with `fitScore < 30`.
5. **Category**: `web3+ai` if both web3 and AI signals fired, else `web3`, `ai`, or `general`.

To adjust weights, find the relevant assignment to `signals.<field>` in `applyFilters` — values are written into the `_signals` object first, then summed. Keep regexes word-bounded and case-insensitive.

### Debugging fitScore via `_signals`

Every kept job in `data/jobs.json` has a `_signals` object showing exactly which scoring rules fired:

```jsonc
"_signals": {
  "web3TitleBody": 0,    "web3Stack": 20,
  "aiTitleBody": 20,     "aiStack": 20,
  "stackPrimary": 10,    "stackRn": 0,    "stackOther": 0,
  "leadTitle": 0,        "seniorTitle": 10,
  "locationRemote": 10,
  "freshness7d": 10,     "freshness14d": 0,
  "usCentricPenalty": 0,
  "rawTotal": 100,       "capped": false
}
```

When tuning regexes, run `pnpm run dev`, then `jq '.[0]._signals' data/jobs.json` (or read it directly) to see the breakdown of the top job. `rawTotal` is the un-capped positive sum; `capped: true` means positives summed > 100 before clamping; `usCentricPenalty` is applied after capping.

## Dedup

In `src/dedup.ts`:
1. By `id` (sha1 of normalized URL).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

Tiebreak: highest `fitScore` wins; on ties, the source with higher `SOURCE_PRIORITY` wins. Order: ashby > lever > greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok.

## New-since-last-run diff

Right before writing the new `data/jobs.json`, the orchestrator reads the **previous** committed copy via `readJsonOrNull`, builds a `Set<string>` of its IDs, and computes `newJobs = kept.filter(j => !previousIds.has(j.id))`. That list:

- becomes the count in `RenderStats.newCount`,
- gets passed to `renderReadme(jobs, stats, newJobs)` as a separate parameter,
- is rendered as the **"✨ New since last run"** section at the top of `JOBS.md` (sorted by `fitScore` desc, top 20).

On the very first run (no previous file or unparseable file) `previous === null` and the diff is treated as empty (the section is omitted entirely). Don't change this — it prevents the first run from declaring "all 900 jobs are new" when there's no baseline.

The read happens **after** filter+dedup+sort but **before** `writeJson('data/jobs.json', ...)`, so the new file overwrites the old one cleanly.

## GitHub Actions

Three workflows total:

- **`.github/workflows/jobs.yml`** — `0 7 * * *` daily + `workflow_dispatch`. Runs `pnpm run dev` (no build step). Auto-commits `data/jobs.json`, the `data/archive` directory, and `JOBS.md` if anything changed. `permissions: contents: write`. The auto-commit pattern uses the `data/archive` directory (not a glob) because `data/archive/*.json` errors when no files match — keep `data/archive/.gitkeep` so the directory always exists.
- **`.github/workflows/check.yml`** — every push to `main` and every PR. Lint, typecheck, test, audit. `permissions: contents: read`.
- **`.github/workflows/keepalive.yml`** — `0 12 * * 0` weekly. Touches `.keepalive` so GitHub doesn't disable the daily schedule after 60 days of repo inactivity.

`.github/dependabot.yml` opens weekly grouped PRs for npm + github-actions.

**Pinning.** All third-party actions in every workflow are referenced by full 40-char commit SHA, not a floating `@v4` / `@v5` tag, with the version in a trailing comment. When updating an action, replace both the SHA and the comment. Dependabot will keep these current via PRs.

To trigger the daily run manually: `gh workflow run jobs.yml`.

## Tests

Vitest, ~41 cases in `tests/` with `*.test.ts` glob. Run via `pnpm test` (CI) or `pnpm run test:watch` (interactive).

- **`tests/utils.test.ts`** (17): `isSafeUrl` allowlist, `normalizeUrl` (utm strip, scheme reject), `stripHtml`, `normalizeText`, `sha1Hex`, `relativeTime`, `withinDays`.
- **`tests/filters.test.ts`** (19): every hard-drop branch (junior, senior_req, US-only, compound non-eng, exec, URL scheme), every score signal, category derivation, score capping with `_signals.capped`, US-centric penalty, plural title acceptance.
- **`tests/dedup.test.ts`** (5): id collapse, normalized company+title collapse, fitScore tiebreak, source priority tiebreak (`ashby > greenhouse > remoteok`, `lever > web3career`), empty input.

When tuning a filter regex or scoring weight, update the test in the same commit. The `check.yml` workflow runs the full suite on every PR.

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
- The original spec listed 10 Greenhouse slugs that aren't actually on Greenhouse (linear, ramp, uniswaplabs, aave, chainlink, morpho, lifi, mysten-labs, magiceden, ledger). **Most are now recovered:** Linear, Ramp, Uniswap, Mysten Labs are in `TIER_S_ASHBY_SLUGS`; Ledger is in `TIER_S_LEVER_SLUGS`. The remaining holdouts (`aave`, `chainlink`, `morpho`, `lifi`, `magiceden`) use custom ATSes — would need per-company HTML scrapers.
- `web3.career` and `aijobs.net` (formerly `ai-jobs.net`) removed RSS — both are scraped from HTML via small inline regex parsers, which means a markup change upstream will silently break them. If a fetcher returns `0` for several days, eyeball the HTML for new selectors.
- `aijobs.net` is dominated by spam-aggregator listings (one posting cloned to 50 cities). The fetcher dedups by base ID via the `-idNNNNN-` slug pattern, which collapses an entire page down to 2–5 distinct postings. Don't be alarmed at the low kept count.
- `hn-jobs` routinely keeps 0–2 entries because YC company posts rarely match the senior+stack signal threshold. Filtering working as intended, not a bug.
