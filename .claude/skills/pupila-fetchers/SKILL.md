---
name: pupila-fetchers
description: How to add a new job-source fetcher (ATS API, RSS, scraper) or extend tier-S slug lists in this repo. Use when adding a new job board, integrating a new ATS, scraping a new careers site, registering a new company under Ashby/Greenhouse/Lever, or diagnosing a fetcher that returned zero items.
metadata:
  scope: pupila
---

The pipeline ingests from 19 public sources (5 ATS APIs — Ashby, Greenhouse, Lever, Recruitee, Personio (XML) — plus RSS, JSON boards, HN, HTML scrapers, an Aave Next.js scraper, `ashby-private` for orgs whose public posting-API is disabled, `jobicy` and `himalayas` — no-key remote-jobs feeds, and `bluedoor` — a free cross-ATS aggregator queried by region from `profile.location`). Adding a source means: a fetcher, a normalizer, a `Source` literal, a slot in the orchestrator, and dedup/render wiring.

**Companion invariants:** `src/fetchers/CLAUDE.md` (auto-loaded when working in that dir) — security checklist + must-obey rules. Read those rules; this skill covers the procedural side.

## Add a new fetcher (mechanical checklist)

1. **Raw shape** in `src/types.ts` — `interface Raw<Name> { ... }`.
2. **Fetcher** at `src/fetchers/<name>.ts`, exporting `fetch<Name>(): Promise<FetcherResult<Raw>>` → `{ items, errors }`. **Never throw** — catch internally, push to `errors`.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `src/utils.ts` (30s timeout, 1 retry on 5xx/network).
   - Pass `JSON_HEADERS` or `RSS_HEADERS`.
   - For multi-slug fetchers, use `fetchMultiSlug` from `src/fetchers/_shared.ts` — it owns the `Promise.all` + per-slug try/catch + flatMap. The fetcher only owns per-slug extraction. Canonical examples: `ashby.ts`, `greenhouse.ts`, `lever.ts`.
3. **Canonical source name** — add the literal to the `SOURCES` **const tuple** in `src/types.ts` (single source of truth; `type Source` derives from it). This one edit cascades: the MCP `sourceEnum`, `KNOWN_SOURCES` in `src/lib/fetch-runner.ts`, and the UI fetch-progress panel (`ui/plugins/fetchJobs.ts`) all derive from it automatically — **don't** hand-edit those.
4. **Normalize** — add `normalize<Name>(items, fetchedAt): Job[]` to `src/normalize.ts`. Use `withSalary()` spread to populate `salary*` fields.
5. **Wire orchestrator** — `src/index.ts`: import + add a line in the `Promise.all` block via `processFetcher(...)`.
6. **Dedup priority** — add to `SOURCE_PRIORITY` in `src/dedup.ts` (ordered most → least trusted). Compile-enforced: `Record<Source, …>` fails to build if you skip it.
7. **Render** — add to the display-ordered `SOURCES` in `src/render.ts` so by-source counts appear in `JOBS.md`. Compile-enforced: the `satisfies` + exhaustiveness guard below the array fails to build if you skip it.
8. **UI client mirror** — add the literal to the `Source` union in `ui/src/types.ts` (a deliberate mirror that must NOT import from `src/*`). Guarded by `tests/source-lists.test.ts`, which fails if it drifts from the canonical tuple.
9. **Tests** — at least one parser test in `tests/` for HTML scrapers. Use existing files (`aave.test.ts`, `ashby-private.test.ts`, `normalize-hn.test.ts`, `bluedoor.test.ts`) as templates.

> **Source lists are guarded, not duplicated.** After step 3, steps 6–8 are the only other places that need a manual entry, and every one fails the build or a test if you forget — see `tests/source-lists.test.ts` and the guards in `src/render.ts` / `src/dedup.ts`. You can't silently half-wire a source anymore.

### Smoke-test before wiring

```bash
npx tsx -e "import('./src/fetchers/<name>.ts').then(async m => { const r = await m.fetch<Name>(); console.log('count:', r.items.length, 'errors:', r.errors, 'first:', r.items[0]); })"
```

If items are 0, eyeball the upstream response — RSS/HTML markup changes silently break parsers.

## Add a tier-S company

All slug arrays live in `config/slugs.json` (non-code edit). Identify the ATS, then append to the matching JSON key. (Personal, non-shipped picks instead go to the gitignored `config/slugs.local.json` overlay — the UI writes those.)

