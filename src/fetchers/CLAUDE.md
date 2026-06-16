# Fetcher invariants

Scoped guidance for `src/fetchers/`. Auto-loaded by Claude Code when working in this dir. For the **procedural** side (how to add a fetcher, tier-S slugs, known upstream issues), see the `pupila-fetchers` skill.

This file is **invariants only** — must-obey rules. Breaking any of these introduces a security hole, fails the orchestrator, or silently drops jobs. No exceptions.

---

## Hard invariants. Do not break.

### 1. Fetchers must never throw

A fetcher exports `fetch<Name>(): Promise<FetcherResult<Raw>>` → `{ items, errors }`. Catch every exception internally, push a description to `errors`, return the result. The orchestrator's `Promise.all` cannot recover from a rejection — a throw here kills the entire run.

### 2. Use the safe HTTP wrappers

All outbound HTTP goes through one of:

- `fetchWithTimeout(url, init)` — 30s timeout, 1 retry on 5xx/network. Lowest level.
- `fetchJson(url, init)` — wraps the above, parses JSON, returns typed value.
- `fetchText(url, init)` — wraps the above, returns body string.

All three live in `src/utils.ts`. Pass `JSON_HEADERS` for APIs, `RSS_HEADERS` for RSS endpoints (User-Agent matters — some hosts 403 generic UAs).

**Never** `fetch()` directly. **Never** roll your own timeout/retry — duplicates logic and skips the safety net.

### 3. Every scraped URL flows through `isSafeUrl`

Hard-drop rule #1 in `src/filters.ts` rejects URLs that aren't http/https. Don't bypass this gate by stuffing arbitrary protocols into a `Job.url`. If you need a non-http reference, put it in `Job.tags` or similar — not `url`.

### 4. Every scraped body flows through `stripHtml`

HTML scrapers must run their extracted body through `stripHtml` from `src/utils.ts` **before** any regex match or storage. Raw HTML in body bypasses filter regexes (script tags, attribute soup, encoded entities) and contaminates the AI-review prompt.

### 5. Multi-slug fetchers use `fetchMultiSlug`

`src/fetchers/_shared.ts` owns the `Promise.all` + per-slug try/catch + flatMap. The fetcher only owns per-slug extraction. **Don't reimplement the orchestration loop** — `ashby.ts`, `greenhouse.ts`, `lever.ts` are the canonical pattern. A new ATS fetcher that doesn't use `fetchMultiSlug` is a refactor target.

### 6. URL-encode path segments at the boundary

Slug names and similar user-controllable strings go through `encodeURIComponent` before being interpolated into a URL. The shared helpers handle this; if you're building a URL by hand (rare), do it yourself.

### 7. No user-controllable strings in HTML attributes

When building `JOBS.md` or RSS output that includes scraped content, use `escapeHtmlAttr` (in `src/render.ts`) / `escapeXml` (in `src/feed.ts`). Both are already wired through the existing render paths. **Don't** template-string raw values into attributes.

### 8. 404 slugs are logged and skipped silently

This is intentional — it's safe to leave a known-bad slug in `config/slugs.json` while waiting on upstream to restore. Don't add error-throwing for 404s.

### 9. ATS slug lists resolve through the personal overlay

The four multi-slug ATS fetchers (`ashby`, `greenhouse`, `lever`, `ashby-private`) build their board URLs via the shared encoded helpers in `src/lib/ats-endpoints.ts` and resolve their slug list at fetch time via `resolveSlugs(shipped, overlay)` from `src/lib/slugs.ts`. The effective list is the committed `config/slugs.json` baseline unioned with the gitignored `config/slugs.local.json` personal overlay, minus the overlay's removals. **Never write `config/slugs.json` from app code** — personal changes belong in the overlay (the UI's `/api/sources` endpoint writes only `slugs.local.json`).

---

## Security checklist for new fetchers / parsers

Run through this before opening a PR:

- [ ] Uses `fetchWithTimeout` / `fetchJson` / `fetchText`.
- [ ] All scraped URLs gated by `isSafeUrl` (orchestrator does this).
- [ ] All scraped bodies pass through `stripHtml` before regex/scoring.
- [ ] No raw template-string of scraped values into HTML/XML attributes.
- [ ] Fetcher catches internally; never throws.
- [ ] Multi-slug uses `fetchMultiSlug` from `_shared.ts`.
- [ ] If adding a tier-S source, slug appended to `config/slugs.json` (not hardcoded in the fetcher).

## Related

- **Procedural how-to:** `pupila-fetchers` skill (add a fetcher, tier-S slugs, upstream issues).
- `src/utils.ts` — the safe HTTP wrappers.
- `src/fetchers/_shared.ts` — `fetchMultiSlug` orchestration.
