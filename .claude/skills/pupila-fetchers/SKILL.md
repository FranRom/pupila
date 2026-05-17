---
name: pupila-fetchers
description: How to add a new job-source fetcher (ATS API, RSS, scraper) or extend tier-S slug lists in this repo. Use when adding a new job board, integrating a new ATS, scraping a new careers site, registering a new company under Ashby/Greenhouse/Lever, or diagnosing a fetcher that returned zero items.
metadata:
  scope: pupila / job-hunt
---

The pipeline ingests from 13 public sources (3 ATS APIs + RSS, JSON boards, HN, HTML scrapers, an Aave Next.js scraper, and `ashby-private` for orgs whose public posting-API is disabled). Adding a source means: a fetcher, a normalizer, a `Source` literal, a slot in the orchestrator, and dedup/render wiring.

**Companion invariants:** `src/fetchers/CLAUDE.md` (auto-loaded when working in that dir) — security checklist + must-obey rules. Read those rules; this skill covers the procedural side.

## Add a new fetcher (mechanical checklist)

1. **Raw shape** in `src/types.ts` — `interface Raw<Name> { ... }`.
2. **Fetcher** at `src/fetchers/<name>.ts`, exporting `fetch<Name>(): Promise<FetcherResult<Raw>>` → `{ items, errors }`. **Never throw** — catch internally, push to `errors`.
   - Use `fetchWithTimeout` / `fetchJson` / `fetchText` from `src/utils.ts` (30s timeout, 1 retry on 5xx/network).
   - Pass `JSON_HEADERS` or `RSS_HEADERS`.
   - For multi-slug fetchers, use `fetchMultiSlug` from `src/fetchers/_shared.ts` — it owns the `Promise.all` + per-slug try/catch + flatMap. The fetcher only owns per-slug extraction. Canonical examples: `ashby.ts`, `greenhouse.ts`, `lever.ts`.
3. **Source union** — add the literal name to `Source` in `src/types.ts`.
4. **Normalize** — add `normalize<Name>(items, fetchedAt): Job[]` to `src/normalize.ts`. Use `withSalary()` spread to populate `salary*` fields.
5. **Wire orchestrator** — `src/index.ts`: import + add a line in the `Promise.all` block via `processFetcher(...)`.
6. **Dedup priority** — add to `SOURCE_PRIORITY` in `src/dedup.ts` (ordered most → least trusted).
7. **Render** — add to `SOURCES` in `src/render.ts` so by-source counts appear in `JOBS.md`.
8. **Tests** — at least one parser test in `tests/` for HTML scrapers. Use existing files (`aave.test.ts`, `ashby-private.test.ts`, `normalize-hn.test.ts`) as templates.

### Smoke-test before wiring

```bash
npx tsx -e "import('./src/fetchers/<name>.ts').then(async m => { const r = await m.fetch<Name>(); console.log('count:', r.items.length, 'errors:', r.errors, 'first:', r.items[0]); })"
```

If items are 0, eyeball the upstream response — RSS/HTML markup changes silently break parsers.

## Add a tier-S company

All slug arrays live in `config/slugs.json` (non-code edit). Identify the ATS, then append to the matching JSON key.

| ATS | JSON key | URL pattern (slug location) |
|---|---|---|
| Ashby (public posting API) | `ashby` | `jobs.ashbyhq.com/<slug>` |
| Greenhouse | `greenhouse` | `boards.greenhouse.io/<slug>` |
| Lever | `lever` | `jobs.lever.co/<slug>` |
| Ashby (private GraphQL) | `ashbyPrivate` | `jobs.ashbyhq.com/<slug>` loads in browser but public API returns 404 |

The `TIER_S_*_SLUGS` exports in fetcher files are thin re-exports of the JSON.

### Probe before adding

```bash
curl -sI "https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"
curl -sI "https://boards-api.greenhouse.io/v1/boards/<slug>/jobs"
curl -sI "https://api.lever.co/v0/postings/<slug>?mode=json"
```

404s are logged and skipped silently — it's safe to leave a known-bad slug while waiting on upstream.

### If no public ATS matches

1. Try `https://jobs.ashbyhq.com/<slug>` in a browser. If the board loads, append the slug to `config/slugs.json#ashbyPrivate` (graphQL endpoint scrape — `src/fetchers/ashby-private.ts` handles it).
2. Otherwise it's a custom ATS → per-company HTML scraper. Use `src/fetchers/aave.ts` (Next.js `__NEXT_DATA__` extraction) as the canonical example.

## Source-priority order (current)

`aave = ashby-private > ashby > lever > greenhouse > cryptojobslist > web3career > aijobsnet > hn-hiring > hn-jobs > remotive > weworkremotely > remoteok`

Used by dedup tiebreaker. Newly-added sources slot in based on data quality + ATS reliability.

## Known upstream issues

See [`references/upstream-issues.md`](references/upstream-issues.md) — current breakage list, kept current. Check before debugging "why is X returning 0".

## Related

- `src/fetchers/CLAUDE.md` — security checklist + invariants (auto-loaded when editing in that dir).
- `tests/` — parser-test patterns for HTML scrapers.
