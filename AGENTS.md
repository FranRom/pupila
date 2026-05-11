# AGENTS.md

Operational guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repo. This file is the canonical agent-instructions file — `CLAUDE.md` is a thin redirect to here.

> **Deep technical content has its own homes.** This file stays short and focuses on what an agent needs to make safe edits. See:
> - [`docs/architecture.md`](./docs/architecture.md) — pipeline, filter rules, scoring, dedup, RSS, salary, source-health.
> - [`docs/ai-pipeline.md`](./docs/ai-pipeline.md) — LLM CLI abstraction, AI review, AI Apply.
> - [`README.md`](./README.md) — product docs for humans.
> - [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor workflow + project invariants.

## Overview

`job-hunt` is a config-driven, **local-first**, **forkable** daily job aggregator. It fetches listings from 13 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS feeds, JSON job boards, Hacker News, HTML scrapers, the Aave Next.js scraper, and `ashby-private` for orgs hosted on Ashby with the public posting-API disabled), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json`, an RSS feed at `data/feed.xml`, and an auto-regenerated `JOBS.md` table. No external services, no DB. Output lives in this repo.

Personalization is split across two files: `config/profile.json` (committed neutral defaults, regenerated from the candidate brief via `/api/profile-generate`) drives scoring weights + keyword lists; `config/candidate-brief.md` (gitignored, CV-derived) drives the per-job AI verdict.

## Stack

- Node 22 LTS, ESM, TypeScript 5.9 (NodeNext, strict)
- Biome 2.4 (lint + format)
- pnpm 10
- Vitest 3 (tests in `tests/`, run via `pnpm test`)
- simple-git-hooks (pre-commit: `lint && typecheck`)
- Single runtime dep: `fast-xml-parser`. Native `fetch` only.

## Run locally

```bash
pnpm install                          # also installs the pre-commit hook
pnpm run dev                          # tsx, no build step (what launchd/cron runs)
pnpm run typecheck                    # tsc --noEmit across 3 tsconfigs
pnpm run lint                         # biome check
pnpm test                             # vitest run
pnpm run ui                           # local-only UI on 127.0.0.1:5173
pnpm run ai-review                    # LLM-CLI per-job review → data/ai-reviews.json
pnpm run setup-brief --file ~/cv.pdf  # CV → candidate-brief.md via local LLM CLI
pnpm run daily                        # = dev && ai-review (morning routine)
```

**Mandatory CV gate.** `pnpm run dev` checks for `config/candidate-brief.md` and exits 1 if missing. Bypass with `JOB_HUNT_NO_BRIEF_CHECK=1` for raw-aggregator mode.

The pipeline writes to `data/jobs.json` (slim — `body` stripped), `data/feed.xml`, `JOBS.md`, optionally `data/archive/<YYYY-MM>.json` on day 1 of the month, and per-source raw dumps in `data/raw/` (gitignored). **Never overwrite `README.md` from code** — it's hand-maintained.

## Repo layout

```
src/
  index.ts          # orchestrator
  types.ts          # Job, Source, Category, ApplicationStatus, FetcherResult, Raw* shapes
  utils.ts          # fetchWithTimeout, isSafeUrl, sha1, stripHtml, readJsonOrNull
  normalize.ts      # one normalize<Source> per source → Job
  filters.ts        # createFilters(profile) + HARD_RULES + applyFilters
  dedup.ts          # 2-pass dedup + compareJobs comparator
  render.ts         # JOBS.md generator
  feed.ts           # RSS 2.0 → data/feed.xml
  salary.ts         # parseSalary(): raw → { min, max, currency }
  applied.ts        # attach AppliedEntry to Job by URL hash
  ai-review.ts      # local-only AI review companion (shells via lib/llm.ts)
  setup-brief.ts    # CLI: CV → LLM CLI → candidate-brief.md
  lib/
    llm.ts            # provider-agnostic LLM CLI shell-out (claude/codex/gemini/opencode)
    cv-parser.ts      # PDF/DOCX/MD parsing
    brief-template.ts # preserve preamble + markers
    profile-generator.ts # LLM-driven profile.json synthesis
  fetchers/
    _shared.ts        # fetchMultiSlug helper for ATS fetchers
    ashby.ts greenhouse.ts lever.ts           # ATS APIs (public, multi-slug)
    ashby-private.ts                          # GraphQL for hidden Ashby orgs
    aave.ts                                   # Next.js __NEXT_DATA__ scraper
    aijobsnet.ts cryptojobslist.ts web3career.ts
    hn-hiring.ts hn-jobs.ts
    remoteok.ts remotive.ts weworkremotely.ts

