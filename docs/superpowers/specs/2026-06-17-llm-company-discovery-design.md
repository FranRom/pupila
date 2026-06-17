# LLM-driven company discovery

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

Curating ATS company slugs (`config/slugs.json` / `config/slugs.local.json`) is
manual. To find relevant employers a user has to know company names, guess their
ATS slug, probe each board by hand, and eyeball whether the open roles match what
they want — exactly the process we ran by hand to seed 45 companies.

We want to automate that: a one-click **"Discover for my profile"** action that
uses the user's own LLM to propose companies, verifies them live, ranks them by
how well their open roles fit the user's profile, and lets the user accept the
ones they want into their personal slug overlay.

## Goals

- Reuse the user's configured LLM CLI (`src/lib/llm.ts` — claude/codex/gemini/
  opencode), no API key, no external paid service.
- Ground suggestions in the user's existing config: `config/profile.json`
  (categories + keyword lists) and `config/candidate-brief.md`.
- **Never** add an unverified slug: every suggestion is live-probed against the
  real ATS before being shown.
- Rank suggestions by **relevance** — how many of a board's open roles match the
  user's profile — not just by board existence.
- Human-in-the-loop: discovery only *suggests*; the user selects what to add.
- Writes only to the gitignored `config/slugs.local.json` overlay, via the
  existing add path. App code never writes `config/slugs.json`.

## Non-goals (YAGNI for v1)

- No CLI command or MCP tool. UI button only. (The core is a library, so a CLI/
  MCP wrapper is a later, trivial add if wanted.)
- No auto-accept / scheduled discovery. User-initiated only.
- No mining of already-fetched aggregator data. LLM-driven discovery only (this
  is what the user asked for; data-mining can be a future complementary source).
- No full normalize+score pipeline per candidate — a lightweight title-keyword
  relevance score is enough for ranking (see Relevance scoring).

## Architecture

```
Settings → Job sources → [✨ Discover for my profile]
   │  POST /api/sources/discover            (ui/plugins/sources.ts middleware)
   ▼
discoverCompanies(profile, brief)           (src/lib/company-discovery.ts)
   1. buildDiscoveryPrompt(profile, brief)  → prompt text
   2. runLlm(prompt)                         (src/lib/llm.ts, user's CLI)
   3. parseCandidates(rawLlmText)            → Candidate[] (fence-tolerant JSON)
   4. for each candidate (bounded, concurrent):
        resolveSlug()  → slug variants
        probeSlug()    (src/lib/source-probe.ts) → live? which ATS?
        fetchBoardTitles(ats, slug)          → string[]
        scoreRoles(titles, profile)          → { matchCount, sampleTitles }
   5. drop already-curated, drop non-live, rank by matchCount
   ▼
returns Suggestion[]  → UI checklist → user selects
   │  PUT /api/sources  (EXISTING overlay-add path, per ATS)
   ▼
config/slugs.local.json
```

### New / changed components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/company-discovery.ts` *(new)* | Orchestrate prompt → LLM → parse → verify → score → rank. The whole pipeline, testable with injected LLM + fetch. | `llm.ts`, `source-probe.ts`, `ats-endpoints.ts`, profile keywords |
| `fetchBoardTitles(ats, slug)` *(new, exported from `company-discovery.ts`)* | Fetch one board and extract role titles per ATS (ashby/gh `jobs[].title`, lever `[].text`, recruitee `offers[].title`, personio `<position><name>`). | `ats-endpoints.ts`, `utils.ts`, `rss.ts` (personio) |
| `scoreRoles(titles, profile)` *(new, pure)* | Count titles matching the profile's positive keyword lists; exclude junior; return matched count + samples. | profile keyword lists |
| `POST /api/sources/discover` *(new endpoint in `ui/plugins/sources.ts`)* | Thin server route: load profile+brief, call `discoverCompanies`, return `Suggestion[]`. | `company-discovery.ts` |
| `SourcesPanel.tsx` + `lib/api` *(changed)* | "Discover for my profile" button, suggestions checklist, "Add selected" → reuse existing per-ATS `PUT /api/sources`. | existing api client |

