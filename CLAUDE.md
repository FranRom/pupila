# CLAUDE.md

Guidance for future Claude Code sessions working in this repo.

## Overview

`job-hunt` is a **config-driven, forkable** daily job aggregator. It fetches listings from 13 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS, JSON boards, Hacker News, HTML scrapers, an Aave Next.js scraper, and `ashby-private` for orgs whose public posting-API is disabled), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json`, an RSS feed at `data/feed.xml`, and an auto-regenerated `JOBS.md`. The hand-written `README.md` is **not** rewritten by the pipeline. No external services. No DB.

`config/profile.json` is **gitignored** — it encodes personal scoring preferences (sectors, stack, specialties to avoid) generated from the candidate brief. The first time `pnpm run dev` or `pnpm run ui` runs, the file is auto-bootstrapped from the committed `config/profile.default.json` (universal scaffolding + zeroed personal weights + empty personal keyword arrays). After onboarding (CV upload → brief generation), `/api/profile-generate` shells out to the local LLM CLI and overlays personal keyword lists + weights on top. Re-runnable from Settings → Scoring profile → Regenerate. `config/slugs.json` (separate file, committed) ships the full ~50-company tier-S list.

**First-run UX**: a forker generates `config/candidate-brief.md` via `pnpm run setup-brief --file ~/cv.pdf` (or via the UI's Profile tab → drop a PDF/DOCX/MD CV). The CLI shells out to whichever local LLM CLI is installed (`claude`, `codex`, `gemini`, `opencode` — auto-detected, override via `JOB_HUNT_LLM=<provider>`).

## Stack

- Node 22 LTS, ESM, TypeScript 5.9 (NodeNext)
- Biome 2.4 (lint + format, single config in `biome.json`)
- pnpm 11 (defaults to `minimumReleaseAge: 1d` and `strictDepBuilds: true` — supply-chain hardening)
- Vitest 3 (tests in `tests/`, 192 cases)
- simple-git-hooks (pre-commit `lint && typecheck`)
- Runtime deps: `fast-xml-parser` (RSS), `mammoth` + `pdfjs-dist` (CV parsing), `proper-lockfile` (apply-queue R-M-W lock). Native `fetch` only — no HTTP client lib.

## Run locally

```bash
pnpm install                # also installs the pre-commit hook
pnpm run dev                # tsx, no build step (this is what the launchd/cron aggregate agent runs)
pnpm start                  # built output (requires pnpm run build first)
pnpm run typecheck          # tsc --noEmit on src/, then on src/+tests/ via tsconfig.test.json
pnpm run lint[:fix]         # biome check [--write]
pnpm test                   # vitest run
pnpm run test:watch         # vitest watch
pnpm run ui                 # local-only Vite dev server on http://127.0.0.1:5173
pnpm run ai-review          # writes data/ai-reviews.json (flags: --top=N, --force, --ids=a,b)
pnpm run apply-worker       # standalone Tik Tjob queue consumer (separate terminal)
pnpm run setup-brief --file ~/cv.pdf  # generate config/candidate-brief.md from a CV
pnpm run daily              # = dev && ai-review (morning routine)
pnpm run clean [-- --all]   # wipe locally-generated artifacts (--all also wipes brief + applied)
```

**Mandatory CV gate.** `pnpm run dev` checks for `config/candidate-brief.md` at startup and exits 1 if missing. Bypass with `JOB_HUNT_NO_BRIEF_CHECK=1` or `--no-brief-check`.

**Profile auto-bootstrap.** Both `pnpm run dev` (via `ensureProfile()` in `src/index.ts`) and `pnpm run ui` (via the `profileApiPlugin` `configureServer` hook) call `bootstrapProfileIfMissing()` on startup, which `copyFile(... , COPYFILE_EXCL)`s `config/profile.default.json` → `config/profile.json` when the latter is missing. EEXIST is the steady-state no-op, so a personalized profile is never clobbered. The same call is repeated defensively inside `/api/profile-generate` in case the file gets removed mid-session.

**First-run onboarding.** When `config/preferences.json` is missing or has `onboardedAt: null`, opening the UI shows a 3-step wizard (`ui/src/Onboarding.tsx`): pick LLM CLI → drop CV → confirm brief. POSTs `/api/preferences` with provider + today's date as `onboardedAt` — once stamped, the wizard never re-triggers even if the brief is later removed.

**AI Apply (per-job).** UI rows have an `AI Apply ✨` button next to `Apply ↗`. POSTs `/api/ai-apply` with `{ jobId }` — runs the LLM CLI on (brief + posting + CV) and writes a tailored package to `data/applications/<jobId>.md`. Auto-marks as applied. Middleware: `aiApplyApiPlugin` in `ui/vite.config.ts`. The endpoint is a thin wrapper around `runAiApplyForJob` in `src/lib/ai-apply.ts` (same core used by the apply-worker — see below).

**Tik Tjob (swipe-to-apply).** A third tab in the UI. Right-swipe enqueues an AI Apply task; left-swipe records a persistent skip in `data/swipe-skips.json` so the card doesn't re-appear. Queued jobs are drained serially by a separate process — start it once per session with `pnpm run apply-worker` in another terminal. The Settings → panel [08] APPLY QUEUE shows worker liveness + per-row status + cancel. Architecture:

- `data/apply-queue.json` (gitignored, `{ version: 1, rows: QueueRow[] }`) — single source of truth, written by both Vite middleware (enqueue/cancel) and the worker (claim/done/failed). Concurrent R-M-W guarded by **proper-lockfile** (the project's second runtime dep) wrapped in `withQueueLock` (`src/lib/apply-queue.ts`).
- Queue row state machine: `queued → running → done|failed|cancelled`, plus `queued → cancelled` direct. UI cancel writes 'cancelled' to the row; the worker's sub-poll (`isCancelled` every 500ms while a job runs) translates that to an `AbortController.abort()`, which the LLM spawn handler escalates SIGTERM → 5s → SIGKILL. Partial output on cancel lands at `data/applications/<jobId>.cancelled.md` (separate filename — never masquerades as a finished package). No applied entry is written on cancel.
- `recoverOrphanedRunning()` runs on worker startup and re-flags pre-existing `running` rows as `failed` with reason `orphaned: worker crashed mid-run` (no automatic retry — user may have a partial cancelled file).
- Single-instance worker: PID file at `data/apply-worker.pid` (gitignored). On startup the worker `process.kill(pid, 0)`-checks the existing PID and exits if another instance is alive. Graceful SIGINT/SIGTERM clears the file; a second identical signal force-exits and leaves the file for the next startup to clean.
- Queue-row statuses are a SEPARATE domain from `ApplicationStatus` (applied/interview/offer/rejected/withdrawn). Don't merge them — `config/applied.json` and `data/apply-queue.json` are different files with different validators (`VALID_STATUSES` in `ui/plugins/_shared.ts` for the former, `VALID_QUEUE_STATUSES` in `src/lib/apply-queue.ts` for the latter).
- Defense-in-depth: every queue mutation entry point (POST `/enqueue`, DELETE `/:jobId`, POST `/:jobId/skip`) and `runAiApplyForJob` itself validate `jobId` against `/^[a-f0-9]{40}$/` (sha1 hex). Prevents path traversal via `data/applications/<jobId>.md` writes. Helper exported as `isValidJobId` from `src/lib/apply-queue.ts`.
- Endpoints (all in `ui/plugins/applyQueue.ts` under prefix `/api/apply-queue`): `GET /` → `{ rows, worker: { alive, pid, pidPath } }`; `POST /enqueue` `{ jobId }`; `DELETE /:jobId` (cancel); `POST /:jobId/skip`; `GET /skips` → `{ skips: string[] }`. Job body for the swipe card comes from `GET /api/job-body/:jobId` (sidecar `data/jobs-bodies.json` with `data/jobs.json` fallback).
- Worker polling: 1500ms interval, interruptible via signalPromise (graceful shutdown takes <1.5s).
- The Jobs-tab QueueBadge (`ui/src/jobs/QueueBadge.tsx`) renders `⏳ queued` / `⚙️ applying` next to title; terminal statuses render nothing (the existing applied marker covers `done`). Queue is polled at App root every 2.5s ONLY while the user is on the swipe or settings tab — the Jobs tab badge can go briefly stale (acceptable: cosmetic only, not load-bearing).

The pipeline writes `data/jobs.json` (slim — `body` stripped), `data/feed.xml`, `JOBS.md`, optionally `data/archive/<YYYY-MM>.json` on day 1 of the month, and per-source raw dumps in `data/raw/<source>-<YYYY-MM-DD>.json` (gitignored). **`README.md` is hand-maintained — never overwrite it from code.**

Pre-commit runs `lint && typecheck`. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

## Repo layout

```
src/
  index.ts          # orchestrator
  types.ts          # Job, Source, Category, ApplicationStatus, AppliedEntry, FetcherResult, Raw* shapes
  lib/apply-queue.ts # Tik Tjob queue mutators (enqueue/claim/markDone/cancel/recover) + proper-lockfile wrapper, VALID_QUEUE_STATUSES, isValidJobId
  lib/swipe-skips.ts # data/swipe-skips.json reader+writer (add/has/list)
  lib/ai-apply.ts    # extracted AI Apply core (prompt + spawn + write) — shared by /api/ai-apply and scripts/apply-worker.ts
  utils.ts          # fetchWithTimeout (1-retry), isSafeUrl, sha1, stripHtml, readJsonOrNull, ...
  rss.ts            # shared fast-xml-parser wrapper
  normalize.ts      # one normalize<Source> per source -> Job (uses withSalary())
  salary.ts         # parseSalary(): raw -> { min, max, currency } (annual integer, ISO code)
  filters.ts        # createFilters(profile) factory + applyFilters. Hard excludes + scoring + category + _signals
  applied.ts        # loads config/applied.json, attaches AppliedEntry to Job by URL hash
  dedup.ts          # 2-pass dedup, priority-aware tiebreak; exports compareJobs comparator
  render.ts         # JOBS.md markdown (applied, ✨ new, 🗑 removed, 🚨 source-health)
  feed.ts           # RSS 2.0 generator -> data/feed.xml (top 50 ✨ new jobs)
  setup-brief.ts    # CLI: parse CV (pdf/docx/md/txt) → LLM CLI → write config/candidate-brief.md
  lib/
    llm.ts            # detectLlmCli + runLlm — provider-agnostic shell-out
    cv-parser.ts      # parseCvBuffer/parseCvFile (pdfjs-dist, mammoth, raw text)
    brief-template.ts # readBriefBody/writeBriefBody — preserve preamble + markers
  fetchers/
    _shared.ts                           # fetchMultiSlug orchestration helper
    ashby.ts greenhouse.ts lever.ts      # ATS APIs (public, multi-slug)
    ashby-private.ts                     # multi-slug GraphQL for hidden Ashby orgs
    aave.ts                              # first-party scraper (Next.js __NEXT_DATA__)
    aijobsnet.ts cryptojobslist.ts web3career.ts  # boards / scrapers
    hn-hiring.ts hn-jobs.ts              # Hacker News
    remoteok.ts remotive.ts weworkremotely.ts

