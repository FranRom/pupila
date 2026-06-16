# CLAUDE.md

Guidance for future Claude Code sessions working in this repo. **Slim by design** — this file is loaded every turn. Subsystem details live next to the code that needs them; procedural how-tos live in skills.

## Where things live

| Topic | Source |
|---|---|
| Adding a fetcher / tier-S slug | `pupila-fetchers` skill |
| Tuning filter weights / debugging `_signals` | `pupila-filters` skill |
| AI review + AI Apply pipelines | `pupila-ai-review` skill |
| UI patterns (CSS modules, `lib/api/`, hooks, perf) | `ui/CLAUDE.md` (auto-loaded in `ui/`) |
| MCP server invariants + add-a-tool recipe | `src/mcp/CLAUDE.md` (auto-loaded in `src/mcp/`) |
| Fetcher security checklist | `src/fetchers/CLAUDE.md` (auto-loaded in `src/fetchers/`) |

## Overview

`pupila` is a **config-driven, forkable** daily job aggregator. Fetches from 15 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS, JSON boards, Hacker News, HTML scrapers, an Aave Next.js scraper, `ashby-private` for orgs whose public posting-API is disabled, and `bluedoor` — a free aggregator over ~1.6M postings/31 ATS, queried by `profile.location`), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json`, an RSS feed at `data/feed.xml`, and an auto-regenerated `JOBS.md`. **`README.md` is hand-maintained — never overwrite it from code.** No external services, no DB.

Cross-cutting invariants (apply repo-wide):

- **`config/profile.json` is gitignored** — encodes personal scoring preferences. Auto-bootstraps from committed `config/profile.default.json` on first `pnpm run dev` / `pnpm run ui` via `bootstrapProfileIfMissing()` (idempotent — `COPYFILE_EXCL` no-ops on the steady state). Don't bypass; don't commit personalized weights.
- **Mandatory CV gate**: `pnpm run dev` checks for `config/candidate-brief.md` at startup and exits 1 if missing. Bypass with `PUPILA_NO_BRIEF_CHECK=1` or `--no-brief-check`.
- **`config/candidate-brief.md` is the only natural-language config** (gitignored). Generated via `pnpm run setup-brief --file ~/cv.pdf` or via the UI's Profile tab (drop PDF/DOCX/MD CV). CLI shells out to `claude`/`codex`/`gemini`/`opencode` — auto-detected, override `PUPILA_LLM=<provider>`.
- **Local-first scheduling**: daily aggregation runs via `scripts/install-launchd.sh` (macOS) or `scripts/install-cron.sh` (Linux), not GitHub Actions cron. CI runs only on push/PR for gates.
- **`config/slugs.local.json` is gitignored** — a personal overlay of per-ATS company-slug add/removes layered on the committed `config/slugs.json` baseline (effective list = shipped ∪ add − remove, resolved at fetch time in `src/lib/slugs.ts`). Written only by the UI's Settings → Job sources panel (`/api/sources`); **never write `config/slugs.json` from app code.** See the `pupila-fetchers` skill.
- **`config/applied.json` source of truth** for application tracking (gitignored personal data; the UI writes it via Vite middleware). It's your private application history, so it's NOT committed (that would leak it to anyone cloning the repo); copy the file if you need it on another machine. **Don't filter applied jobs out of the main list**: the user wants them visible.

## Stack

| Component | Choice |
|---|---|
| Runtime / language | Node 22 LTS, ESM, TypeScript 6 (NodeNext) |
| Linter / formatter | Biome 2.4 (single config in `biome.json`) |
| Package manager | pnpm 11 (`minimumReleaseAge: 1d`, `strictDepBuilds: true` — supply-chain hardening) |
| Test runner | Vitest 4 (`tests/`, `*.test.ts` glob) |
| Pre-commit | simple-git-hooks (`lint && typecheck && lint:ui-patterns`) |
| Runtime deps | `fast-xml-parser` (RSS), `mammoth` + `pdfjs-dist` (CV parsing), `proper-lockfile` (apply-queue R-M-W lock). Native `fetch` only — no HTTP client lib. |

## Run locally

```bash
pnpm install                          # also installs the pre-commit hook
pnpm run dev                          # orchestrator (tsx, no build step) — what launchd/cron runs
pnpm start                            # built output (requires pnpm run build)
pnpm run typecheck                    # tsc --noEmit on src/, then src/+tests/ via tsconfig.test.json
pnpm run lint[:fix]                   # biome check [--write]
pnpm test                             # vitest run
pnpm run test:watch                   # vitest watch
pnpm run ui                           # local-only Vite dev server on 127.0.0.1:5173
pnpm run ai-review                    # writes data/ai-reviews.json (--top=N, --force, --ids=a,b)
pnpm run apply-worker                 # Jinder queue consumer (separate terminal)
pnpm run setup-brief --file ~/cv.pdf  # generate config/candidate-brief.md from a CV
pnpm run daily                        # = dev && ai-review (morning routine)
pnpm run clean                        # wipe locally-generated artifacts (keeps brief/applied/profile)
pnpm run clean:all                    # fresh-clone reset: also wipes brief, applied.json, profile.json, onboarding
pnpm run mcp                          # MCP server over stdio
```

## Repo layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Orchestrator — fetch + filter + score + dedup + render + write |
| `src/types.ts` | `Job`, `Source`, `ApplicationStatus`, `FetcherResult`, ... |
| `src/fetchers/` | One fetcher per source (see `src/fetchers/CLAUDE.md`) |
| `src/mcp/` | MCP server, 17 tools (see `src/mcp/CLAUDE.md`) |
| `src/lib/` | `apply-queue`, `swipe-skips`, `ai-apply`, `llm`, `cv-parser`, `fetch-runner` |
| `src/{filters,salary,dedup,applied,render,feed,normalize}.ts` | Pipeline stages |
| `src/utils.ts` | `fetchWithTimeout`, `isSafeUrl`, `sha1`, `stripHtml`, `readJsonOrNull` |
| `src/rss.ts` | `fast-xml-parser` wrapper |
| `src/{ai-review,ai-review-parse,setup-brief}.ts` | AI review CLI + parsing + CV→brief |
| `config/` | `slugs.json`, `profile.{default,}.json`, `applied.json`, brief, preferences |
| `ui/` | Local-only React dashboard (see `ui/CLAUDE.md`) |
| `scripts/` | Apply worker, installers (launchd/cron/mcp), clean |
| `tests/` | vitest cases, fixtures in `tests/fixtures/` |
| `.claude/skills/` | Project skills (`pupila-*`) ship; provider-generic skills are local-only |

## Orchestrator flow

`pnpm run dev` → `tsx src/index.ts` is the main pipeline (what launchd/cron runs). Steps:

1. **CV gate** — fail-fast if `config/candidate-brief.md` missing (bypass: `PUPILA_NO_BRIEF_CHECK=1` or `--no-brief-check`).
2. **Profile bootstrap** — `bootstrapProfileIfMissing()` copies `config/profile.default.json` → `profile.json` on first run.
3. **Fetch** — all 15 sources in parallel via `processFetcher()` + `Promise.all`. Each fetcher returns `{ items, errors }` and **never throws** (a rejection would kill the whole run).
4. **Normalize** — per-source `normalize<Source>()` → `Job[]`. Salary fields populated via `withSalary()` spread.
5. **Filter + score** — `applyFilters()` in `src/filters.ts`: hard drops → boilerplate strip → soft scoring (cap 100) → optional out-of-region penalty → drop below `minScoreToKeep` → multi-label categories. Geo handling is persona-neutral, driven by the `location` block in `config/profile.json` (see `pupila-filters` skill).
6. **Dedup + sort** — `compareJobs` 4-key chain in `src/dedup.ts` (source-priority tiebreak).
7. **Attach applied state** — `loadAppliedMap()` matches `Job.id` (sha1 of URL) to entries in `config/applied.json`; sets `job.applied`.
8. **Diff** — compute new-since (top 20) / removed-since (top 10) vs previous `data/jobs.json` via `readJsonOrNull` before write.
9. **Render + write** — regenerate `JOBS.md`, write `data/jobs.json` + `data/feed.xml`.

Other top-level entry points (`pnpm run ai-review`, `apply-worker`, `mcp`, `ui`) have their own sections below.

## Code-level docs

Subsystems documented in-file + tests; this CLAUDE.md doesn't restate them:

| Subsystem | Source | Tests |
|---|---|---|
| Dedup + final sort (`compareJobs` 4-key chain, source priority) | `src/dedup.ts` | `tests/dedup.test.ts` |
| Salary parsing (K/M suffix, currency, hourly→annual) | `src/salary.ts` | `tests/salary.test.ts` |
| RSS feed (top 50 new jobs, hand-rolled XML) | `src/feed.ts` | `tests/feed.test.ts` |
| Source-health alarms (🚨 banner) | `src/render.ts` | — |
| New-since / removed-since diff | `src/index.ts` (via `readJsonOrNull` before write) | — |
| Application-status emoji + summary | `src/applied.ts` | `tests/applied.test.ts` |

## Filter rules (overview)

`src/filters.ts` is a hard-drop chain → boilerplate strip → scoring (capped at 100) → optional out-of-region penalty → drop below `minScoreToKeep` (default 30) → category tagging. Categories are **config-driven** (`config/profile.json#categories`, see `CategoryDef`) — a job is multi-labeled with every category whose keywords match (`Job.categories: string[]`), and a category's optional `weight` also feeds the score. No taxonomy is hardcoded; jobs matching none fall under a synthetic "Other".