config/
  slugs.json                  # tier-S Ashby/Greenhouse/Lever slugs — committed, neutral defaults
  profile.json                # scoring weights + keyword lists — committed, neutral defaults
  candidate-brief.md          # GITIGNORED — LLM-generated CV summary
  applied.json                # GITIGNORED — application history (UI writes via /api/applied)
  preferences.json            # GITIGNORED — { provider, onboardedAt }
  cv.{pdf,docx,md,txt}        # GITIGNORED — raw CV file

scripts/
  install-launchd.sh # macOS scheduler (installs aggregate + review agents)
  install-cron.sh    # Linux scheduler

tests/                        # Vitest cases; run via `pnpm test`
ui/                           # local-only Vite + React 19 dashboard
.github/workflows/check.yml   # PR-gating: biome + typecheck + tests + build + audit
```

## How to add a new fetcher

1. Add a Raw shape to `src/types.ts` (e.g. `RawFooBoard`).
2. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<FetcherResult<Raw>>` — i.e. returning `{ items: Raw[]; errors: string[] }`. **Never throw.** Catch all errors internally, push them onto the `errors` array, and return.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `utils.ts` (30s timeout, 1 retry on 5xx/network).
   - Pass `JSON_HEADERS` or `RSS_HEADERS` so the request looks like a real browser.
   - For multi-slug/multi-page fetchers, **use `fetchMultiSlug` from `src/fetchers/_shared.ts`** — it handles the `Promise.all` + per-slug try/catch + flatMap aggregation. The fetcher only owns the per-slug extraction. See `ashby.ts`, `greenhouse.ts`, `lever.ts` for the canonical pattern.
3. Add the literal source name to the `Source` union in `src/types.ts`.
4. Add a normalizer to `src/normalize.ts`: `normalize<Name>(items, fetchedAt): Job[]`.
5. Wire it into `src/index.ts`'s `Promise.all` block: `processFetcher('<source>', fetch<Name>, normalize<Name>, fetchedAt, today)`.
6. Add the new source to `SOURCE_PRIORITY` in `src/dedup.ts` and to the `SOURCES` list in `src/render.ts`.
7. Add at least one test in `tests/` covering the parser if it's an HTML scraper.

Smoke-test locally before wiring into `index.ts`:

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

Probe before adding (each ATS exposes a public board endpoint that returns 200 + JSON if the slug is live):

```bash
curl -sI "https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"
curl -sI "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs"
curl -sI "https://api.lever.co/v0/postings/<slug>?mode=json"
```

Slugs that 404 are logged and skipped silently, so it's safe to leave a known-bad slug in the list while waiting for upstream to restore it.

If a target company isn't on any of the three big ATSes, it might still be on Ashby's hosted-board GraphQL even when the public posting-API returns 404 — try `https://jobs.ashbyhq.com/<slug>` in a browser; if that loads, append the slug to `config/slugs.json#ashbyPrivate` (the `ashby-private` fetcher will pick it up — no new code needed). Genuine custom ATSes (Webflow CMS, Next.js careers pages, etc.) need their own per-company HTML scraper — `src/fetchers/aave.ts` is the canonical example for Next.js `__NEXT_DATA__` extraction.

## Pre-commit

`simple-git-hooks` registered via the `prepare` lifecycle script runs `pnpm run lint && pnpm run typecheck` before every commit. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` only for genuine WIP emergencies.

## Security checklist for new fetchers / parsers

- Use `fetchWithTimeout` from `utils.ts` (timeout + retry + abort built-in).
- All scraped URLs flow through the filter's `isSafeUrl` gate — don't bypass it. Non-http(s) URLs are rejected as defense against `javascript:` / `data:` / `file:` payloads.
- All scraped bodies flow through `stripHtml` before any regex/scoring.
- Do not embed user-controllable strings in HTML attributes; use `escapeHtmlAttr` in `render.ts`.
- New external HTTP endpoints get added to a tier-S slug list when applicable; ad-hoc URLs in code should be reviewed.

## Conventional commits

| Prefix | Use for |
|---|---|
| `feat:` | new fetcher / filter rule / output section |
| `fix(fetchers):` | upstream URL change, parser bug |
| `fix(filters):` | scoring or hard-drop behavior |
| `chore:` | housekeeping, scaffolding, dependency bumps |
| `ci:` | workflow changes |
| `docs:` | README / AGENTS.md / CONTRIBUTING.md changes |
| `test:` | test-only changes |