config/
  slugs.json                  # tier-S Ashby/Greenhouse/Lever slug arrays (committed)
  profile.default.json        # committed — neutral baseline auto-copied to profile.json on first run
  profile.json                # GITIGNORED — personal scoring weights + keyword lists, generated from brief
  candidate-brief.md          # GITIGNORED — LLM-generated CV summary
  candidate-brief.example.md  # committed template
  applied.json                # GITIGNORED — UI writes here via /api/applied
  applied.example.json        # committed template
  preferences.json            # GITIGNORED — { provider, onboardedAt }
  cv.{pdf,docx,md,txt}        # GITIGNORED — kept on disk so AI Apply can re-attach

scripts/
  install-launchd.sh # macOS local scheduler — wraps `pnpm run daily`
  install-cron.sh    # Linux local scheduler — appends a crontab entry
  apply-worker.ts    # standalone Node poll-loop worker for the Tik Tjob queue

tests/
  fixtures/test-profile.json  # frozen tuned profile for filters.test.ts
  filters.test.ts (33), dedup.test.ts (10), applied.test.ts (4), salary.test.ts (15),
  feed.test.ts (6), aave.test.ts (7), ashby-private.test.ts (9),
  ai-review-parse.test.ts (9), normalize-hn.test.ts (7), utils.test.ts (20)

