# job-hunt

A personal job aggregator that runs daily on GitHub Actions. It pulls listings from 13 public sources (job boards, RSS feeds, Hacker News, three ATSes — Greenhouse, Ashby, Lever — plus a custom Aave scraper and an Ashby-private GraphQL fetcher for orgs whose public posting-API is disabled), normalizes them into a single shape, scores each one against a profile (senior/lead/staff frontend, web3, and AI engineering, remote-friendly), deduplicates, and commits the result back to this repo.

> **Looking for today's matches?** → [`JOBS.md`](./JOBS.md) (auto-generated, refreshed daily at 07:00 UTC).
> Raw data lives in [`data/jobs.json`](./data/jobs.json).
> Subscribe to the new-matches RSS feed: [`data/feed.xml`](./data/feed.xml) (point any reader at the raw GitHub URL).
> Prefer a UI? → `pnpm run ui` opens a local-only Vite dashboard at `http://127.0.0.1:5173` with filter, search, sortable columns, and click-to-expand rows over `data/jobs.json`. The expand panel shows the per-job score breakdown and (optionally) an LLM "AI take" — see [AI per-job review](#ai-per-job-review) below.

---

## Why

Manually checking 11 job boards every morning is tedious. This repo replaces that with a single auto-generated table, scored by relevance, sorted by fit, with a "✨ New since last run" section at the top so the daily diff is the actionable bit. No external services — just GitHub Actions, files committed to this repo, and one runtime dependency.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22 LTS, ESM modules |
| Language | TypeScript 5.9 (NodeNext, strict) |
| Lint + format | Biome 2.4 |
| Package manager | pnpm 10 |
| Tests | Vitest 3 (113 unit tests across filters, dedup, utils, applied, salary, feed, aave, ashby-private; tiered keyword weighting + salary-aware sort tiebreak both have dedicated cases) |
| Pre-commit | simple-git-hooks (runs lint + typecheck on every commit) |
| HTTP | Native `fetch` with `AbortController` (30s timeout, 1 retry on 5xx/network) |
| RSS parsing | `fast-xml-parser` (only runtime dep) |
| HTML scraping | Inline regex parsers (no cheerio/jsdom) |
| Schedule | GitHub Actions cron, daily 07:00 UTC |
| Output | Files committed to this repo (`data/jobs.json`, `data/feed.xml` RSS, `JOBS.md`, `data/archive/<YYYY-MM>.json` on month-start) |
| Static analysis | Biome + tsc on every PR (`check.yml`); Dependabot for npm + GitHub Actions |

## Architecture

```
                ┌─────────────────────────────────────────────────┐
                │ GitHub Actions cron — 07:00 UTC daily           │
                └─────────────────────────────────────────────────┘
                                      │
                                      ▼
        ┌─────────────────── src/index.ts ──────────────────┐
        │                                                   │
        │   ┌──────── Fetchers (Promise.all) ─────────┐     │
        │   │ ashby (42 slugs)   greenhouse (8 slugs) │     │
        │   │ lever (6 slugs)    aave (custom)        │     │
        │   │ ashby-private (1)  cryptojobslist       │ ──► raw[] per source
        │   │ remoteok  remotive  weworkremotely      │     │
        │   │ web3career  aijobsnet                   │     │
        │   │ hn-hiring  hn-jobs                      │     │
        │   └─────────────────────────────────────────┘     │
        │                       │                           │
        │                       ▼                           │
        │   write data/raw/<source>-YYYY-MM-DD.json (gitignored)
        │                       │                           │
        │                       ▼                           │
        │   normalize (per source) → Job[]                  │
        │                       │                           │
        │                       ▼                           │
        │   filters.applyFilters: hard excludes + scoring   │
        │     (boilerplate stripped, body truncated to      │
        │      first 1500 chars before keyword scoring)     │
        │                       │                           │
        │                       ▼                           │
        │   dedup.dedupe: by URL, then by company+title     │
        │                       │                           │
        │                       ▼                           │
        │   sort by fitScore desc, postedAt desc, id asc    │
        │                       │                           │
        │                       ▼                           │
        │   attach config/applied.json status (by URL hash) │
        │                       │                           │
        │                       ▼                           │
        │   diff against previous data/jobs.json (✨ new)    │
        │                       │                           │
        │                       ▼                           │
        │   strip body field, write data/jobs.json,         │
        │     monthly archive on day-1, render JOBS.md      │
        │                                                   │
        └───────────────────────────────────────────────────┘
                                      │
                                      ▼
                  git auto-commit ─► push to main
```

Each fetcher is isolated: it catches its own errors and returns `[]` on failure. A 30-second `AbortController` timeout caps every HTTP call. One source going down can't break the rest of the run.

## Sources

The three ATS fetchers (Ashby, Greenhouse, Lever) carry the bulk of the high-quality signal — each iterates a curated tier-S slug list. The other 8 sources backfill long-tail listings.

| Source | Type | Endpoint |
|---|---|---|
| [ashby](./src/fetchers/ashby.ts) | JSON API | `api.ashbyhq.com/posting-api/job-board/<slug>` × 42 tier-S slugs |
| [greenhouse](./src/fetchers/greenhouse.ts) | JSON API | `boards-api.greenhouse.io/v1/boards/<slug>/jobs` × 8 tier-S slugs |
| [aave](./src/fetchers/aave.ts) | HTML scraper (Next.js __NEXT_DATA__) | `aave.com/careers` |
| [ashby-private](./src/fetchers/ashby-private.ts) | Ashby private GraphQL × N slugs | `jobs.ashbyhq.com/api/non-user-graphql` (currently 1 slug: `chainlink-labs`) |
| [lever](./src/fetchers/lever.ts) | JSON API | `api.lever.co/v0/postings/<slug>` × 6 tier-S slugs |
| [remoteok](./src/fetchers/remoteok.ts) | JSON API | `remoteok.com/api` |
| [remotive](./src/fetchers/remotive.ts) | JSON API | `remotive.com/api/remote-jobs?category=software-dev` |
| [weworkremotely](./src/fetchers/weworkremotely.ts) | RSS 2.0 | `weworkremotely.com/categories/remote-programming-jobs.rss` |
| [cryptojobslist](./src/fetchers/cryptojobslist.ts) | RSS 2.0 | `api.cryptojobslist.com/jobs.rss` |
| [web3career](./src/fetchers/web3career.ts) | HTML scraper | 5 category pages on `web3.career` |
| [aijobsnet](./src/fetchers/aijobsnet.ts) | HTML scraper | `aijobs.net` (global + EU pages) |
| [hn-hiring](./src/fetchers/hn-hiring.ts) | Algolia API | latest "Ask HN: Who is hiring" thread |
| [hn-jobs](./src/fetchers/hn-jobs.ts) | Algolia API | `hn.algolia.com/api/v1/search_by_date?tags=job` |

The Ashby tier-S list covers the AI frontier (OpenAI, Mistral, Cohere, Perplexity, Cursor, ElevenLabs, Modal, LangChain, LangFuse, LlamaIndex, OpenRouter, Pinecone, Supabase, Neon, Clerk, PostHog, Browserbase, Replit, Runway, Notion, Anyscale, BaseTen, Character, Weaviate) plus web3 (Linear, Ramp, Uniswap, Mysten Labs, Paradigm, Polygon Labs, Base, Blockworks, Succinct, Espresso, Phantom, Polymarket, Alchemy, Stacks, Morpho, Magic Eden, LiFi). Greenhouse adds Anthropic, Vercel, Mercury, Coinbase. Lever adds Binance, Ledger, CoinGecko, CoinMarketCap, Safe, Arbitrum Foundation. Custom first-party coverage: Aave via a Next.js `__NEXT_DATA__` scraper, and Chainlink Labs via the `ashby-private` fetcher (Ashby's private GraphQL endpoint — same fetcher generalized to a slug array, so any future org whose public posting-API is disabled is a one-line config add).

Adding a 12th source is one new file in `src/fetchers/`, one entry in `Source`, one normalizer in `normalize.ts`, and one line in `src/index.ts`. See [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-new-fetcher) for the exact recipe.

## Pipeline stages

### 1. Fetch (`src/fetchers/*.ts`)

Each module exports `fetch<Source>(): Promise<{ items: Raw[]; errors: string[] }>` where `Raw` is source-specific. Errors are caught internally and aggregated, never thrown. Per-slug isolation in the three ATS fetchers so 404s on individual companies don't cascade. The 30s `AbortController` timeout in `fetchWithTimeout` retries once with a 2s backoff on `>=500` and network errors; 4xx errors are not retried (they're permanent). Tier-S slug arrays for Ashby / Greenhouse / Lever are loaded from [`config/slugs.json`](./config/slugs.json) — adding a company is a non-code change.

### 2. Normalize (`src/normalize.ts`)

One function per source maps `Raw → Job`:

```ts
interface Job {
  id: string;                 // sha1 of normalized URL
  source: Source;             // one of 11 literal source names
  title: string;
  company: string | null;
  url: string;                // http or https only — non-http schemes are filtered out
  location: string | null;
  remote: boolean;            // inferred from text + tags
  body: string;               // HTML stripped via regex (in-memory only)
  tags: string[];
  salary: string | null;          // surfaced when source provides it (Ashby/Lever/Remotive/web3career/aijobs)
  salaryMin: number | null;       // parsed annual integer (USD/EUR/etc., minor units stripped)
  salaryMax: number | null;       // parsed annual integer
  salaryCurrency: string | null;  // ISO code: 'USD' | 'EUR' | 'GBP' | …
  postedAt: string | null;    // ISO 8601
  fetchedAt: string;          // ISO 8601, set at run-start
  fitScore: number;           // 0-100, populated by filters
  category: 'web3' | 'ai' | 'web3+ai' | 'general';
  _signals?: JobSignals;      // per-job scoring breakdown (see below)
  applied?: AppliedEntry;     // attached when matched against config/applied.json
}
```

URLs are canonicalized (`utm_*` stripped, trailing slash normalized) before hashing into `id`. Any URL that isn't `http(s):` is rejected at the filter stage as a defense against `javascript:` / `data:` / `file:` payloads from upstream sources.

**Note on `data/jobs.json`:** the `body` field is stripped from the persisted file (it's regenerable from the URL and bloats the artifact ~10×). `body` is only present in-memory during a run.

### 3. Filter + score (`src/filters.ts`)

**Hard excludes** (drop entirely). The hard-drop chain is a named-rule list (`HARD_RULES` in [`src/filters.ts`](./src/filters.ts)) — every drop is attributed to a rule name, and the per-rule count is surfaced in the JOBS.md "Dropped — hard filters" stat (e.g. `(missing_senior_req=812, title_non_eng_role=64, ...)`) so you can see which rule is doing the heavy lifting at a glance.

- Title contains `junior|jr|intern|entry-level|associate|graduate|trainee|apprentice`.
- Title does **not** contain `senior|sr|staff|principal|lead|head|director|engineer(s)|developer(s)|architect(s)`.
- Body matches a hard US-only / onsite pattern (e.g. `must be located in the United States`, `onsite only`, `relocate to San Francisco`).
- Title or body matches a non-engineering pattern (`marketing|sales|recruiter|...`) **and** the title doesn't contain an engineering keyword.
- Title matches a compound non-engineering pattern that contains the word "Engineer" but isn't real engineering: `customer support engineer`, `sales engineer`, `solutions engineer`, `developer relations|advocate|experience`, `field engineering|operations`, `business operations`, `partner(ships) engineer`, `forward deployed engineer`, `implementation engineer`, `gtm`, `go-to-market`.
- Title is a non-engineering executive role: `VP`, `Vice President`, `CMO`, `CRO`, `CFO`, `COO`.
- URL scheme is not `http(s):` (security gate against `javascript:` / `data:` / `file:` URLs from upstream).

**Body preparation for scoring.** Before regex-matching for keywords, the body is run through `preparedScoringBody`: it strips known company-boilerplate sections (EEO, privacy notices, accommodations, "About us") and truncates to the first 1500 characters. This prevents false positives from recruiter footers (e.g. "we use Anthropic Claude internally for support tooling" landing a +20 AI signal on a backend role). Hard-drop checks still see the full body so onsite/US-only language at the bottom of a posting is honored.

**Soft signals** (additive, capped at 100; weights live in [`config/profile.json`](./config/profile.json)):

| Signal | Weight |
|---|---:|
| Web3 — title or body contains `web3\|crypto\|defi\|blockchain\|wallet\|onchain\|dapp\|nft` | +20 |
| Web3 stack — body contains `wagmi\|viem\|ethers\|web3.js\|solana\|anchor\|evm\|rainbowkit\|walletconnect\|reown\|hardhat\|foundry` | +20 |
| AI — title or body contains `ai engineer\|ml engineer\|llm\|gen-ai\|generative ai\|ai-native` | +20 |
| AI stack — body contains `anthropic\|claude\|openai\|gpt\|vercel ai\|ai sdk\|langchain\|llamaindex\|rag\|agents\|mcp\|prompt engineering` | +20 |
| Stack — body contains `react\|next.js\|typescript` (tiered) | +10 base |
| Stack — body contains `react native\|expo` (tiered) | +5 base |
| Stack — body contains `graphql\|tailwind\|vite` (tiered) | +5 base |
| Lead title — title contains `lead\|staff\|principal\|head` | +15 |
| Senior title — title contains `senior\|sr` | +10 |
| Frontend title — title contains `frontend\|front-end\|fullstack\|full-stack\|web\|mobile` | +10 |
| Frontend body — body contains role-specific frontend phrases (design system, ship components, accessibility, etc.) (tiered) | +10 base |
| Location — location or body contains `remote\|worldwide\|emea\|europe\|cet\|spain\|global\|anywhere` | +10 |
| Freshness — `postedAt` within 7 days | +10 |
| Freshness — `postedAt` within 14 days (and not within 7) | +5 |
| **Penalty** — body US-centric without remote-worldwide language | **-10** |

**Tiered keyword weighting.** The four "stack/frontend body" signals (rows marked _tiered_ above) count occurrences instead of doing a binary match: 1 mention earns half-weight, 2–3 the listed base weight, and 4+ a 1.5× boost. This lets a posting that mentions "react" eight times in concrete role context outscore one that drops it once in a "nice to have" footer. Web3, AI, title, location, and freshness signals stay binary because they're inherently low-cardinality and cheating them with repetition isn't a real concern.

**Drop** anything with `fitScore < 30` after the cap.

**Category** is derived from which signals fired: both web3 and AI → `web3+ai`; only web3 → `web3`; only AI → `ai`; neither → `general`.

**Auditability — `_signals`.** Every kept job in `data/jobs.json` carries a `_signals` object recording which scoring rules fired and what they contributed. Useful when a job's score looks wrong:

```jsonc
{
  "title": "Senior Software Engineer, Fullstack (AI Advisor)",
  "fitScore": 100,
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
}
```

`rawTotal` is the un-capped positive sum; `capped: true` means positives exceeded 100 and got clamped before any penalty.

### 4. Dedup (`src/dedup.ts`)

Two passes:

1. By `id` (URL hash).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

When two jobs collide, the one with the higher `fitScore` wins. Ties are broken by source priority:

```
ashby > lever > greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok
```

**Sort stability.** After dedup, the final sort uses the exported `compareJobs` comparator: `fitScore desc → salaryMax desc → postedAt desc → id asc`. The `salaryMax` tiebreak floats transparent-comp companies above silent ones among score-tied roles (null is treated as 0), and `id asc` keeps day-over-day diffs deterministic when everything else ties.

### 5. Diff against previous run

Before writing the new `data/jobs.json`, the orchestrator reads the **previous** committed copy, builds a `Set` of its job IDs, and computes which jobs in today's run are not in yesterday's. This list becomes the **"✨ New since last run"** section at the top of `JOBS.md`. On the very first run (no previous file) the section is omitted entirely; otherwise it's the most actionable thing to skim each morning.

### 6. Render

`src/render.ts` produces `JOBS.md` with:

1. **🚨 Source-health banner** (only when one or more fetchers returned zero items or had errors).
2. Stats (totals, drop reasons with per-rule breakdown, by-source breakdown with 🚨 prefixes for unhealthy sources, by-category breakdown).
3. **📋 Application status** — summary line + table of every job in `config/applied.json`, sorted by date desc (omitted when no entries).
4. **✨ New since last run** — top 20 newest jobs by `fitScore` (omitted when empty or on first run).
5. **🗑 Removed since last run** — top 10 by previous fitScore of postings that disappeared since the last run (filled, withdrawn, or pulled upstream — omitted when empty or on first run).
6. **Top Web3 + AI** — top 10.
7. **Top Web3** — top 20.
8. **Top AI** — top 20.
9. **Other** — top 10.

Each table row: `Score | Title | Company | Source | Posted (relative) | Link`. The title cell carries an emoji prefix when the job is in `config/applied.json` (📝 applied, 💬 interview, 🎯 offer, ❌ rejected, ⏸ withdrawn) and a ` · <salary>` suffix when the source provides salary data. The full sorted list also lands in `data/jobs.json`, including the `_signals` breakdown per job.

[`src/feed.ts`](./src/feed.ts) also writes [`data/feed.xml`](./data/feed.xml) — an RSS 2.0 feed of the day's "✨ new" jobs (top 50 by fitScore). Subscribe to the raw GitHub URL in any RSS reader to get a daily mobile digest.

## Application tracking

[`config/applied.json`](./config/applied.json) is a hand-edited list of jobs you've applied to. Schema:

```jsonc
[
  {
    "url": "https://jobs.ashbyhq.com/openai/abc123",
    "status": "applied",         // applied | interview | offer | rejected | withdrawn
    "date": "2026-04-25",
    "notes": "optional free text"
  }
]
```

[`src/applied.ts`](./src/applied.ts) loads the file at run-time, hashes each `url` with the same `sha1(normalizeUrl(...))` used for `Job.id`, and attaches the matching entry as `Job.applied`. Matched jobs are surfaced in the "📋 Application status" section at the top of `JOBS.md` *and* keep appearing in their normal category section with the status emoji prefix — a deliberate choice so already-applied jobs aren't filtered out (you may want to re-check, follow up, or compare against a new posting).

## AI per-job review

[`src/ai-review.ts`](./src/ai-review.ts) is an **optional, local-only** companion that adds an LLM "second opinion" to selected jobs. Each job gets a structured review — summary, what they want, what they offer, red flags, and a verdict (`strong-match | match | weak-match | skip`) — so you can scan the day's matches in seconds instead of reading every posting.

It runs against **your Claude Code subscription** (e.g. Max plan) via `claude -p "<prompt>"`. There are no per-token charges, but there's also no way to run this from CI — a workflow runner can't auth as your subscribed user. Run it locally after the daily pipeline.

### One-time setup

1. Make sure the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/quickstart) is installed and authed (`claude --version` should work).
2. Edit [`config/candidate-brief.md`](./config/candidate-brief.md) to describe yourself in 6–10 lines: who you are, what stack, what role level, where you want to work, and what you want to **avoid**. The "avoid" list is just as useful as the "want" list — it's what lets the LLM call out matches that look right on paper but aren't.

### Daily flow

```bash
pnpm run dev         # writes data/jobs.json + data/jobs-bodies.json (sidecar, gitignored)
pnpm run ai-review   # picks the top 20 unreviewed by fitScore, writes data/ai-reviews.json
pnpm run ui          # browse — verdicts appear inline, click any row for the full review
git commit data/jobs.json data/feed.xml data/ai-reviews.json JOBS.md
```

CLI flags:

```bash
pnpm run ai-review                 # default: top 20 unreviewed by fitScore
pnpm run ai-review --top=50        # raise the per-run cap
pnpm run ai-review --force         # re-review entries that already exist
pnpm run ai-review --ids=abc,def   # specific job ids only
```

The script writes `data/ai-reviews.json` after **every** successful review, so a Ctrl-C or rate-limit kill leaves a partial-but-valid file. Reviews for jobs no longer in `jobs.json` are pruned automatically each run.

### How the UI surfaces it

In `pnpm run ui`, every job row is clickable. The expanded panel has three columns:

1. **AI take** — the review's summary, verdict reason, and three short lists (wants / offers / red flags). When no review exists yet, you see a "run `pnpm run ai-review`" hint instead.
2. **Score breakdown** — the rule-based `_signals` showing exactly which scoring rules fired (`+20 web3Stack`, `+10 stackPrimary`, etc.) so you can spot when the score is inflated by buzzwords.
3. **Meta** — location, tags, posted date, internal id (handy for `--ids=` re-review).

A small verdict badge (`strong-match` / `match` / `weak-match` / `skip`) also appears next to the title in the main row when a review exists, so you can scan from the table without expanding.

### Architecture choices worth knowing

- The pipeline writes a sidecar `data/jobs-bodies.json` (gitignored) so the AI step has the full body to review — `data/jobs.json` itself stays slim. The sidecar is regenerated on every `pnpm run dev`, so don't expect bodies for jobs that aren't in today's run.
- The parser ([`src/ai-review-parse.ts`](./src/ai-review-parse.ts)) strips markdown fences and falls back to safe defaults for missing/invalid fields rather than throwing. Tested in [`tests/ai-review-parse.test.ts`](./tests/ai-review-parse.test.ts).
- `data/ai-reviews.json` **is** committed (so reviews persist across machines / pipeline runs and the UI works on a fresh clone). `data/jobs-bodies.json` is **not** (transient, regenerated daily).

## Tuning filters via `config/profile.json`

[`config/profile.json`](./config/profile.json) externalizes every scoring weight and keyword list. Adjust weights without touching code:

```jsonc
{
  "scoring": { "minScoreToKeep": 30, "maxScore": 100, "scoringBodyMaxChars": 1500 },
  "weights": { "web3TitleBody": 20, "aiStack": 20, "frontendBody": 10, ... },
  "keywords": {
    "junior":      ["junior", "jr", "intern", "entry-?level", "associate", ...],
    "seniorReq":   ["senior", "sr", "staff", "principal", "lead", "head", ...],
    "aiStack":     ["anthropic", "claude", "openai", ...],
    "bodyFrontend":["design system", "ship components", "accessibility", ...]
  }
}
```

Keyword arrays are joined with `|` and compiled into word-bounded, case-insensitive regexes at startup. Adding a keyword is a single-line edit; nothing else needs to change.

## Repo layout

```
job-hunt/
├── .github/
│   ├── workflows/
│   │   ├── jobs.yml           # daily cron + auto-commit
│   │   ├── keepalive.yml      # weekly touch to keep cron alive
│   │   └── check.yml          # PR/push: lint + typecheck + tests + audit
│   └── dependabot.yml         # weekly npm + github-actions updates
├── config/
│   ├── slugs.json             # tier-S Ashby/Greenhouse/Lever slug arrays
│   ├── profile.json           # scoring weights + keyword lists (non-code tuning)
│   └── applied.json           # hand-edited application tracking list
├── data/
│   ├── jobs.json              # slim output (no body), committed daily
│   ├── archive/               # YYYY-MM.json, written on day 1 of each month
│   └── raw/                   # per-source raw JSON, gitignored
├── src/
│   ├── fetchers/              # one file per source
│   │   ├── _shared.ts         # fetchMultiSlug helper for ATS fetchers
│   │   ├── ashby.ts           # 42 tier-S slugs (largest contributor)
│   │   ├── greenhouse.ts      # 8 tier-S slugs
│   │   ├── lever.ts           # 6 tier-S slugs
│   │   ├── aave.ts            # custom: scrapes aave.com/careers (Next.js __NEXT_DATA__)
│   │   ├── ashby-private.ts   # multi-slug: orgs hosted on Ashby with public API disabled
│   │   ├── remoteok.ts
│   │   ├── remotive.ts
│   │   ├── weworkremotely.ts
│   │   ├── cryptojobslist.ts
│   │   ├── web3career.ts
│   │   ├── aijobsnet.ts
│   │   ├── hn-hiring.ts
│   │   └── hn-jobs.ts
│   ├── types.ts               # Job, Source, Category, AppliedEntry, FetcherResult, Raw* shapes
│   ├── utils.ts               # fetchWithTimeout, retry, isSafeUrl, sha1, stripHtml, ...
│   ├── rss.ts                 # shared fast-xml-parser wrapper
│   ├── normalize.ts           # one normalizer per source (extracts salary when available)
│   ├── salary.ts              # parses raw salary strings into normalized min/max/currency
│   ├── filters.ts             # hard excludes + scoring + signal breakdown (loads config/profile.json)
│   ├── applied.ts             # loads config/applied.json, attaches AppliedEntry by URL hash
│   ├── dedup.ts               # 2-pass dedup with priority-aware tiebreak
│   ├── render.ts              # JOBS.md generator (applied section + status emoji + salary + 🚨 banner + 🗑 removed)
│   ├── feed.ts                # RSS 2.0 feed of "✨ new" jobs → data/feed.xml
│   ├── ai-review.ts           # local-only: shells out to `claude -p` per job → data/ai-reviews.json
│   ├── ai-review-parse.ts     # pure parser for the LLM's JSON response (separate file → unit-testable)
│   └── index.ts               # orchestrator
├── tests/
│   ├── filters.test.ts             # 33 cases: hard drops, droppedByRule, scoring, plurals, frontendBody, boilerplate, tiered weighting
│   ├── dedup.test.ts               # 10 cases: id/title collapse, priority, compareJobs salary/postedAt/id chain
│   ├── applied.test.ts             # 4 cases: status emoji map, summary grouping/ordering
│   ├── salary.test.ts              # 15 cases: K/M suffix, currency detection, hourly conversion, free-text
│   ├── feed.test.ts                # 6 cases: RSS skeleton, escaping, sort, 50-item cap
│   ├── aave.test.ts                # 7 cases: __NEXT_DATA__ extraction + normalizer
│   ├── ashby-private.test.ts       # 9 cases: GraphQL parsers + normalizer + slug-to-company
│   ├── ai-review-parse.test.ts     # 9 cases: markdown-fence stripping, invalid verdicts, missing fields, dirty arrays
│   └── utils.test.ts               # 20 cases: URL safety, stripHtml, time math, human date formatter
├── biome.json
├── tsconfig.json
├── tsconfig.test.json         # extends tsconfig with rootDir=. so tests/ typecheck
├── vitest.config.ts
├── package.json               # also holds simple-git-hooks pre-commit config
├── pnpm-lock.yaml
├── CLAUDE.md                  # guidance for future Claude Code sessions
├── JOBS.md                    # auto-generated daily output
└── README.md                  # this file
```

## Run locally

```bash
pnpm install                 # one-time; also installs the pre-commit hook
pnpm run dev                 # tsx, no build step (this is what CI runs too)
pnpm start                   # built output (run pnpm run build first)
pnpm run typecheck           # tsc --noEmit on src/, then on src/+tests/ (tsconfig.test.json)
pnpm run lint                # biome check
pnpm run lint:fix            # biome check --write
pnpm test                    # vitest run (113 unit tests)
pnpm run test:watch          # vitest in watch mode
pnpm run ui                  # local browser UI (Vite dev server, 127.0.0.1:5173)
pnpm run ai-review           # local-only: per-job LLM review via your Claude Code subscription
```

The pre-commit hook runs `lint && typecheck` on every commit. To bypass it for an emergency commit: `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

A run takes ~5-10 seconds and produces:

- `data/jobs.json` — slim sorted list (no `body` field), survives filters + dedup
- `data/feed.xml` — RSS 2.0 feed of the day's ✨ new jobs (top 50)
- `JOBS.md` — sections: source-health banner, stats, applied, ✨ new, 🗑 removed, four category tables
- `data/archive/<YYYY-MM>.json` — monthly snapshot, written on day 1
- `data/raw/<source>-<YYYY-MM-DD>.json` — per-source raw payload for debugging (gitignored)

## GitHub Actions

Three workflows in [`.github/workflows/`](./.github/workflows):

- **[`jobs.yml`](./.github/workflows/jobs.yml)** — daily 07:00 UTC + `workflow_dispatch`. Sets up Node 22 + pnpm 10, runs the aggregator (`pnpm run dev` via tsx — no build step), auto-commits `data/jobs.json`, the `data/archive` directory (when month-start writes a snapshot), and `JOBS.md` if anything changed.
- **[`check.yml`](./.github/workflows/check.yml)** — runs on every push to `main` and every PR. `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm audit --prod`. Source-code validation gate; permissions are `contents: read` only.
- **[`keepalive.yml`](./.github/workflows/keepalive.yml)** — Sundays 12:00 UTC, touches `.keepalive`. Prevents GitHub from auto-disabling the cron after 60 days of repo inactivity.

> **Note on CodeQL.** A CodeQL workflow was previously included but removed because **Code Scanning isn't available on private repos for personal accounts** without GitHub Advanced Security. If you make this repo public or upgrade to an org with GAS, you can re-add it from git history (commit `7397117`).

All workflows pin third-party actions to **commit SHAs** (not floating `@v4` / `@v5` tags) for supply-chain safety. [`Dependabot`](./.github/dependabot.yml) opens weekly PRs to bump those SHAs and the npm deps; the `check.yml` workflow validates each PR before merge.

To trigger the daily run manually: GitHub UI → Actions → jobs → Run workflow, or `gh workflow run jobs.yml`.

## Customization

### Adjust filter weights or keywords

All weights and keyword lists live in [`config/profile.json`](./config/profile.json) — adjusting a weight or adding/removing a keyword is a non-code change. The JSON is loaded at startup, keyword arrays are joined with `|` and compiled into word-bounded, case-insensitive regexes by `compileKw()` in [`src/filters.ts`](./src/filters.ts). For deeper structural changes (new signal type, new hard-drop branch), edit `applyFilters` in `filters.ts` directly.

### Change the tier-S ATS slug lists

All three slug arrays live in [`config/slugs.json`](./config/slugs.json) — adding or removing a company is a non-code change. Slugs that 404 are logged and skipped silently, so testing a candidate is just appending it and re-running.

```jsonc
{
  "ashby": ["linear", "openai", "mystenlabs", ...],
  "greenhouse": ["anthropic", "vercel", "coinbase", ...],
  "lever": ["binance", "ledger", "safe", ...]
}
```

| ATS | URL pattern (find the slug here) | Endpoint to probe |
|---|---|---|
| Ashby | `jobs.ashbyhq.com/<slug>` | `api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true` |
| Greenhouse | `boards.greenhouse.io/<slug>` | `boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` |
| Lever | `jobs.lever.co/<slug>` | `api.lever.co/v0/postings/<slug>?mode=json` |

Quick probe: `curl -sI <endpoint>` → 200 means it's live.

### Add a new source

Detailed recipe in [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-new-fetcher). Quick version:

1. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<Raw[]>`.
2. Add a `Raw<Name>` type to `src/types.ts` and a literal to the `Source` union.
3. Add `normalize<Name>` to `src/normalize.ts`.
4. Wire into `src/index.ts`'s `Promise.all` block.
5. Register in `SOURCE_PRIORITY` (`src/dedup.ts`) and `SOURCES` (`src/render.ts`).

## Security & quality gates

Defense-in-depth measures, ranked from runtime to build-time:

- **URL scheme allowlist.** [`isSafeUrl`](./src/utils.ts) rejects anything not `http(s):`. Filters drop unsafe URLs at the hard-gate. Defends against `javascript:` / `data:` / `file:` payloads from upstream.
- **HTML attribute escaping.** Apply links in `JOBS.md` use raw `<a target="_blank" rel="noopener noreferrer">` with HTML-escaped href (`escapeHtmlAttr` in [`src/render.ts`](./src/render.ts)). `noopener noreferrer` blocks tabnabbing.
- **HTML stripping.** All scraped/RSS/JSON `body` content is run through [`stripHtml`](./src/utils.ts) before any other processing.
- **Pre-commit hook** runs `pnpm run lint && pnpm run typecheck` before each commit. Bypass with `SKIP_SIMPLE_GIT_HOOKS=1`.
- **Tests** (`pnpm test`) — Vitest, 93 cases across security-sensitive code (URL safety, regex filters, dedup tiebreaks, applied-status grouping, salary parsing, RSS escaping, custom-ATS HTML/GraphQL parsers). Runs on every PR.
- **`pnpm audit --prod --audit-level high`** in [`check.yml`](./.github/workflows/check.yml). Reports known CVEs in production deps.
- **Pinned actions.** All four workflows reference third-party actions by commit SHA, not floating tags. Defends against tag-hijacking.
- **Dependabot** ([`dependabot.yml`](./.github/dependabot.yml)) — weekly PRs for npm + GitHub Actions. Each PR is gated by `check.yml`.
- **Minimum permissions.** `jobs.yml` uses `contents: write` (needed for auto-commit). `check.yml` uses `contents: read` only.

## Known upstream issues (as of 2026-04)

These are currently affecting the data quality — they're documented here so they're discoverable when you wonder why a source is empty:

- **`cryptojobslist.com`** is fully Cloudflare-challenged for HTML and the `api.cryptojobslist.com/jobs.rss` endpoint currently returns an empty channel. The fetcher gracefully returns `[]` and will pick up jobs again if upstream restores the feed.
- **All 5 web3 holdouts are now covered.** `morpho`, `magiceden`, `li.fi` turned out to be on the public Ashby posting-API after all (slugs added to `config/slugs.json`). `aave` is on a custom Next.js careers site at `aave.com/careers` (scraped via `__NEXT_DATA__` extraction). `chainlink-labs` is on Ashby but with the public posting-API disabled — scraped via Ashby's private `non-user-graphql` endpoint, the same one the embedded job board uses at runtime. The original Greenhouse stale-slug list (`aave`, `chainlink`, `morpho`, `lifi`, `magiceden`, `ledger`) has been removed from `config/slugs.json` since they were 404ing every run.
- **`web3.career`** and **`aijobs.net`** removed RSS — both are now scraped from HTML via small inline regex parsers, which means a markup change upstream will silently degrade them. If a fetcher returns `0` for several days, eyeball the raw HTML for new selectors.
- **`hn-jobs`** routinely keeps 0–2 entries because YC company posts rarely match the senior+stack signal threshold; this is filtering working as intended, not a bug.
- **`aijobs.net` is dominated by spam-aggregator listings** (one posting cloned to 50 cities). The fetcher dedups by base ID (`-idNNNNN-` slug pattern), which often collapses an entire page down to 2–5 distinct postings.

## Conventional commits

| Prefix | Use for |
|---|---|
| `feat:` | new fetcher, filter rule, or output section |
| `fix(fetchers):` | upstream URL change, parser bug |
| `chore:` | scaffolding, dependency bumps, daily auto-updates |
| `ci:` | workflow changes |
| `docs:` | README / CLAUDE.md changes |

## License

Personal project — no license. Don't redistribute.