Geo filtering is **persona-neutral** — no country is privileged. Where/how the candidate works lives in the `location` block of `config/profile.json` (`basedIn`, `workTypes`, `acceptedRegions`, `excludeOutsideAcceptedRegions`), editable on the Profile tab. See the **`pupila-filters` skill** for the `hard_location_incompatible` rule and the rescue-first matching.

Weights and keyword lists load at runtime from `config/profile.json`. **Adjusting weights/keywords is non-code.** Every kept job carries a `_signals` object showing which rules fired — see the **`pupila-filters` skill** for the tier multipliers, scoring catalog, debugging recipes, and how to add new positive signals or hard-drop rules.

## Application tracking

`config/applied.json` is hand-editable but day-to-day written by the UI via dev-server middleware. Schema in `src/types.ts`:

```ts
type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
interface AppliedEntry { url: string; status: ApplicationStatus; date: string; notes?: string }
```

`src/applied.ts` exports `STATUS_EMOJI` (📝/💬/🎯/❌/⏸), `loadAppliedMap` (hashes URLs with the same identity as `Job.id`), and `summarizeApplied`. Wired in `src/index.ts` after dedup+sort: every kept job gets `job.applied = appliedMap.get(job.id)` when matched.

## Local UI

`pnpm run ui` serves a Vite + React 19 dashboard at `127.0.0.1:5173`. **Local-only — no auth, no hosting, intentionally not exposed beyond 127.0.0.1** (a public dashboard surfacing applied-job statuses could be Google-indexed and visible to recruiters). **Don't add `pnpm run ui:deploy`** without explicit instruction.