ui/                 # local-only browser dashboard (Vite + React)
  index.html, vite.config.ts (root via fileURLToPath), tsconfig.json
  src/
    main.tsx        # ReactDOM.createRoot
    App.tsx         # filter + sort + table over data/jobs.json
    Onboarding.tsx, Settings.tsx, FetchProgress.tsx, SchedulerProgress.tsx, format.ts
    types.ts        # local copy of Job/Signals/AppliedEntry/AiReview
    styles.css      # CSS vars + dark mode via prefers-color-scheme

tsconfig.json       # rootDir=src/, strict NodeNext
tsconfig.test.json  # extends above with rootDir=. so tests/ typecheck without leaking into the build

.github/
  workflows/check.yml  # PR/push: lint + typecheck + test + build + audit (only workflow)
  dependabot.yml       # weekly grouped npm + github-actions PRs
```

> **CodeQL workflow removed.** Code Scanning isn't available on private repos without GitHub Advanced Security. Restore from commit `7397117` if the repo goes public.

## How to add a new fetcher

1. Add a Raw shape to `src/types.ts`.
2. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<FetcherResult<Raw>>` (`{ items, errors }`). **Never throw** — catch internally and push to `errors`.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `utils.ts` (30s timeout, 1 retry on 5xx/network).
   - Pass `JSON_HEADERS` or `RSS_HEADERS`.
   - For multi-slug fetchers, **use `fetchMultiSlug` from `_shared.ts`** — it owns the Promise.all + per-slug try/catch + flatMap. The fetcher only owns per-slug extraction. See `ashby.ts`, `greenhouse.ts`, `lever.ts`.
3. Add the literal source name to the `Source` union in `src/types.ts`.
4. Add `normalize<Name>(items, fetchedAt): Job[]` to `src/normalize.ts`.
5. Wire into `src/index.ts`: import + add a line to the `Promise.all` block via `processFetcher(...)`.
6. Add the source to `SOURCE_PRIORITY` in `src/dedup.ts` and `SOURCES` in `src/render.ts`.
7. Add at least one parser test in `tests/` for HTML scrapers.

Smoke-test before wiring:

```bash
npx tsx -e "import('./src/fetchers/<name>.ts').then(async m => { const r = await m.fetch<Name>(); console.log('count:', r.items.length, 'errors:', r.errors, 'first:', r.items[0]); })"
```

