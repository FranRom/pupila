# CLAUDE.md

Guidance for future Claude Code sessions working in this repo. **Slim by design** — this file is loaded every turn. Subsystem details live next to the code that needs them; procedural how-tos live in skills.

## Where things live

| Topic | Source |
|---|---|
| Adding a fetcher / tier-S slug | `pupila-fetchers` skill |
| Adding an MCP tool | `pupila-mcp-tools` skill |
| Tuning filter weights / debugging `_signals` | `pupila-filters` skill |
| AI review + AI Apply pipelines | `pupila-ai-review` skill |
| UI patterns (CSS modules, `lib/api/`, hooks, perf) | `ui/CLAUDE.md` (auto-loaded in `ui/`) |
| MCP server invariants | `src/mcp/CLAUDE.md` (auto-loaded in `src/mcp/`) |
| Fetcher security checklist | `src/fetchers/CLAUDE.md` (auto-loaded in `src/fetchers/`) |

## Overview

`pupila` is a **config-driven, forkable** daily job aggregator. Fetches from 13 public sources (3 ATS APIs — Ashby, Greenhouse, Lever — plus RSS, JSON boards, Hacker News, HTML scrapers, an Aave Next.js scraper, and `ashby-private` for orgs whose public posting-API is disabled), normalizes them, applies hard exclusion filters, computes a per-job `fitScore`, deduplicates, and writes `data/jobs.json`, an RSS feed at `data/feed.xml`, and an auto-regenerated `JOBS.md`. **`README.md` is hand-maintained — never overwrite it from code.** No external services, no DB.

Cross-cutting invariants (apply repo-wide):

- **`config/profile.json` is gitignored** — encodes personal scoring preferences. Auto-bootstraps from committed `config/profile.default.json` on first `pnpm run dev` / `pnpm run ui` via `bootstrapProfileIfMissing()` (idempotent — `COPYFILE_EXCL` no-ops on the steady state). Don't bypass; don't commit personalized weights.
- **Mandatory CV gate**: `pnpm run dev` checks for `config/candidate-brief.md` at startup and exits 1 if missing. Bypass with `JOB_HUNT_NO_BRIEF_CHECK=1` or `--no-brief-check`.
- **`config/candidate-brief.md` is the only natural-language config** (gitignored). Generated via `pnpm run setup-brief --file ~/cv.pdf` or via the UI's Profile tab (drop PDF/DOCX/MD CV). CLI shells out to `claude`/`codex`/`gemini`/`opencode` — auto-detected, override `JOB_HUNT_LLM=<provider>`.
- **Local-first scheduling**: daily aggregation runs via `scripts/install-launchd.sh` (macOS) or `scripts/install-cron.sh` (Linux), not GitHub Actions cron. CI runs only on push/PR for gates.
- **`data/applied.json` source of truth** for application tracking (UI writes via Vite middleware). Commit manually to persist across machines. **Don't filter applied jobs out of the main list** — user explicitly wants them visible.

## Stack

- Node 22 LTS, ESM, TypeScript 6 (NodeNext)
- Biome 2.4 (lint + format, single config in `biome.json`)
- pnpm 11 (`minimumReleaseAge: 1d`, `strictDepBuilds: true` — supply-chain hardening)
- Vitest 4 (tests in `tests/`, 330 cases)
- simple-git-hooks (pre-commit `lint && typecheck && lint:ui-patterns`)
- Runtime deps: `fast-xml-parser` (RSS), `mammoth` + `pdfjs-dist` (CV parsing), `proper-lockfile` (apply-queue R-M-W lock). Native `fetch` only — no HTTP client lib.

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
pnpm run clean [-- --all]             # wipe locally-generated artifacts
pnpm run mcp                          # MCP server over stdio
```

## Repo layout (high-level)

```
src/
  index.ts          # orchestrator (filter + score + dedup + render + write)
  types.ts          # Job, Source, ApplicationStatus, FetcherResult, ...
  fetchers/         # one fetcher per source — see src/fetchers/CLAUDE.md
  mcp/              # MCP server (17 tools) — see src/mcp/CLAUDE.md
  lib/              # apply-queue, swipe-skips, ai-apply, llm, cv-parser, fetch-runner
  filters.ts salary.ts dedup.ts applied.ts render.ts feed.ts normalize.ts
  utils.ts          # fetchWithTimeout, isSafeUrl, sha1, stripHtml, readJsonOrNull
  rss.ts            # fast-xml-parser wrapper
  ai-review.ts ai-review-parse.ts setup-brief.ts
config/             # slugs.json, profile.{default,}.json, applied.json, brief, preferences
ui/                 # local-only React dashboard — see ui/CLAUDE.md
scripts/            # apply-worker, installers (launchd/cron/mcp), clean
tests/              # 192 vitest cases, fixtures in tests/fixtures/
openspec/changes/   # OpenSpec proposals (committed)
.claude/skills/     # project skills (pupila-*) ship; provider-generic skills are local-only
```

Code-level docs (subsystems documented in-file + tests; this CLAUDE.md doesn't restate them):

- Dedup + final sort (`compareJobs` 4-key chain, source priority) → `src/dedup.ts` + `tests/dedup.test.ts`
- Salary parsing (K/M suffix, currency, hourly→annual) → `src/salary.ts` + `tests/salary.test.ts`
- RSS feed (top 50 new jobs, hand-rolled XML) → `src/feed.ts` + `tests/feed.test.ts`
- Source-health alarms (🚨 banner) → `src/render.ts`
- New-since / removed-since diff (top 20 / top 10) → `src/index.ts` (computed via `readJsonOrNull` before write)
- Application-status emoji + summary → `src/applied.ts` + `tests/applied.test.ts`

## Filter rules (overview)

`src/filters.ts` is a hard-drop chain → boilerplate strip → scoring (capped at 100) → optional -10 US-centric penalty → drop below `minScoreToKeep` (default 30) → category assignment (`web3+ai` / `web3` / `ai` / `general`).

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

`pnpm run ai-review` is a **local-only** companion that augments selected jobs with an LLM review via `src/lib/llm.ts` (auto-detects `claude`/`codex`/`gemini`/`opencode`, override `JOB_HUNT_LLM`). Uses the local subscription — **not** an API key, so no per-token charges. Output: `data/ai-reviews.json`.

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

Hard invariants (stdout JSON-RPC, `JOB_ID_REGEX`, single-flight locks on `trigger_fetch` + `regenerate_profile`, worker-separation, error envelopes) live in **`src/mcp/CLAUDE.md`** (auto-loaded in `src/mcp/`). Adding a tool: **`pupila-mcp-tools` skill**.

The README tool-reference table is hand-maintained — every tool change MUST also update `## MCP server` in `README.md`.

## Tests

Vitest, 330 cases across `tests/` (`*.test.ts` glob). Run via `pnpm test` or `pnpm run test:watch`. `tsconfig.test.json` extends `tsconfig.json` with `rootDir: "."` so tests/ don't leak into the build. When tuning a regex or weight, update tests in the same commit.

## GitHub Actions

One workflow only — `.github/workflows/check.yml` — every push to `main` and PR. Seven gates: Biome lint, typecheck (3 tsconfigs), Vitest, `tsc` build, Vite UI build, bundle-size budget, `pnpm audit`. Daily aggregation runs **locally** via launchd/cron (see `scripts/install-*.sh`).

Third-party actions pinned by 40-char SHA with version comment. Dependabot opens weekly grouped PRs.

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