> **Automated discovery (UI):** Settings → Job sources → **Discover more sources for my profile** runs the user's LLM CLI to propose companies from `profile.json` + `candidate-brief.md`, live-probes each against the 5 REST/XML ATSes, ranks by matching roles, and adds the accepted picks to the overlay. Code in `src/lib/company-discovery.ts` (+ `POST /api/sources/discover`). It never invents slugs into `slugs.json` — everything is probe-verified and overlay-only.

| ATS | JSON key | URL pattern (slug location) |
|---|---|---|
| Ashby (public posting API) | `ashby` | `jobs.ashbyhq.com/<slug>` |
| Greenhouse | `greenhouse` | `boards.greenhouse.io/<slug>` |
| Lever | `lever` | `jobs.lever.co/<slug>` |
| Recruitee | `recruitee` | `<slug>.recruitee.com` — slug is the careers *subdomain*, often differs from any custom careers domain |
| Personio | `personio` | `<slug>.jobs.personio.de` — XML feed; no salary/URL in feed (URL rebuilt from slug + id) |
| Ashby (private GraphQL) | `ashbyPrivate` | `jobs.ashbyhq.com/<slug>` loads in browser but public API returns 404 |

The `TIER_S_*_SLUGS` exports in fetcher files are thin re-exports of the JSON. Recruitee slugs are discovered by trial — most customers use custom careers domains, so the brand name rarely equals the `<slug>.recruitee.com` subdomain (verified seeds: `bunq`, `apside`).

### Probe before adding

```bash
curl -sI "https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"
curl -sI "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs"
curl -sI "https://api.lever.co/v0/postings/<slug>?mode=json"
curl -s "https://<slug>.recruitee.com/api/offers/" | head -c 200   # {"offers":[...]} = live
curl -s "https://<slug>.jobs.personio.de/xml?language=en" | grep -c '<position>'   # >0 = live
```

404s are logged and skipped silently — it's safe to leave a known-bad slug while waiting on upstream.

### If no public ATS matches

1. Try `https://jobs.ashbyhq.com/<slug>` in a browser. If the board loads, append the slug to `config/slugs.json#ashbyPrivate` (graphQL endpoint scrape — `src/fetchers/ashby-private.ts` handles it).
2. Otherwise it's a custom ATS → per-company HTML scraper. Use `src/fetchers/aave.ts` (Next.js `__NEXT_DATA__` extraction) as the canonical example.

## Source-priority order (current)

`aave = ashby-private > ashby > lever > greenhouse > recruitee > personio > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok > jobicy > himalayas > remoteyeah > bluedoor`

Used by dedup tiebreaker. Newly-added sources slot in based on data quality + ATS reliability. `bluedoor` is **lowest** on purpose: it re-carries many curated-ATS jobs, so on any company+title overlap the dedicated fetcher must win.

## bluedoor (cross-ATS aggregator)

`src/fetchers/bluedoor.ts` is structurally unlike the others — it's a free API over ~1.6M postings across 31 ATS providers, driven entirely by `profile.location` (no hardcoded geography, so it's forkable). Key invariants discovered against the live API:

- **Region fan-out, no `q`/`workplace_type` filter.** One `location_text=` query per `acceptedRegions ∪ basedIn` term. `q` is an AND/phrase match (multi-term → 0 hits) and `workplace_type` is null on ~30% of records, so filtering on it drops genuinely-remote jobs. Work-type/role relevance is decided downstream by the persona-neutral filter.
- **Anonymous rate limit is 15 requests/window** (`x-rate-limit-tier: anonymous`). `fetchBluedoor` caps at 12 region queries; `BLUEDOOR_API_KEY` (free, email-OTP) raises the ceiling (`KEYED_MAX_REQUESTS`).
- **30-day `posted_after` window** so infrequent runs don't miss jobs; `limit=100` (API max) + a 2-page cap bound even huge regions (US `location_text` matches 600k+ all-time → tens with the window).
- **No company name shipped** — only `org_id` (UUID) + `provider`. `parseAtsUrl()` recovers the employer from the ATS slug in the URL (so it matches curated fetchers for dedup); falls back to `org_id` so different employers never collapse in company+title dedup.
- **Covered-company pre-skip:** `buildCoveredSlugs(slugs.json)` + `isCoveredCompany()` drop jobs whose `(provider, slug)` is already fetched directly — automatic, no extra config.

## Known upstream issues

See [`references/upstream-issues.md`](references/upstream-issues.md) — current breakage list, kept current. Check before debugging "why is X returning 0".

## Related

- `src/fetchers/CLAUDE.md` — security checklist + invariants (auto-loaded when editing in that dir).
- `tests/` — parser-test patterns for HTML scrapers.
