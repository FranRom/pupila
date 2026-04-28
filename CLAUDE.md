# CLAUDE.md

Guidance for future Claude Code sessions working in this repo.

## Overview

`job-hunt` is a personal job aggregator that runs daily on GitHub Actions. It fetches listings from 9 public sources (RSS, JSON APIs, and lightweight HTML scrapers), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json` + an auto-regenerated `JOBS.md` table. The hand-written `README.md` is the project doc and is **not** rewritten by the pipeline. No external services. No DB. Output lives in this repo.

The pipeline is tuned for: senior/lead/staff frontend, web3 (EVM + Solana), and AI engineering roles, remote / EMEA / worldwide.

## Stack

- Node 22 LTS, ESM, TypeScript 5.9 (NodeNext)
- Biome 2.4 (lint + format, single config in `biome.json`)
- pnpm 10
- Single runtime dep: `fast-xml-parser`. Native `fetch` only.

## Run locally

```bash
pnpm install
pnpm run dev          # tsx, no build step
pnpm start            # built output: requires pnpm run build first
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # biome check
pnpm run lint:fix     # biome check --write
```

The pipeline writes to `data/jobs.json`, `JOBS.md`, and per-source raw dumps in `data/raw/<source>-<YYYY-MM-DD>.json` (gitignored). `README.md` is hand-maintained — never overwrite it from code.

## Repo layout

```
src/
  index.ts          # orchestrator
  types.ts          # Job, Source, Category, per-source Raw* shapes
  utils.ts          # fetchWithTimeout, sha1, stripHtml, normalizeUrl, ...
  rss.ts            # shared fast-xml-parser wrapper
  normalize.ts      # one normalize<Source> per source -> Job
  filters.ts        # hard excludes + scoring + category
  dedup.ts          # 2-pass dedup, priority-aware tiebreak
  render.ts         # JOBS.md markdown generator
  fetchers/
    aijobsnet.ts        cryptojobslist.ts   greenhouse.ts
    hn-hiring.ts        hn-jobs.ts          remoteok.ts
    remotive.ts         web3career.ts       weworkremotely.ts

.github/workflows/
  jobs.yml          # daily cron + auto-commit
  keepalive.yml     # weekly cron to keep schedules alive
```

## How to add a new fetcher

1. Add a Raw shape to `src/types.ts` (e.g. `RawFooBoard`).
2. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<Raw[]>`.
   - Catch all errors internally; return `[]` on failure.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `utils.ts` with a 30s default.
   - Pass `JSON_HEADERS` or `RSS_HEADERS` so the request looks like a real browser.
3. Add the literal source name to the `Source` union in `src/types.ts`.
4. Add a normalizer to `src/normalize.ts`: `normalize<Name>(items, fetchedAt): Job[]`.
5. Wire it into `src/index.ts`:
   - Import `fetch<Name>` and `normalize<Name>`.
   - Add a line to the `Promise.all` block: `processFetcher('<source>', fetch<Name>, normalize<Name>, fetchedAt, today)`.
6. Add the new source to `SOURCE_PRIORITY` in `src/dedup.ts` and to the `SOURCES` list in `src/render.ts`.

Smoke-test locally before wiring it into `index.ts`:

```bash
npx tsx -e "import('./src/fetchers/<name>.ts').then(async m => { const r = await m.fetch<Name>(); console.log('count:', r.length, 'first:', r[0]); })"
```

## How to add a new tier-S Greenhouse company

Edit `TIER_S_SLUGS` in `src/fetchers/greenhouse.ts`. The slug is the path segment in `boards-api.greenhouse.io/v1/boards/<slug>/jobs`. Slugs that 404 are logged and skipped silently — many companies use Lever/Ashby/Workable instead.

## Filter rules

All in `src/filters.ts`. Applied in this order:

1. **Hard excludes** (drop entirely)
   - Title contains junior/jr/intern/entry-level/associate/graduate/trainee/apprentice
   - Title does NOT contain a senior_req keyword (senior/sr/staff/principal/lead/head/director/engineer(s)/developer(s)/architect(s))
   - Body matches a hard US-only/onsite pattern
   - Title or body matches a non-engineering pattern AND title lacks an engineering keyword
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

To adjust weights, find the relevant `score += N` line in `applyFilters`. Keep regexes word-bounded and case-insensitive.

## Dedup

In `src/dedup.ts`:
1. By `id` (sha1 of normalized URL).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

Tiebreak: highest `fitScore` wins; on ties, the source with higher `SOURCE_PRIORITY` wins. Order: greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok.

## GitHub Actions

- `.github/workflows/jobs.yml` — `0 7 * * *` daily, plus `workflow_dispatch`. Runs the pipeline and auto-commits `data/jobs.json` + `JOBS.md` if anything changed.
- `.github/workflows/keepalive.yml` — `0 12 * * 0` weekly. Touches `.keepalive` so GitHub doesn't disable the schedule after 60 days of repo inactivity.

Both use `stefanzweifel/git-auto-commit-action@v5` and require `permissions: contents: write`.

To trigger a run manually: GitHub UI → Actions → jobs → Run workflow.

## Conventional commits

Use the conventional commits style:

- `feat:` new fetcher / filter rule / output section
- `fix(fetchers):` upstream URL change, parser bug
- `chore:` housekeeping, scaffolding
- `ci:` workflow changes
- `docs:` README/CLAUDE.md changes

## Known upstream issues (as of 2026-04)

- `cryptojobslist.com` is fully Cloudflare-challenged for HTML and the `api.cryptojobslist.com/jobs.rss` endpoint currently returns an empty channel. The fetcher gracefully returns `[]`; will pick up jobs again if upstream restores the feed.
- 10 of the 14 starter Greenhouse slugs (linear, ramp, uniswaplabs, aave, chainlink, morpho, lifi, mysten-labs, magiceden, ledger) are not on Greenhouse. Add a Lever/Ashby fetcher if you want their listings.
- `web3.career` and `aijobs.net` (formerly `ai-jobs.net`) removed RSS — both are scraped from HTML via small inline regex parsers, which means a markup change upstream will silently break them. If a fetcher returns `0` for several days, eyeball the HTML for new selectors.
