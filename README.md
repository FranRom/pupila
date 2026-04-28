# job-hunt

A personal job aggregator that runs daily on GitHub Actions. It pulls listings from public job boards, RSS feeds, Hacker News, and Greenhouse, normalizes them into a single shape, scores each one against a profile (senior/lead/staff frontend, web3, and AI engineering, remote-friendly), deduplicates, and commits the result back to this repo.

> **Looking for today's matches?** → [`JOBS.md`](./JOBS.md) (auto-generated, refreshed daily at 07:00 UTC).
> Raw data lives in [`data/jobs.json`](./data/jobs.json).

---

## Why

Manually checking 9 job boards every morning is tedious. This repo replaces that with a single auto-generated table, scored by relevance, sorted by fit. No external services — just GitHub Actions, files committed to this repo, and one runtime dependency.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22 LTS, ESM modules |
| Language | TypeScript 5.9 (NodeNext, strict) |
| Lint + format | Biome 2.4 |
| Package manager | pnpm 10 |
| HTTP | Native `fetch` with `AbortController` (30s timeout) |
| RSS parsing | `fast-xml-parser` (only runtime dep) |
| HTML scraping | Inline regex parsers (no cheerio/jsdom) |
| Schedule | GitHub Actions cron, daily 07:00 UTC |
| Output | Files committed to this repo (`data/jobs.json`, `JOBS.md`) |

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
        │   │ remoteok  remotive  weworkremotely      │     │
        │   │ cryptojobslist  web3career  aijobsnet   │ ──► raw[] per source
        │   │ hn-hiring  hn-jobs  greenhouse          │     │
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
        │                       │                           │
        │                       ▼                           │
        │   dedup.dedupe: by URL, then by company+title     │
        │                       │                           │
        │                       ▼                           │
        │   sort by fitScore desc, postedAt desc            │
        │                       │                           │
        │                       ▼                           │
        │   write data/jobs.json + render JOBS.md           │
        │                                                   │
        └───────────────────────────────────────────────────┘
                                      │
                                      ▼
                  git auto-commit ─► push to main