No new write path: discovery is **read-only**; accepting reuses the existing
`PUT /api/sources` overlay-add (which already validates slugs via `sanitizeDelta`).

## Data shapes

```ts
// What the LLM is asked to return (strict JSON array).
interface Candidate {
  name: string;          // company name
  ats?: AtsKey;          // LLM's best guess (optional; we verify regardless)
  slug?: string;         // LLM's best-guess slug (optional)
  why?: string;          // one line: why it fits the profile (shown as tooltip)
}

// What the endpoint returns to the UI.
interface Suggestion {
  name: string;
  ats: AtsKey;           // the ATS where it was actually found live
  slug: string;          // the verified slug
  matchCount: number;    // # open roles matching the profile
  totalRoles: number;    // total open roles on the board
  sampleTitles: string[];// up to ~4 matching titles, for the UI
  why?: string;          // from the LLM
}
// Response: { suggestions: Suggestion[], proposed: number, verified: number, llm: string, errors: string[] }
```

## Key design decisions

### Slug resolution (LLMs know names, not slugs)
The LLM's `slug` guess is unreliable (`aleph-alpha` vs `alephalpha`). `resolveSlug`
generates a small ordered set of variants from `name`/`slug`: the LLM guess,
lowercased name with spaces removed, hyphenated, and de-hyphenated — deduped,
each validated by `SLUG_PATTERN`. Probe order: the LLM's stated `ats` first
(cheapest hit), then fan out to the other ATSes only if it misses. First live hit
wins; remaining variants/ATSes are skipped.

### Relevance scoring (approach B, approved)
For each live board we fetch titles and count how many match the user's profile.
v1 uses a **title-keyword** match against the profile's positive keyword lists
(the same `config/profile.json#keywords`/`categories` keyword arrays the filter
already uses), minus junior-excluded titles. This mirrors the manual process and
keeps discovery decoupled from the full normalize+filter chain. `matchCount`
drives the ranking; `totalRoles` and `sampleTitles` give the user context.
A board with 0 matches is still shown (ranked last) but visually de-emphasized.

### Bounding cost
Discovery is user-initiated and parallel (like the existing "Check board health"),
but bounded: cap candidates considered (e.g. first 25 from the LLM), cap slug
variants per candidate (≤4), short-circuit on first live hit, and reuse the
`fetchWithTimeout` 30s/1-retry safety net. The endpoint reports `proposed` vs
`verified` so nothing is silently dropped.

### Prompt
`buildDiscoveryPrompt` states the supported ATSes, summarizes the user's target
roles from `profile.json` (category names + key positive keywords) and
`candidate-brief.md`, lists the already-curated companies to **exclude**, and
asks for strict JSON `Candidate[]` (no prose, fence-tolerant parse reusing the
same approach as `ai-review-parse.ts`).

## Error handling

- No LLM CLI on PATH → endpoint returns a clear error (reuse `detectLlmCli`'s
  message); UI shows it inline (same pattern as other Settings errors).
- LLM returns unparseable / non-JSON → return `{ suggestions: [], errors: [...] }`,
  don't throw.
- Individual probe/fetch failures → that candidate is dropped with a note in
  `errors`; the rest proceed (never throw out of the batch).
- Empty profile/brief → endpoint returns an error telling the user to set up
  their profile first (discovery is meaningless without target roles).

## Testing

- `scoreRoles` — pure unit tests: matching/non-matching/junior titles, samples.
- `resolveSlug` — variant generation + `SLUG_PATTERN` validation.
- `parseCandidates` — fence-wrapped JSON, garbage, partial objects.
- `discoverCompanies` — integration with **injected** `runLlm` + `fetch` (mock):
  proposed→verified→ranked path, already-curated exclusion, dedup across ATSes,
  error aggregation. (Mirrors the existing hook/fetch-mock test style.)
- UI: `SourcesPanel` discover flow — button → suggestions render → select → add
  calls the existing PUT. (jsdom, mock fetch, per `ui/CLAUDE.md` test rules.)

## Open questions

None blocking. Future enhancements (out of scope): data-mining discovery source,
CLI/MCP wrappers, scheduled auto-discovery.