Two hard rules (enforced by Biome + `scripts/check-ui-patterns.sh`, fully documented in `ui/CLAUDE.md`):

1. Every class comes from a co-located `*.module.css` import — never write a class name as a string literal.
2. Every server call goes through `ui/src/lib/api/` — never write `fetch('/api/...')` at a call site.

Settings tab (eight panels), Jinder (swipe-to-apply queue), AI Apply (per-job tailored package), `useEffect` async style, feature hooks, code-splitting + memo perf rules: all in **`ui/CLAUDE.md`** (auto-loaded when working in `ui/`).

## AI per-job review

`pnpm run ai-review` is a **local-only** companion that augments selected jobs with an LLM review via `src/lib/llm.ts` (auto-detects `claude`/`codex`/`gemini`/`opencode`, override `PUPILA_LLM`). Uses the local subscription — **not** an API key, so no per-token charges. Output: `data/ai-reviews.json`.

Daily workflow:

```bash
pnpm run daily       # = pnpm run dev && pnpm run ai-review
pnpm run ui          # browse with verdicts + score breakdowns inline
git add data/jobs.json data/feed.xml data/ai-reviews.json JOBS.md
git commit -m "chore: daily run + ai reviews"
```

`config/candidate-brief.md` is the main lever for tuning verdicts. See the **`pupila-ai-review` skill** for pipeline details, JSON-fence parsing quirks, AI Apply (per-job tailored package) architecture, and provider-switching.