```

Each fetcher is isolated: it catches its own errors and returns `[]` on failure. A 30-second `AbortController` timeout caps every HTTP call. One source going down can't break the rest of the run.

## Sources

| Source | Type | Endpoint |
|---|---|---|
| [remoteok](./src/fetchers/remoteok.ts) | JSON API | `remoteok.com/api` |
| [remotive](./src/fetchers/remotive.ts) | JSON API | `remotive.com/api/remote-jobs?category=software-dev` |
| [weworkremotely](./src/fetchers/weworkremotely.ts) | RSS 2.0 | `weworkremotely.com/categories/remote-programming-jobs.rss` |
| [cryptojobslist](./src/fetchers/cryptojobslist.ts) | RSS 2.0 | `api.cryptojobslist.com/jobs.rss` |
| [web3career](./src/fetchers/web3career.ts) | HTML scraper | 5 category pages on `web3.career` |
| [aijobsnet](./src/fetchers/aijobsnet.ts) | HTML scraper | `aijobs.net` (global + EU pages) |
| [hn-hiring](./src/fetchers/hn-hiring.ts) | Algolia API | latest "Ask HN: Who is hiring" thread |
| [hn-jobs](./src/fetchers/hn-jobs.ts) | Algolia API | `hn.algolia.com/api/v1/search_by_date?tags=job` |
| [greenhouse](./src/fetchers/greenhouse.ts) | JSON API | `boards-api.greenhouse.io/v1/boards/<slug>/jobs` × tier-S list |

Adding a 10th source is one new file in `src/fetchers/`, one entry in `Source`, one normalizer in `normalize.ts`, and one line in `src/index.ts`. See [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-new-fetcher) for the exact recipe.

## Pipeline stages

### 1. Fetch (`src/fetchers/*.ts`)

Each module exports `fetch<Source>(): Promise<Raw[]>` where `Raw` is source-specific. Errors caught internally; per-slug isolation in Greenhouse so 404s on individual companies don't cascade.

### 2. Normalize (`src/normalize.ts`)

One function per source maps `Raw → Job`:

```ts
interface Job {
  id: string;                 // sha1 of normalized URL
  source: Source;             // one of 9 literal source names
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  remote: boolean;            // inferred from text + tags
  body: string;               // HTML stripped via regex
  tags: string[];
  postedAt: string | null;    // ISO 8601
  fetchedAt: string;          // ISO 8601, set at run-start
  fitScore: number;           // 0-100, populated by filters
  category: 'web3' | 'ai' | 'web3+ai' | 'general';
}
```

URLs are canonicalized (`utm_*` stripped, trailing slash normalized) before hashing into `id`.

### 3. Filter + score (`src/filters.ts`)

**Hard excludes** (drop entirely):

- Title contains `junior|jr|intern|entry-level|associate|graduate|trainee|apprentice`.
- Title does **not** contain `senior|sr|staff|principal|lead|head|director|engineer(s)|developer(s)|architect(s)`.
- Body matches a hard US-only / onsite pattern (e.g. `must be located in the United States`, `onsite only`, `relocate to San Francisco`).
- Title or body matches a non-engineering pattern (`marketing|sales|recruiter|...`) **and** the title doesn't contain an engineering keyword.

**Soft signals** (additive, capped at 100):

| Signal | Weight |
|---|---:|
| Web3 — title or body contains `web3\|crypto\|defi\|blockchain\|wallet\|onchain\|dapp\|nft` | +20 |
| Web3 stack — body contains `wagmi\|viem\|ethers\|web3.js\|solana\|anchor\|evm\|rainbowkit\|walletconnect\|reown\|hardhat\|foundry` | +20 |
| AI — title or body contains `ai engineer\|ml engineer\|llm\|gen-ai\|generative ai\|ai-native` | +20 |
| AI stack — body contains `anthropic\|claude\|openai\|gpt\|vercel ai\|ai sdk\|langchain\|llamaindex\|rag\|agents\|mcp\|prompt engineering` | +20 |
| Stack — body contains `react\|next.js\|typescript` | +10 |
| Stack — body contains `react native\|expo` | +5 |
| Stack — body contains `graphql\|tailwind\|vite` | +5 |
| Lead title — title contains `lead\|staff\|principal\|head` | +15 |
| Senior title — title contains `senior\|sr` | +10 |
| Location — location or body contains `remote\|worldwide\|emea\|europe\|cet\|spain\|global\|anywhere` | +10 |
| Freshness — `postedAt` within 7 days | +10 |
| Freshness — `postedAt` within 14 days (and not within 7) | +5 |
| **Penalty** — body US-centric without remote-worldwide language | **-10** |

**Drop** anything with `fitScore < 30` after the cap.

**Category** is derived from which signals fired: both web3 and AI → `web3+ai`; only web3 → `web3`; only AI → `ai`; neither → `general`.

### 4. Dedup (`src/dedup.ts`)

Two passes:

1. By `id` (URL hash).
2. By `sha1(normalize(company) + '|' + normalize(title))`.

When two jobs collide, the one with the higher `fitScore` wins. Ties are broken by source priority:

```
greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok
```

### 5. Render

`src/render.ts` produces `JOBS.md` with stats + four sorted tables: Top Web3+AI (10), Top Web3 (20), Top AI (20), Other (10). Each row is `Score | Title | Company | Source | Posted (relative) | Link`. The full sorted list also lands in `data/jobs.json`.

## Repo layout

```
job-hunt/
├── .github/workflows/
│   ├── jobs.yml              # daily cron + auto-commit
│   └── keepalive.yml         # weekly touch to keep cron alive
├── data/
│   ├── jobs.json             # output, committed daily
│   └── raw/                  # per-source raw JSON, gitignored
├── src/
│   ├── fetchers/             # one file per source
│   │   ├── remoteok.ts
│   │   ├── remotive.ts
│   │   ├── weworkremotely.ts
│   │   ├── cryptojobslist.ts
│   │   ├── web3career.ts
│   │   ├── aijobsnet.ts
│   │   ├── hn-hiring.ts
│   │   ├── hn-jobs.ts
│   │   └── greenhouse.ts
│   ├── types.ts              # Job, Source, Category, Raw* shapes
│   ├── utils.ts              # fetchWithTimeout, sha1, stripHtml, ...
│   ├── rss.ts                # shared fast-xml-parser wrapper
│   ├── normalize.ts          # one normalizer per source
│   ├── filters.ts            # hard excludes + scoring
│   ├── dedup.ts              # 2-pass dedup
│   ├── render.ts             # JOBS.md generator
│   └── index.ts              # orchestrator
├── biome.json
├── tsconfig.json
├── package.json
├── pnpm-lock.yaml
├── CLAUDE.md                 # guidance for future Claude Code sessions
├── JOBS.md                   # auto-generated daily output
└── README.md                 # this file
```

## Run locally

```bash
pnpm install                 # one-time
pnpm run dev                 # tsx, no build step
pnpm start                   # built output (run pnpm run build first)
pnpm run typecheck           # tsc --noEmit
pnpm run lint                # biome check
pnpm run lint:fix            # biome check --write
```

A run takes ~5-10 seconds and produces:

- `data/jobs.json` — full sorted list of jobs that survived filters + dedup
- `JOBS.md` — the four-section table
- `data/raw/<source>-<YYYY-MM-DD>.json` — per-source raw payload for debugging (gitignored)

## GitHub Actions

Two workflows in [`.github/workflows/`](./.github/workflows):

- **[`jobs.yml`](./.github/workflows/jobs.yml)** — runs daily at 07:00 UTC and on `workflow_dispatch`. Sets up Node 22 + pnpm 10, installs with frozen lockfile, builds, runs the aggregator, and auto-commits `data/jobs.json` + `JOBS.md` if anything changed (via `stefanzweifel/git-auto-commit-action@v5`).
- **[`keepalive.yml`](./.github/workflows/keepalive.yml)** — runs Sundays at 12:00 UTC, touches `.keepalive` with the current timestamp, commits. Prevents GitHub from auto-disabling the schedule after 60 days of repo inactivity.

To trigger a run manually: GitHub UI → Actions → jobs → Run workflow.

## Customization

### Adjust filter weights

Open [`src/filters.ts`](./src/filters.ts) and edit the `score += N` lines in `applyFilters`. Each weight is a single literal — no config file, no flags. Keep regexes word-bounded (`\b...\b`) and case-insensitive (`/.../i`).

### Change the tier-S Greenhouse list

Edit [`TIER_S_SLUGS`](./src/fetchers/greenhouse.ts) in `src/fetchers/greenhouse.ts`. The slug is the path segment in `boards-api.greenhouse.io/v1/boards/<slug>/jobs`. Slugs that 404 are logged and skipped silently.

### Add a new source

Detailed recipe in [`CLAUDE.md`](./CLAUDE.md#how-to-add-a-new-fetcher). Quick version:

1. Create `src/fetchers/<name>.ts` exporting `fetch<Name>(): Promise<Raw[]>`.
2. Add a `Raw<Name>` type to `src/types.ts` and a literal to the `Source` union.
3. Add `normalize<Name>` to `src/normalize.ts`.
4. Wire into `src/index.ts`'s `Promise.all` block.
5. Register in `SOURCE_PRIORITY` (`src/dedup.ts`) and `SOURCES` (`src/render.ts`).

## Known upstream issues (as of 2026-04)

These are currently affecting the data quality — they're documented here so they're discoverable when you wonder why a source is empty:

- **`cryptojobslist.com`** is fully Cloudflare-challenged for HTML and the `api.cryptojobslist.com/jobs.rss` endpoint currently returns an empty channel. The fetcher gracefully returns `[]` and will pick up jobs again if upstream restores the feed.
- **10 of the 14 starter Greenhouse slugs** (`linear`, `ramp`, `uniswaplabs`, `aave`, `chainlink`, `morpho`, `lifi`, `mysten-labs`, `magiceden`, `ledger`) are not on Greenhouse. They use Lever, Ashby, or custom ATSes. Add a Lever or Ashby fetcher if you want their listings.
- **`web3.career`** and **`aijobs.net`** removed RSS — both are now scraped from HTML via small inline regex parsers, which means a markup change upstream will silently degrade them. If a fetcher returns `0` for several days, eyeball the raw HTML for new selectors.

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