## How to add a tier-S company

All slug arrays live in `config/slugs.json` — non-code edit. Pick the right ATS:

| ATS | JSON key | URL pattern (find slug here) |
|---|---|---|
| Ashby | `ashby` | `jobs.ashbyhq.com/<slug>` |
| Greenhouse | `greenhouse` | `boards.greenhouse.io/<slug>` |
| Lever | `lever` | `jobs.lever.co/<slug>` |

The `TIER_S_*_SLUGS` exports in fetcher files are thin re-exports of the JSON.

Probe before adding:

```bash
curl -sI "https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"
curl -sI "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs"
curl -sI "https://api.lever.co/v0/postings/<slug>?mode=json"
```

404 slugs are logged and skipped silently — safe to leave a known-bad slug while waiting for upstream.

If a target isn't on any of the three big ATSes, it might be on Ashby's hosted-board GraphQL with the public API disabled — try `https://jobs.ashbyhq.com/<slug>` in a browser. If it loads, append the slug to `config/slugs.json#ashbyPrivate`. Genuine custom ATSes need a per-company HTML scraper; `src/fetchers/aave.ts` is the canonical Next.js `__NEXT_DATA__` example.

## Filter rules

All in `src/filters.ts`. **Weights and keyword lists load from `config/profile.json` at runtime via `loadProfile()`** (NOT a static import — the file is gitignored; on a fresh clone or after deletion, `src/index.ts`'s `ensureProfile()` auto-bootstraps it from `config/profile.default.json` before calling `createFilters(profile)`). `compileKw()` joins each list with `|` and wraps in `\b...\b/i`. Adjusting weights/keywords is non-code.

The hard-drop chain is a named-rule list (`HARD_RULES`). `applyFilters` runs `Array.find` over the rules, increments `droppedHard`, and tallies the rule name in `droppedByRule`. Breakdown surfaces in JOBS.md (e.g. `(missing_senior_req=812, ...)`). To add a rule: append a `{ name, test }` entry — no other plumbing.

Order of operations:

1. **Hard excludes** (drop entirely):
   - URL is not http/https (security gate via `isSafeUrl`)
   - Title contains junior/jr/intern/entry-level/associate/graduate/trainee/apprentice
   - Title lacks a senior_req keyword (senior/sr/staff/principal/lead/head/director/engineer(s)/developer(s)/architect(s))
   - Body matches a hard US-only/onsite pattern (uses **full body**, not the truncated scoring body)
   - Title or body matches a non-engineering pattern AND title lacks an engineering keyword
   - `TITLE_NON_ENG_COMPOUND`: customer support/success/sales/solutions engineer, devrel, field eng, business/sales/people ops, partner(ships) engineer, technical sourcer/recruiter, forward deployed/implementation/onboarding engineer, gtm
   - `TITLE_NON_ENG_LEADERSHIP`: VP, CMO, CRO, CFO, COO
   - `TITLE_NON_FRONTEND_ENG`: product security/data/devops/sre/infrastructure/platform/qa/network/firmware/embedded engineer (user is a frontend engineer)
   - `TITLE_NON_ENG_ROLE`: lead/manager for client/account/customer/business/product/operations/regional/country
   - `TITLE_NON_TECH_ROLE`: analyst, trader, scientist, researcher
2. **Body preparation.** `preparedScoringBody()` strips boilerplate (EEO, privacy, accommodations, "About us") and truncates to `scoringBodyMaxChars` (default 1500). Keyword scoring runs against this — prevents footer text like "we use Anthropic Claude internally" from landing a +20 AI signal on a backend role. Hard-drops still see the **full** body.
3. **Soft scoring** (additive, capped at `maxScore` = 100):
   - Web3 (+20 title/body, +20 stack) — binary
   - AI (+20 title/body, +20 stack) — binary
   - Stack (+10 React/Next/TS, +5 RN/Expo, +5 GraphQL/Tailwind/Vite) — **tiered**
   - Seniority (+15 lead/staff/principal/head, +10 senior/sr) — binary
   - Frontend title (+10 if title contains frontend/fullstack/web/mobile) — binary
   - Frontend body (+10 if body contains "design system" / "ship components" / "accessibility" etc.) — **tiered**
   - Location (+10 remote/EMEA/CET/Spain/anywhere) — binary
   - Freshness (+10 within 7d, +5 within 14d) — binary

   **Tiered weighting** via `tieredWeight(count, baseWeight)`: 0 = 0, 1 = `floor(base * 0.5)`, 2–3 = base, 4+ = `floor(base * 1.5)`. Implemented with global-flag regexes (`STACK_PRIMARY_G`, `STACK_RN_G`, `STACK_OTHER_G`, `BODY_FRONTEND_KW_G`) + `countMatches`. Other signals stay binary.
4. **Negative**: -10 if body hints US-centric without remote-worldwide language. Applied after capping.
5. **Drop** anything with `fitScore < minScoreToKeep` (default 30).
6. **Category**: `web3+ai` if both fired, else `web3`, `ai`, or `general`.

Adjust a weight: edit `config/profile.json#weights.<field>`. Add a keyword: edit `config/profile.json#keywords.<list>`. New signal types or hard-drop branches: edit `applyFilters` directly.

**Adding a new positive signal.** Append to `JobSignals` in `types.ts`, add weight to `config/profile.json#weights`, append one line to the `positives` object literal in `applyFilters`. Sum is via `Object.values(positives).reduce(...)` — auto-includes any new field.

### Debugging fitScore via `_signals`

Every kept job has a `_signals` object showing which scoring rules fired:

```jsonc
"_signals": {
  "web3TitleBody": 0, "web3Stack": 20, "aiTitleBody": 20, "aiStack": 20,
  "stackPrimary": 10, "stackRn": 0, "stackOther": 0,
  "leadTitle": 0, "seniorTitle": 10,
  "frontendTitle": 10, "frontendBody": 10, "locationRemote": 10,
  "freshness7d": 10, "freshness14d": 0, "usCentricPenalty": 0,
  "rawTotal": 110, "capped": true
}
```

Run `pnpm run dev`, then `jq '.[0]._signals' data/jobs.json`. `rawTotal` is the un-capped positive sum; `capped: true` means positives summed > 100 before clamping; `usCentricPenalty` is applied after capping.

## Application tracking

`config/applied.json` is the source of truth for jobs you've applied to. Hand-editable, but day-to-day written by the UI via dev-server middleware. Schema in `src/types.ts`:

```ts
type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
interface AppliedEntry { url: string; status: ApplicationStatus; date: string; notes?: string }
```

`src/applied.ts` exports `STATUS_EMOJI` (📝/💬/🎯/❌/⏸), `loadAppliedMap(path?)` (hashes URLs with the same identity as `Job.id`), and `summarizeApplied(entries)` (one-line header).

Wired in `src/index.ts` after dedup+sort: every kept job gets `job.applied = appliedMap.get(job.id)` when matched. `render.ts` then renders a "📋 Application status" section at the top of `JOBS.md` and prefixes title cells with the status emoji in every category section. **Don't filter applied jobs out of the main list** — user explicitly wants them visible (follow-up, dup comparison).

**Persistence.** UI edits go straight to disk; future `pnpm run dev` runs re-read it. No auto-commit (project is local-first). To preserve across machines, commit `config/applied.json` manually.

## Dedup

`src/dedup.ts`:
1. By `id` (sha1 of normalized URL).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

Tiebreak: highest `fitScore` wins; on ties, source priority. Order: aave = ashby-private > ashby > lever > greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok.

## Final sort (`compareJobs`)

Exported from `src/dedup.ts`, used by orchestrator post-dedup:

1. `fitScore` desc
2. `salaryMax` desc (`null` treated as 0 — unstated comp sinks below stated)
3. `postedAt` desc
4. `id` asc (deterministic tiebreak — stable day-over-day diffs)

## New-since / removed-since diff

Right before writing `data/jobs.json`, the orchestrator reads the **previous** copy via `readJsonOrNull` and computes:

- `newJobs = current − previous` → "✨ New since last run" (top 20 by `fitScore` desc, also drives `data/feed.xml`).
- `removedJobs = previous − current` → "🗑 Removed since last run" (top 10 by previous `fitScore`).

Both feed `RenderStats.newCount/removedCount` and `renderReadme(...)`. On first run (`previous === null`), diffs are empty — sections omitted entirely. **Don't change this** — prevents "all 900 jobs are new" on day one.

The read happens **after** filter+dedup+sort but **before** `writeJson`, so the new file overwrites cleanly.

## RSS feed

[`src/feed.ts`](./src/feed.ts) emits hand-rolled RSS 2.0 to `data/feed.xml` with the top 50 `newJobs` by `fitScore`. XML is hand-built (we control the shape); `escapeXml` covers the five entity classes. Metadata overridable via `JOB_HUNT_FEED_TITLE` / `JOB_HUNT_FEED_DESC` / `JOB_HUNT_FEED_LINK`. Subscribe locally via `file://` path.

## Salary parsing

[`src/salary.ts`](./src/salary.ts) `parseSalary(raw)` returns `{ min, max, currency }` normalized to **annual integers**. Handles `$120K-$180K`, `€80,000 - €110,000`, `100K-150K USD`, hourly via 2080-hour annualization, M-suffixed, single values, currency code/symbol detection. Rejects sub-$1000 amounts. Returns `{ null, null, null }` for free-text. Hooked into `normalize.ts` via `withSalary()` spread.

`Job.salary` (raw, for display) and `Job.salaryMin/salaryMax/salaryCurrency` (parsed) are both populated.

## Source-health alarms

`src/render.ts` flags fetchers with `fetched === 0` OR `errors > 0` in the current run: 🚨 banner above Stats, 🚨 prefix in by-source list. Single-run signal — no historical tracking. Catches silent breakage (web3career and aijobsnet markup changes have hit us before). A legitimately quiet source (e.g. cryptojobslist with upstream down) will alarm — that's still useful surfacing.

## GitHub Actions

One workflow only — project moved to local-first scheduling.

- **`.github/workflows/check.yml`** — every push to `main` and PR. Six gates: Biome lint, typecheck (3 tsconfigs), Vitest, `tsc` build, Vite UI build, `pnpm audit`. `permissions: contents: read`.

The previous `jobs.yml` (cron) and `keepalive.yml` were removed. Daily aggregation now runs locally via `scripts/install-launchd.sh` (macOS) or `scripts/install-cron.sh` (Linux), installing two agents: `pnpm run dev` and `pnpm run ai-review`.

`.github/dependabot.yml` opens weekly grouped PRs.

**Pinning.** All third-party actions referenced by full 40-char SHA with version in trailing comment. Update both when bumping. Dependabot keeps these current.

## Tests

Vitest, 120 cases across 10 files in `tests/` (`*.test.ts` glob). Run via `pnpm test` or `pnpm run test:watch`. Coverage spans: `utils` (URL safety, sha1, time math, formatters), `normalize-hn` (header parsing, plausible-company guard), `filters` (every hard-drop branch, scoring signals, tiered weighting, boilerplate stripping), `dedup` (id/title collapse, source priority, `compareJobs` 4-key chain), `applied` (`STATUS_EMOJI`, `summarizeApplied` ordering), `salary` (K/M suffix, currency detection, hourly→annual, free-text fallback), `feed` (RSS skeleton, escaping, sort, 50-cap), `aave` (`__NEXT_DATA__` extraction + normalize), `ashby-private` (GraphQL parsers + slug-to-company), `ai-review-parse` (markdown-fence stripping, invalid verdicts, dirty arrays).

When tuning a regex or weight, update tests in the same commit.

`tsconfig.test.json` extends `tsconfig.json` with `rootDir: "."` and `include: ["src/**/*", "tests/**/*"]`. `pnpm typecheck` runs both: production `tsconfig.json` first (catch issues that would block compilation), then `tsconfig.test.json` so tests don't leak into the build's `rootDir`.

## Local UI (`pnpm run ui`)

Vite + React 19 dashboard at `ui/` that fetches `data/jobs.json` and `data/ai-reviews.json` from `/api/jobs` and `/api/reviews` (Vite middleware in `ui/vite.config.ts`) — those files are gitignored, so static imports would force them to exist at build time. **Local-only — no auth, no hosting, intentionally not exposed beyond `127.0.0.1:5173`** (user explicitly chose this over public Pages — a public dashboard surfacing applied-job statuses could be Google-indexed and visible to recruiters). **Don't add a `pnpm run ui:deploy`** without explicit instruction.

Single-component MVP (no router, no state-management lib): filter chips for category/source/applied, search, sortable columns (score/salaryMax/postedAt), dark mode via `prefers-color-scheme`. Score cells tier-colored (green ≥80, gold 50-79, muted <50). Long company/title cells are 2-line clamped via `display: -webkit-box` on a `<span>` wrapper inside the `<td>` — applying directly on `<td>` breaks table-cell layout.

**Expandable rows.** Clicking a row opens a 3-column detail panel: AI take (when `data/ai-reviews.json` has an entry), `_signals` breakdown, meta (location/tags/posted/id). The Apply link uses `e.stopPropagation()`. Verdict badge (`strong-match`/`match`/`weak-match`/`skip`) appears next to title when an AI review exists.

**Group by company (default on).** Folds by lower-cased `company`. Single-job groups render flat; multi-job groups get a collapsible header with top score + role count + top-role preview. Active sort key drives both within-group and inter-group order.

**URL-encoded state.** All filter/sort/group/expand state syncs to `window.location.search` via `history.replaceState` (no back-button spam). Keys: `q`, `cat`, `src`, `applied=1`, `sort`, `dir=asc`, `group=0` (only when off), `expanded=<jobId>`, `co=<lowercased-company>`. Defaults omitted. Read URL once via `useMemo` lazy init; single `useEffect` writes back. **Don't use `pushState`** — every keystroke would create history entry.

**Mark-as-applied from UI.** Detail panel has an "Applied" bar with status pills + notes input. Clicking a pill toggles; clicking active clears. Notes save on blur/Enter. Edits go through `appliedApiPlugin` (Vite middleware) — `GET/POST/DELETE /api/applied` reads/writes `config/applied.json` directly. Optimistic updates (rolls back on failure with banner). On mount, App fetches `/api/applied` and reconciles with baked-in `j.applied`. Middleware only runs under `pnpm run ui` — `ui:build` preview falls back to baked-in state. **User must `git add config/applied.json && git commit` manually** to persist across machines.

`ui/src/types.ts` is a deliberate copy of the relevant subset of `src/types.ts`. Pipeline strips `body` from persisted `data/jobs.json`, but **`_signals` is kept** for UI rendering. **Don't rewrite `ui/src/types.ts` to import from `src/types.ts`** — that pulls in `with { type: 'json' }` config imports that don't resolve in the browser.

HTML has `<meta name="robots" content="noindex,nofollow">` as belt-and-suspenders.

`pnpm run typecheck` runs all three TS configs: `tsconfig.json`, `tsconfig.test.json`, `ui/tsconfig.json`.

### Settings tab

Settings is now the FOURTH tab (Jobs / Tik Tjob / Profile / Settings — `ui/src/Settings.tsx`). Eight numbered panels (`[01]`..`[08]`, last is `[08] APPLY QUEUE`) — terminal-grade aesthetic. All backed by Vite middleware in `ui/vite.config.ts`:

1. **LLM CLI** — switch provider (POST `/api/preferences`) + "Test connection" (POST `/api/llm-test`, 6-token prompt, 30s timeout, latency badge: green ≤3s/yellow ≤10s/red >10s).
2. **Scheduler** — full lifecycle. GET `/api/scheduler-status` (`launchctl list` on darwin, `crontab -l` on linux) detects `dev.${USER}.job-hunt.aggregate`/`.review` + log mtimes for "last run X ago". POST `/api/scheduler-install` (body `{ skipReview }`) and `/api/scheduler-uninstall` shell out to bundled scripts. Both gated by in-app confirm modal. `<SchedulerProgress />` streams stdout; on completion pills auto-refresh. Single in-flight op enforced server-side.
3. **Last run** — GET `/api/run-summary` parses `data/jobs.json` for total kept, by-category, per-source kept counts. Sources with `kept === 0` get 🚨. `generatedAt` from `max(job.fetchedAt)` with mtime fallback; `ageHours >= 24` shows "stale".
4. **Disk usage** — GET `/api/disk-usage` walks `data/raw`, `data/applications`, `data/archive` (depth cap 4), returns `{ bytes, files }` per bucket. Proportional bars.
5. **Maintenance** — three buttons POSTing `/api/clean` with `mode: 'default'|'all'|'onboarding'`. Each opens a styled confirm modal (Esc + click-outside dismissable). On success, panel auto-refreshes scheduler/run-summary/disk. Endpoint serializes runs (409 on conflict) and shells out to `pnpm exec tsx scripts/clean.ts` so CLI and UI share logic.
6. **Environment** — GET `/api/env` returns `{ node, platform, repoRoot, briefPresent, cvPresent, providers, preferredProvider }`. "Refresh all" re-fetches every panel.
7. **Apply queue [08]** — GET `/api/apply-queue` returns `{ rows, worker: { alive, pid, pidPath } }`. Renders worker-liveness banner with copy-paste `pnpm run apply-worker` snippet when the PID-check fails, counts row, filter chips (all/active/done/failed), per-row cancel button. Cancel sends DELETE `/api/apply-queue/:jobId`; 200 on ok, 404 on not-found, 409 on terminal. Polled by App root every 2.5s while swipe or settings tab is visible (no poll on Jobs or Profile tabs).

**Long-running ops UX.** `/api/fetch-jobs` and `/api/scheduler-install` (+uninstall) both follow: POST starts → GET polls → in-memory state with single concurrent-run lock. UI renders a docked card via `FetchProgress.tsx` / `SchedulerProgress.tsx` (shared `.fetch-progress*` CSS). When both could appear simultaneously, scheduler dock stacks above via `.fetch-progress-scheduler { bottom: calc(1rem + 360px); }`.

**Shared helpers.** `relativeTime` and `formatBytes` live in `ui/src/format.ts`, used by App/Settings/FetchProgress/SchedulerProgress. The previous inline `relativeTime` in `App.tsx` was extracted; granularity now reports `Nm ago`/`Nh ago` for sub-day diffs (deliberate improvement for Settings last-run case).

### Async style

`useEffect` callbacks can't themselves be `async` (they must return a cleanup function, not a Promise). Inside an effect, declare a named async arrow assigned to `const`, pass an `AbortController` signal to every `fetch`, and abort on cleanup:

```ts
useEffect(() => {
  const ctrl = new AbortController();
  const load = async () => {
    try {
      const r = await fetch('/api/foo', { signal: ctrl.signal });
      if (!r.ok) return;
      const data = (await r.json()) as Foo;
      setFoo(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // handle other errors
    }
  };
  void load();
  return () => ctrl.abort();
}, [deps]);
```

Same pattern for polling effects — replace the `cancelled` flag with the controller; the cleanup calls both `clearInterval` and `ctrl.abort()`. See `FetchProgress.tsx` (`tick`) and `AiApplyProgress.tsx` for the polling shape, `Onboarding.tsx` (`load`) for the one-shot shape. Use arrow-assigned-`const`, not `async function` declarations — keeps the style uniform with the rest of the UI's `useCallback` / `useMemo` patterns.

For `useCallback`/event handlers (`triggerFetch`, `setApplied`, etc.), use plain `async`/`await` directly — no controller unless the operation is long-running and should be cancellable on unmount. When a `useCallback` is *also* called from a `useEffect`, accept an optional `signal?: AbortSignal` parameter so the effect can plumb cancellation through (`reloadJobsAndReviews`, `refreshApplyQueue`, `loadAll` follow this).

No `.then`-chain `useEffect`s; no `let cancelled = false` flags. If you find either pattern, it's pre-convention and should be refactored.

## AI per-job review (`pnpm run ai-review`)

[`src/ai-review.ts`](./src/ai-review.ts) is a **local-only** companion that augments selected jobs with an LLM review via `src/lib/llm.ts` (auto-detects `claude`/`codex`/`gemini`/`opencode`, override `JOB_HUNT_LLM`). Uses the user's local subscription (e.g. Claude Max) — **not** an API key, so no per-token charges. The launchd/cron review agent runs daily at 07:15 by default. Without an LLM CLI, run `scripts/install-launchd.sh --no-review` (or cron equivalent).

**Inputs:** `data/jobs.json` (slim list), `data/jobs-bodies.json` (sidecar with full bodies, regenerated by `pnpm run dev`), `data/ai-reviews.json` (existing reviews), `config/candidate-brief.md` (hand-edited natural-language description of who the candidate is and what they're avoiding — embedded verbatim; main lever for tuning match/skip).

**Output:** `data/ai-reviews.json` as `Record<jobId, AiReview>`. Each carries one-sentence summary, 3 bullets each for `wants`/`offers`/`redFlags`, verdict (`strong-match | match | weak-match | skip`), and one-sentence `reason`. Writes after every successful review — a Ctrl-C or rate-limit kill leaves a partial-but-valid file.

**Selection.** Default: top 20 by `fitScore` not already reviewed. Reviews for jobs no longer in `jobs.json` are pruned each run. Flags: `--top=N`, `--force`, `--ids=a,b,c`.

**JSON parsing.** LLM occasionally wraps JSON in markdown fences; [`src/ai-review-parse.ts`](./src/ai-review-parse.ts) strips them and falls back to safe defaults rather than throwing — partial reviews are still useful.

**Daily workflow:**
```bash
pnpm run daily       # = `pnpm run dev && pnpm run ai-review`
pnpm run ui          # browse with verdicts + score breakdowns inline
git add data/jobs.json data/feed.xml data/ai-reviews.json JOBS.md
git commit -m "chore: daily run + ai reviews"
```

`config/candidate-brief.md` is the only natural-language config in the repo (everything else is JSON/TS).

## Pre-commit

`simple-git-hooks` registered via the `prepare` lifecycle script. Runs `pnpm run lint && pnpm run typecheck`. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for emergency WIP. Don't make a habit of it.

## Security checklist for new fetchers / parsers

- Use `fetchWithTimeout` from `utils.ts` (timeout + retry + abort built-in).
- Don't embed user-controllable strings in HTML attributes; use `escapeHtmlAttr` in `render.ts`.
- All scraped URLs flow through filter's `isSafeUrl` gate — don't bypass.
- All scraped bodies flow through `stripHtml` before any regex/scoring.
- New external HTTP endpoints get added to a tier-S slug list when applicable.

## Conventional commits

- `feat:` new fetcher / filter rule / output section
- `fix(fetchers):` upstream URL change, parser bug
- `chore:` housekeeping
- `ci:` workflow changes
- `docs:` README/CLAUDE.md changes

## Known upstream issues (as of 2026-04)

- `cryptojobslist.com` is fully Cloudflare-challenged for HTML; the `api.cryptojobslist.com/jobs.rss` endpoint returns an empty channel. Fetcher returns `[]`; will pick up jobs again if upstream restores the feed.
- **All 5 web3 holdouts now covered.** `morpho`, `magiceden`, `li.fi` were on public Ashby (added to `config/slugs.json#ashby`). `aave` scraped via Next.js `__NEXT_DATA__` (`src/fetchers/aave.ts`). `chainlink-labs` via Ashby's private `non-user-graphql` endpoint (`src/fetchers/ashby-private.ts`, slug list in `config/slugs.json#ashbyPrivate`). The Greenhouse stale-slug list was reduced 14 → 8. A 100-candidate sweep across web3/AI/dev-tools tier-S companies turned up no other Ashby-private orgs — chainlink-labs appears unique. The fetcher is config-driven anyway.
- `web3.career` and `aijobs.net` (formerly `ai-jobs.net`) removed RSS — both scraped from HTML via small inline regex parsers; markup changes upstream silently break them. If a fetcher returns 0 for several days, eyeball the HTML for new selectors.
- `aijobs.net` is dominated by spam-aggregator listings (one posting cloned to 50 cities). Fetcher dedups by base ID via `-idNNNNN-` slug pattern. Don't be alarmed at low kept count.
- `hn-jobs` routinely keeps 0–2 entries because YC company posts rarely match senior+stack signal threshold. Working as intended.