## MCP server

`pnpm run mcp` exposes 17 typed tools to MCP clients (Claude Code / Claude Desktop / Cursor). Lives at `src/mcp/`. **Fourth direct consumer of `src/lib/*`** alongside Vite middleware, apply-worker, and `pnpm run ai-review` — no HTTP shim, no CLI subprocess layer.

Install: `scripts/install-mcp.sh` (idempotent prereq-checks, JSON merging via `scripts/_merge-mcp-config.mjs`). `PUPILA_DRY_RUN=1` for a no-write rehearsal.

Hard invariants (stdout JSON-RPC, `JOB_ID_REGEX`, single-flight locks on `trigger_fetch` + `regenerate_profile`, worker-separation, error envelopes) and the 4-step recipe for adding a new tool both live in **`src/mcp/CLAUDE.md`** (auto-loaded in `src/mcp/`).

The README tool-reference table is hand-maintained — every tool change MUST also update `## MCP server` in `README.md`.

## Tests

Vitest, across `tests/` (`*.test.ts` glob). Run via `pnpm test` or `pnpm run test:watch`. `tsconfig.test.json` extends `tsconfig.json` with `rootDir: "."` so tests/ don't leak into the build. When tuning a regex or weight, update tests in the same commit.

## GitHub Actions

One workflow only — `.github/workflows/check.yml` — every push to `main` and PR. Seven gates: Biome lint, typecheck (3 tsconfigs), Vitest, `tsc` build, Vite UI build, bundle-size budget, `pnpm audit`. Daily aggregation runs **locally** via launchd/cron (see `scripts/install-*.sh`).

Third-party actions pinned by 40-char SHA with version comment. Bump manually when needed.

> **CodeQL workflow removed** — Code Scanning isn't available on private repos without GitHub Advanced Security. Restore from commit `7397117` if the repo goes public.

## Pre-commit

`simple-git-hooks` registered via the `prepare` lifecycle script. Runs `pnpm run lint && pnpm run typecheck && pnpm run lint:ui-patterns`. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` for emergency WIP only. Don't make a habit of it.

## Conventional commits

- `feat:` new fetcher / filter rule / output section
- `fix(fetchers):` upstream URL change, parser bug
- `chore:` housekeeping
- `ci:` workflow changes
- `docs:` README/CLAUDE.md changes

## When to update this doc

Root CLAUDE.md is **index + cross-cutting invariants**, not a reference manual. Add a section here only when:

- A new cross-cutting invariant applies repo-wide (not subsystem-scoped).
- A new top-level workflow (`pnpm run X`) is added.
- A new structural convention spans more than one subsystem.

Otherwise:

- **Subsystem-specific** guidance → scoped `CLAUDE.md` (`ui/`, `src/mcp/`, `src/fetchers/`).
- **Procedural how-to** → a skill (`.claude/skills/pupila-*/SKILL.md`).
- **Code-level rules** → comments next to the code they govern.

When in doubt, put it next to the code that needs it. Every byte added here costs every future session.
