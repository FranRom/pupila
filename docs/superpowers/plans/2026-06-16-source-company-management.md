# Source / Company Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add or remove individual company boards for the multi-slug ATS sources (Ashby, Greenhouse, Lever, Ashby-private) from a new Settings panel, persisted to a gitignored overlay so the shipped tier-S list stays clean and keeps tracking upstream.

**Architecture:** A gitignored `config/slugs.local.json` overlay stores **deltas** per ATS - `{ add: [...], remove: [...] }`. At fetch time, each ATS fetcher computes its effective slug list = `(shipped ∪ add) \ remove` via a new pure resolver (`src/lib/slugs.ts`). The UI Settings tab gets a "Job sources" panel that reads/writes the overlay through a new Vite middleware plugin (`/api/sources`), with an optional live "verify" probe (`/api/sources/verify`) that hits the real ATS board and reports how many roles a slug currently exposes. Shipped slugs (`config/slugs.json`) are never written by the app, so upstream updates flow through and a user's personal picks are additive deltas on top.

**Tech Stack:** Node 22 / TypeScript (NodeNext, ESM), Vitest 4, Vite dev-server middleware plugins, React 19, CSS Modules, the typed `api` client (`ui/src/lib/api/`). No new runtime dependencies.

**Out of scope (explicitly):** Toggling whole aggregator sources on/off (remoteok, web3career, bluedoor, etc.) is a separate, coarser feature and is NOT part of this plan. This plan only covers per-company management for the four multi-slug ATS sources.

---

## File Structure

**New files:**
- `src/lib/slugs.ts` - pure overlay model: `AtsKey`, `SlugDelta`, `SlugOverlay`, `isValidSlug`, `resolveSlugs`, `sanitizeDelta`, `sanitizeOverlay`, `loadSlugOverlay`.
- `src/lib/ats-endpoints.ts` - encoded board-URL builders for the 3 public ATS, shared by fetchers + probe.
- `src/lib/source-probe.ts` - live "does this slug exist / how many roles" probe for the verify endpoint.
- `tests/slugs.test.ts` - unit tests for `slugs.ts`.
- `tests/ats-endpoints.test.ts` - unit tests for URL encoding.
- `ui/plugins/sources.ts` - `/api/sources` (GET/PUT) + `/api/sources/verify` (POST) middleware.
- `ui/src/settings/SourcesPanel.tsx` - the new Settings panel.
- `ui/src/settings/SourcesPanel.module.css` - co-located styles.
- `ui/src/settings/SourcesPanel.test.tsx` - component test for add/remove delta logic.

**Modified files:**
- `src/fetchers/ashby.ts`, `src/fetchers/greenhouse.ts`, `src/fetchers/lever.ts`, `src/fetchers/ashby-private.ts` - consume effective slugs + shared encoded URLs; drop the now-unused `TIER_S_*` exports.
- `.gitignore` - add `config/slugs.local.json`.
- `config/slugs.json` - extend the `_comment` to mention the overlay.
- `src/fetchers/CLAUDE.md` - note overlay resolution + that board URLs encode the slug.
- `ui/plugins/_paths.ts` - add `SLUGS_LOCAL_PATH`.
- `ui/vite.config.ts` - register `sourcesApiPlugin()`.
- `ui/src/lib/api/index.ts` - add `SourcesResponse` / `VerifyResponse` types + `api.sources` namespace.
- `ui/src/Settings.tsx` - load sources, render `<SourcesPanel>`, wire save + verify callbacks.

---

## Task 1: Core slug-overlay model (`src/lib/slugs.ts`)

**Files:**
- Create: `src/lib/slugs.ts`
- Test: `tests/slugs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/slugs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ATS_KEYS,
  isValidSlug,
  resolveSlugs,
  sanitizeDelta,
  sanitizeOverlay,
} from '../src/lib/slugs.js';

describe('isValidSlug', () => {
  it('accepts real ATS slugs', () => {
    for (const s of ['linear', 'polygon-labs', 'li.fi', 'monad.foundation', 'chainlink-labs']) {
      expect(isValidSlug(s)).toBe(true);
    }
  });
  it('rejects injection / junk', () => {
    for (const s of ['', ' ', 'a/b', '../etc', 'Foo', 'a?x=1', 'a b', 'a#b', 123, null, undefined]) {
      expect(isValidSlug(s as unknown)).toBe(false);
    }
  });
  it('rejects over-long slugs', () => {
    expect(isValidSlug('a'.repeat(101))).toBe(false);
  });
});

describe('resolveSlugs', () => {
  const base = ['linear', 'ramp', 'uniswap'];
  it('returns base unchanged with no delta', () => {
    expect(resolveSlugs(base, undefined)).toEqual(base);
  });
  it('appends additions after base, preserving order', () => {
    expect(resolveSlugs(base, { add: ['stripe'], remove: [] })).toEqual([
      'linear',
      'ramp',
      'uniswap',
      'stripe',
    ]);
  });
  it('drops removed shipped slugs', () => {
    expect(resolveSlugs(base, { add: [], remove: ['uniswap'] })).toEqual(['linear', 'ramp']);
  });
  it('dedupes when an addition duplicates a shipped slug', () => {
    expect(resolveSlugs(base, { add: ['ramp'], remove: [] })).toEqual(base);
  });
});

describe('sanitizeDelta', () => {
  it('filters invalid slugs and dedupes', () => {
    expect(sanitizeDelta({ add: ['stripe', 'stripe', 'BAD/x', 5], remove: ['uniswap', ''] })).toEqual({
      add: ['stripe'],
      remove: ['uniswap'],
    });
  });
  it('lets add win over remove for the same slug', () => {
    expect(sanitizeDelta({ add: ['ramp'], remove: ['ramp'] })).toEqual({
      add: ['ramp'],
      remove: [],
    });
  });
  it('coerces missing fields to empty arrays', () => {
    expect(sanitizeDelta({})).toEqual({ add: [], remove: [] });
    expect(sanitizeDelta(null)).toEqual({ add: [], remove: [] });
  });
});

describe('sanitizeOverlay', () => {
  it('keeps only known ATS keys with non-empty deltas', () => {
    const overlay = sanitizeOverlay({
      ashby: { add: ['stripe'], remove: [] },
      greenhouse: { add: [], remove: [] },
      bogus: { add: ['x'], remove: [] },
    });
    expect(overlay).toEqual({ ashby: { add: ['stripe'], remove: [] } });
    expect(ATS_KEYS).toContain('ashbyPrivate');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/slugs.test.ts`
Expected: FAIL - `Cannot find module '../src/lib/slugs.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/slugs.ts`:

```ts
// Personal overlay on top of the shipped tier-S slug lists (config/slugs.json).
//
// config/slugs.json is committed + shared (the curated tier-S boards). Personal
// add/remove choices live in config/slugs.local.json (gitignored), stored as a
// per-ATS DELTA so upstream additions to slugs.json keep flowing through and the
// user's picks stay separate. Effective list = (shipped ∪ add) \ remove.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keys match config/slugs.json (camelCase ashbyPrivate), NOT the Source ids.
export const ATS_KEYS = ['ashby', 'greenhouse', 'lever', 'ashbyPrivate'] as const;
export type AtsKey = (typeof ATS_KEYS)[number];

// Public ATS slugs are lowercase and use letters, digits, dot, dash, underscore
// (e.g. "polygon-labs", "li.fi", "monad.foundation"). The pattern doubles as an
// injection guard: these strings are interpolated into ATS board URLs.
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_SLUG_LENGTH = 100;

export interface SlugDelta {
  add: string[];
  remove: string[];
}
export type SlugOverlay = Partial<Record<AtsKey, SlugDelta>>;

// src/lib/slugs.ts → ../../ reaches the repo root.
const DEFAULT_SLUGS_LOCAL_PATH = fileURLToPath(
  new URL('../../config/slugs.local.json', import.meta.url),
);

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

// Effective list: shipped first (original order), then additions, deduped, with
// removals filtered out. Stable ordering keeps JOBS.md / dedup deterministic.
export function resolveSlugs(base: readonly string[], delta: SlugDelta | undefined): string[] {
  const removed = new Set(delta?.remove ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of [...base, ...(delta?.add ?? [])]) {
    if (removed.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function cleanSlugList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (isValidSlug(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// Validate one ATS delta. `add` wins over `remove` for the same slug so a
// re-added shipped slug never lands in both lists.
export function sanitizeDelta(raw: unknown): SlugDelta {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const add = cleanSlugList(obj.add);
  const addSet = new Set(add);
  const remove = cleanSlugList(obj.remove).filter((s) => !addSet.has(s));
  return { add, remove };
}

export function sanitizeOverlay(raw: unknown): SlugOverlay {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const overlay: SlugOverlay = {};
  for (const key of ATS_KEYS) {
    const delta = sanitizeDelta(obj[key]);
    if (delta.add.length || delta.remove.length) overlay[key] = delta;
  }
  return overlay;
}

// Reads config/slugs.local.json. Missing / unparseable → empty overlay (so a
// fresh clone with no personal overlay just uses the shipped lists).
export async function loadSlugOverlay(
  overlayPath: string = DEFAULT_SLUGS_LOCAL_PATH,
): Promise<SlugOverlay> {
  try {
    const raw = await readFile(overlayPath, 'utf8');
    return sanitizeOverlay(JSON.parse(raw));
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/slugs.test.ts`
Expected: PASS - all cases green.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/lib/slugs.ts tests/slugs.test.ts
git commit -m "feat(sources): slug-overlay model for per-company ATS config"
```

---

## Task 2: Shared encoded board-URL builders (`src/lib/ats-endpoints.ts`)

**Why:** The current fetchers interpolate the slug into the board URL **without** `encodeURIComponent` (`src/fetchers/ashby.ts:8`, `greenhouse.ts:8`, `lever.ts:8`). Safe today because slugs are hand-curated; unsafe once users can type them. Centralizing the encoded URL builders makes them testable and lets the verify probe (Task 5) reuse the exact same URLs the fetchers hit.

**Files:**
- Create: `src/lib/ats-endpoints.ts`
- Test: `tests/ats-endpoints.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ats-endpoints.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ashbyBoardUrl, greenhouseBoardUrl, leverBoardUrl } from '../src/lib/ats-endpoints.js';

describe('ATS board URLs', () => {
  it('leaves valid slugs untouched', () => {
    expect(ashbyBoardUrl('linear')).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true',
    );
    expect(greenhouseBoardUrl('anthropic')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true',
    );
    expect(leverBoardUrl('ledger')).toBe('https://api.lever.co/v0/postings/ledger?mode=json');
  });
  it('preserves dotted/dashed slugs', () => {
    expect(ashbyBoardUrl('monad.foundation')).toContain('/job-board/monad.foundation?');
  });
  it('encodes path-breaking characters', () => {
    expect(ashbyBoardUrl('a/b')).toContain('/job-board/a%2Fb?');
    expect(greenhouseBoardUrl('a b')).toContain('/boards/a%20b/jobs');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/ats-endpoints.test.ts`
Expected: FAIL - `Cannot find module '../src/lib/ats-endpoints.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ats-endpoints.ts`:

```ts
// Canonical board-URL builders for the public ATS APIs. The slug is
// encodeURIComponent'd at this single boundary so neither the fetchers nor the
// verify probe can be slug-injected. Valid slugs (see SLUG_PATTERN in slugs.ts)
// pass through unchanged because encodeURIComponent leaves [a-z0-9._-] alone.

export const ashbyBoardUrl = (slug: string): string =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;

export const greenhouseBoardUrl = (slug: string): string =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;

export const leverBoardUrl = (slug: string): string =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/ats-endpoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ats-endpoints.ts tests/ats-endpoints.test.ts
git commit -m "feat(fetchers): shared encoded ATS board-URL builders"
```

---

## Task 3: Wire the four ATS fetchers to effective slugs

**Files:**
- Modify: `src/fetchers/ashby.ts`
- Modify: `src/fetchers/greenhouse.ts`
- Modify: `src/fetchers/lever.ts`
- Modify: `src/fetchers/ashby-private.ts`

> Note: `grep` confirmed the `TIER_S_*_SLUGS` exports are not imported anywhere outside their own fetcher files, so removing them is safe.

- [ ] **Step 1: Rewrite `src/fetchers/ashby.ts`**

Replace the entire file with:

```ts
import slugs from '../../config/slugs.json' with { type: 'json' };
import { ashbyBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawAshbyJob, RawAshbyJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

interface BoardResponse {
  jobs: RawAshbyJob[];
  apiVersion?: string;
}

export async function fetchAshby(): Promise<FetcherResult<RawAshbyJobWithSlug>> {
  const slugList = resolveSlugs(slugs.ashby, (await loadSlugOverlay()).ashby);
  return fetchMultiSlug('ashby', slugList, async (slug) => {
    const data = await fetchJson<BoardResponse>(ashbyBoardUrl(slug), { headers: JSON_HEADERS });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
```

- [ ] **Step 2: Rewrite `src/fetchers/greenhouse.ts`**

Replace the entire file with:

```ts
import slugs from '../../config/slugs.json' with { type: 'json' };
import { greenhouseBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawGreenhouseJob, RawGreenhouseJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

interface BoardResponse {
  jobs: RawGreenhouseJob[];
  meta?: { total?: number };
}

export async function fetchGreenhouse(): Promise<FetcherResult<RawGreenhouseJobWithSlug>> {
  const slugList = resolveSlugs(slugs.greenhouse, (await loadSlugOverlay()).greenhouse);
  return fetchMultiSlug('greenhouse', slugList, async (slug) => {
    const data = await fetchJson<BoardResponse>(greenhouseBoardUrl(slug), { headers: JSON_HEADERS });
    return (data.jobs ?? []).map((j) => ({ ...j, __slug: slug }));
  });
}
```

- [ ] **Step 3: Rewrite `src/fetchers/lever.ts`**

Replace the entire file with:

```ts
import slugs from '../../config/slugs.json' with { type: 'json' };
import { leverBoardUrl } from '../lib/ats-endpoints.js';
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type { FetcherResult, RawLeverJob, RawLeverJobWithSlug } from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
import { fetchMultiSlug } from './_shared.js';

export async function fetchLever(): Promise<FetcherResult<RawLeverJobWithSlug>> {
  const slugList = resolveSlugs(slugs.lever, (await loadSlugOverlay()).lever);
  return fetchMultiSlug('lever', slugList, async (slug) => {
    const data = await fetchJson<RawLeverJob[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    if (!Array.isArray(data)) throw new Error('response not an array');
    return data.map((j) => ({ ...j, __slug: slug }));
  });
}
```

- [ ] **Step 4: Modify `src/fetchers/ashby-private.ts`**

Change the import block at the top (lines 1-11) from:

```ts
import slugs from '../../config/slugs.json' with { type: 'json' };
import type {
  FetcherResult,
  RawAshbyPrivateBrief,
  RawAshbyPrivateDetail,
  RawAshbyPrivateJob,
  RawAshbyPrivateJobWithSlug,
} from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export const TIER_S_ASHBY_PRIVATE_SLUGS: readonly string[] = slugs.ashbyPrivate;
```

to:

```ts
import slugs from '../../config/slugs.json' with { type: 'json' };
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type {
  FetcherResult,
  RawAshbyPrivateBrief,
  RawAshbyPrivateDetail,
  RawAshbyPrivateJob,
  RawAshbyPrivateJobWithSlug,
} from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';
```

Then change the `fetchAshbyPrivate` function (lines 90-104) from:

```ts
export async function fetchAshbyPrivate(): Promise<FetcherResult<RawAshbyPrivateJobWithSlug>> {
  const results = await Promise.all(
    TIER_S_ASHBY_PRIVATE_SLUGS.map(async (slug) => {
```

to:

```ts
export async function fetchAshbyPrivate(): Promise<FetcherResult<RawAshbyPrivateJobWithSlug>> {
  const slugList = resolveSlugs(slugs.ashbyPrivate, (await loadSlugOverlay()).ashbyPrivate);
  const results = await Promise.all(
    slugList.map(async (slug) => {
```

(Leave the rest of `fetchAshbyPrivate` and the GraphQL helpers unchanged. The Ashby-private GraphQL queries already pass the slug as a typed variable, not via string interpolation, so no URL-encoding change is needed there.)

- [ ] **Step 5: Typecheck, lint, run full backend tests**

Run: `pnpm run typecheck && pnpm run lint && pnpm exec vitest run tests/`
Expected: typecheck clean (no dangling `TIER_S_*` references), lint clean, all existing backend tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fetchers/ashby.ts src/fetchers/greenhouse.ts src/fetchers/lever.ts src/fetchers/ashby-private.ts
git commit -m "feat(fetchers): resolve ATS slugs through the personal overlay"
```

---

## Task 4: Gitignore overlay + doc touch-ups

**Files:**
- Modify: `.gitignore`
- Modify: `config/slugs.json` (comment only)
- Modify: `src/fetchers/CLAUDE.md`

- [ ] **Step 1: Add the overlay to `.gitignore`**

After the line `config/profile.json` (line 14), add:

```
config/slugs.local.json
```

- [ ] **Step 2: Extend the `config/slugs.json` comment**

Change the `_comment` value (line 2) to:

```json
  "_comment": "Tier-S company slugs to scrape from each ATS. Slugs are public ATS URLs (jobs.ashbyhq.com/<slug>, boards.greenhouse.io/<slug>, jobs.lever.co/<slug>) - find them by browsing the boards. 404s are silently skipped, so trial-and-error is safe. This file is the committed, shared baseline; personal add/remove choices live in the gitignored config/slugs.local.json overlay (edit via the UI Settings → Job sources panel). Effective list per ATS = (shipped ∪ overlay.add) minus overlay.remove.",
```

- [ ] **Step 3: Note the overlay in `src/fetchers/CLAUDE.md`**

Under the "### 6. URL-encode path segments at the boundary" invariant, append this paragraph:

```markdown
The four multi-slug ATS fetchers (`ashby`, `greenhouse`, `lever`, `ashby-private`) build their board URLs via the shared encoded helpers in `src/lib/ats-endpoints.ts` and resolve their slug list at fetch time via `resolveSlugs(shipped, overlay)` from `src/lib/slugs.ts`. The effective list is the committed `config/slugs.json` baseline unioned with the gitignored `config/slugs.local.json` personal overlay, minus the overlay's removals. Never write `config/slugs.json` from app code - personal changes belong in the overlay.
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore config/slugs.json src/fetchers/CLAUDE.md
git commit -m "docs(sources): document the slugs.local.json overlay"
```

---

## Task 5: Live slug-verify probe (`src/lib/source-probe.ts`)

**Files:**
- Create: `src/lib/source-probe.ts`

> No unit test: this module only does network I/O against live ATS APIs (the project's other network fetchers are likewise not unit-tested). It's exercised manually in Task 10. Keep it tiny and delegate URL construction to the Task 2 helpers.

- [ ] **Step 1: Write the implementation**

Create `src/lib/source-probe.ts`:

```ts
// Live "does this slug exist / how many roles does it expose right now" probe,
// used by the Settings → Job sources panel when a user adds a company. Because
// 404 slugs are silently skipped at fetch time, a typo otherwise contributes
// zero jobs forever with no feedback - this gives the user a ✓/✗ on add.
//
// Only the three public ATS are probeable. Ashby-private uses an unauthenticated
// GraphQL endpoint we intentionally don't replay here, so it reports unsupported.

import { ashbyBoardUrl, greenhouseBoardUrl, leverBoardUrl } from './ats-endpoints.js';
import type { AtsKey } from './slugs.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

export interface ProbeResult {
  supported: boolean;
  found: number;
}

const COUNTERS: Partial<Record<AtsKey, (slug: string) => Promise<number>>> = {
  ashby: async (slug) => {
    const data = await fetchJson<{ jobs?: unknown[] }>(ashbyBoardUrl(slug), { headers: JSON_HEADERS });
    return Array.isArray(data.jobs) ? data.jobs.length : 0;
  },
  greenhouse: async (slug) => {
    const data = await fetchJson<{ jobs?: unknown[] }>(greenhouseBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return Array.isArray(data.jobs) ? data.jobs.length : 0;
  },
  lever: async (slug) => {
    const data = await fetchJson<unknown[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    return Array.isArray(data) ? data.length : 0;
  },
};

export async function probeSlug(key: AtsKey, slug: string): Promise<ProbeResult> {
  const counter = COUNTERS[key];
  if (!counter) return { supported: false, found: 0 };
  try {
    return { supported: true, found: await counter(slug) };
  } catch {
    // 404 / network → treat as "found nothing" rather than erroring the panel.
    return { supported: true, found: 0 };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm run typecheck
git add src/lib/source-probe.ts
git commit -m "feat(sources): live ATS slug-verify probe"
```

---

## Task 6: Sources middleware plugin (`ui/plugins/sources.ts`)

**Files:**
- Modify: `ui/plugins/_paths.ts`
- Create: `ui/plugins/sources.ts`
- Modify: `ui/vite.config.ts`

- [ ] **Step 1: Add the overlay path to `ui/plugins/_paths.ts`**

After the line `export const PROFILE_DEFAULT_PATH = ...` (line 16), add:

```ts
export const SLUGS_LOCAL_PATH = path.join(REPO_ROOT, 'config', 'slugs.local.json');
```

- [ ] **Step 2: Create `ui/plugins/sources.ts`**

```ts
import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import slugs from '../../config/slugs.json' with { type: 'json' };
import {
  ATS_KEYS,
  type AtsKey,
  loadSlugOverlay,
  resolveSlugs,
  sanitizeDelta,
  type SlugOverlay,
} from '../../src/lib/slugs.js';
import { probeSlug } from '../../src/lib/source-probe.js';
import { SLUGS_LOCAL_PATH } from './_paths.ts';
import { readBody } from './_shared.ts';

// GET  /api/sources         → { ats: AtsView[] } - shipped + overlay + effective
// PUT  /api/sources         → persist one ATS's delta to slugs.local.json
// POST /api/sources/verify  → live probe a slug ({ supported, found })
//
// slugs.json is read-only here (committed baseline). Only slugs.local.json is
// written, so upstream tier-S updates keep flowing through.

const LABELS: Record<AtsKey, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashbyPrivate: 'Ashby (private)',
};

const BASE: Record<AtsKey, readonly string[]> = {
  ashby: slugs.ashby,
  greenhouse: slugs.greenhouse,
  lever: slugs.lever,
  ashbyPrivate: slugs.ashbyPrivate,
};

// Ashby-private isn't probeable (see source-probe.ts) - UI hides its verify CTA.
const VERIFY_SUPPORTED: Record<AtsKey, boolean> = {
  ashby: true,
  greenhouse: true,
  lever: true,
  ashbyPrivate: false,
};

interface AtsView {
  key: AtsKey;
  label: string;
  verifySupported: boolean;
  shipped: string[];
  add: string[];
  remove: string[];
  effective: string[];
}

function buildView(overlay: SlugOverlay): AtsView[] {
  return ATS_KEYS.map((key) => {
    const delta = overlay[key] ?? { add: [], remove: [] };
    return {
      key,
      label: LABELS[key],
      verifySupported: VERIFY_SUPPORTED[key],
      shipped: [...BASE[key]],
      add: delta.add,
      remove: delta.remove,
      effective: resolveSlugs(BASE[key], delta),
    };
  });
}

function isAtsKey(value: unknown): value is AtsKey {
  return typeof value === 'string' && (ATS_KEYS as readonly string[]).includes(value);
}

export function sourcesApiPlugin(): Plugin {
  return {
    name: 'pupila-sources-api',
    configureServer(server) {
      // Register the more specific path FIRST - connect matches by prefix, so
      // /api/sources would otherwise also swallow /api/sources/verify.
      server.middlewares.use('/api/sources/verify', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = (await readBody(req)) as { key?: unknown; slug?: unknown };
          const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
          if (!isAtsKey(body.key) || !slug) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'key and slug are required' }));
            return;
          }
          res.end(JSON.stringify(await probeSlug(body.key, slug)));
        } catch (err) {
          console.error('[sources verify api]', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/sources', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
            res.end(JSON.stringify({ ats: buildView(overlay) }));
            return;
          }
          if (req.method === 'PUT') {
            const body = (await readBody(req)) as { key?: unknown; add?: unknown; remove?: unknown };
            if (!isAtsKey(body.key)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid ats key' }));
              return;
            }
            const delta = sanitizeDelta({ add: body.add, remove: body.remove });
            const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
            if (delta.add.length || delta.remove.length) overlay[body.key] = delta;
            else delete overlay[body.key];
            await writeFile(SLUGS_LOCAL_PATH, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
            res.end(JSON.stringify({ ats: buildView(overlay) }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[sources api]', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
```

- [ ] **Step 3: Register the plugin in `ui/vite.config.ts`**

Add the import alongside the others (keep alphabetical-ish grouping; place after `schedulerStatus`):

```ts
import { sourcesApiPlugin } from './plugins/sources.ts';
```

And add `sourcesApiPlugin(),` to the `plugins` array (e.g. right after `profileApiPlugin(),`):

```ts
    profileApiPlugin(),
    sourcesApiPlugin(),
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm run typecheck`
Expected: clean.

```bash
git add ui/plugins/_paths.ts ui/plugins/sources.ts ui/vite.config.ts
git commit -m "feat(ui): /api/sources middleware for company-slug overlay"
```

---

## Task 7: Typed api client surface (`ui/src/lib/api/index.ts`)

**Files:**
- Modify: `ui/src/lib/api/index.ts`

- [ ] **Step 1: Add the response shapes**

In the "Response shapes that don't live in types.ts yet" region (after `LocationMutateResponse`, around line 151), add:

```ts
export interface SourcesAtsView {
  key: string;
  label: string;
  verifySupported: boolean;
  shipped: string[];
  add: string[];
  remove: string[];
  effective: string[];
}

export interface SourcesResponse {
  ats: SourcesAtsView[];
}

export interface VerifyResponse {
  supported: boolean;
  found: number;
}
```

- [ ] **Step 2: Add the `api.sources` namespace**

After the `location` namespace block (ends line 345) and before the `scheduler` block, insert:

```ts
  // ── Job sources (per-company ATS slug overlay) ───────────────────────────
  sources: {
    get: (opt: SignalOpt = {}) => request<SourcesResponse>('/api/sources', opt),
    set: (input: { key: string; add: string[]; remove: string[] }, opt: SignalOpt = {}) =>
      request<SourcesResponse>('/api/sources', { method: 'PUT', json: input, ...opt }),
    verify: (input: { key: string; slug: string }, opt: SignalOpt = {}) =>
      request<VerifyResponse>('/api/sources/verify', { method: 'POST', json: input, ...opt }),
  },
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm run typecheck`
Expected: clean.

```bash
git add ui/src/lib/api/index.ts
git commit -m "feat(ui): api.sources client methods"
```

---

## Task 8: Sources Settings panel (`ui/src/settings/SourcesPanel.tsx`)

**Files:**
- Create: `ui/src/settings/SourcesPanel.tsx`
- Create: `ui/src/settings/SourcesPanel.module.css`
- Test: `ui/src/settings/SourcesPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `ui/src/settings/SourcesPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SourcesResponse, VerifyResponse } from '../lib/api/index.ts';
import { SourcesPanel } from './SourcesPanel.tsx';

afterEach(() => vi.restoreAllMocks());

const sources: SourcesResponse = {
  ats: [
    {
      key: 'ashby',
      label: 'Ashby',
      verifySupported: true,
      shipped: ['linear', 'ramp'],
      add: ['stripe'],
      remove: [],
      effective: ['linear', 'ramp', 'stripe'],
    },
  ],
};

const noopVerify = async (): Promise<VerifyResponse | null> => ({ supported: true, found: 3 });

it('renders the effective company list', () => {
  render(<SourcesPanel sources={sources} onSave={vi.fn()} onVerify={noopVerify} />);
  expect(screen.getByText('linear')).toBeInTheDocument();
  expect(screen.getByText('stripe')).toBeInTheDocument();
});

it('removing a shipped slug saves it into the remove list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  fireEvent.click(screen.getByTitle('Remove linear'));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith('ashby', ['stripe'], ['linear']),
  );
});

it('removing an added slug drops it from the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  fireEvent.click(screen.getByTitle('Remove stripe'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('adding a new slug appends it to the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'Mercury' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith('ashby', ['stripe', 'mercury'], []),
  );
});

it('rejects an invalid slug without saving', async () => {
  const onSave = vi.fn();
  render(<SourcesPanel sources={sources} onSave={onSave} onVerify={noopVerify} />);
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'bad/slug' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(await screen.findByText(/invalid slug/i)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run ui/src/settings/SourcesPanel.test.tsx`
Expected: FAIL - `Cannot find module './SourcesPanel.tsx'`.

- [ ] **Step 3: Write the panel component**

Create `ui/src/settings/SourcesPanel.tsx`:

```tsx
// [09] Job sources panel - add/remove company boards for the multi-slug ATS
// sources (Ashby, Greenhouse, Lever, Ashby-private). Personal choices persist
// as a delta in config/slugs.local.json (gitignored). Effective list per ATS =
// shipped ∪ add - remove. Verify hits the live ATS board to confirm a slug.

import { useCallback, useState } from 'react';
import type { SourcesAtsView, SourcesResponse, VerifyResponse } from '../lib/api/index.ts';
import buttonStyles from '../styles/Button.module.css';
import { Section, SkeletonRows, settingsStyles } from './shared.tsx';
import styles from './SourcesPanel.module.css';

// Mirror of SLUG_PATTERN in src/lib/slugs.ts - the server re-validates, this is
// just for instant feedback.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

interface SourcesPanelProps {
  sources: SourcesResponse | null;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
}

export function SourcesPanel({ sources, onSave, onVerify }: SourcesPanelProps) {
  const total = sources?.ats.reduce((n, a) => n + a.effective.length, 0) ?? 0;
  return (
    <Section
      index="09"
      title="Job sources"
      subtitle="Add or remove company boards for the ATS sources. Saved to config/slugs.local.json."
      meta={
        sources ? (
          <span className={settingsStyles.pill}>{total} companies</span>
        ) : null
      }
    >
      {!sources ? (
        <SkeletonRows count={4} />
      ) : (
        <div className={styles.groups}>
          {sources.ats.map((ats) => (
            <AtsGroup key={ats.key} ats={ats} onSave={onSave} onVerify={onVerify} />
          ))}
        </div>
      )}
    </Section>
  );
}

interface AtsGroupProps {
  ats: SourcesAtsView;
  onSave: (key: string, add: string[], remove: string[]) => Promise<void>;
  onVerify: (key: string, slug: string) => Promise<VerifyResponse | null>;
}

function AtsGroup({ ats, onSave, onVerify }: AtsGroupProps) {
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const addSet = new Set(ats.add);

  const removeSlug = useCallback(
    (slug: string) => {
      if (addSet.has(slug)) {
        void onSave(
          ats.key,
          ats.add.filter((s) => s !== slug),
          ats.remove,
        );
      } else {
        void onSave(ats.key, ats.add, [...ats.remove, slug]);
      }
    },
    [ats, addSet, onSave],
  );

  const normalize = (raw: string): string => raw.trim().toLowerCase();

  const submitAdd = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setVerifyMsg(null);
      const slug = normalize(draft);
      if (!SLUG_PATTERN.test(slug)) {
        setLocalError('Invalid slug - use lowercase letters, digits, dot, dash, underscore.');
        return;
      }
      if (ats.effective.includes(slug)) {
        setLocalError('Already in the list.');
        return;
      }
      setLocalError(null);
      void onSave(
        ats.key,
        [...ats.add, slug],
        ats.remove.filter((s) => s !== slug),
      );
      setDraft('');
    },
    [ats, draft, onSave],
  );

  const runVerify = useCallback(async () => {
    const slug = normalize(draft);
    if (!SLUG_PATTERN.test(slug)) {
      setLocalError('Enter a slug to verify.');
      return;
    }
    setLocalError(null);
    setVerifying(true);
    setVerifyMsg(null);
    const result = await onVerify(ats.key, slug);
    setVerifying(false);
    if (!result) setVerifyMsg('Verify failed - try again.');
    else if (!result.supported) setVerifyMsg('Verify not supported for this source.');
    else if (result.found > 0) setVerifyMsg(`✓ ${slug} - ${result.found} open role(s).`);
    else setVerifyMsg(`✗ ${slug} - board not found or no open roles.`);
  }, [ats.key, draft, onVerify]);

  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>{ats.label}</span>
        <span className={styles.groupCount}>{ats.effective.length}</span>
      </div>
      <div className={styles.chips}>
        {ats.effective.length === 0 ? (
          <span className={styles.emptyChips}>No companies - add one below.</span>
        ) : (
          ats.effective.map((slug) => (
            <span
              key={slug}
              className={addSet.has(slug) ? styles.chipAdded : styles.chip}
            >
              {slug}
              <button
                type="button"
                className={styles.chipRemove}
                title={`Remove ${slug}`}
                onClick={() => removeSlug(slug)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <form className={styles.addRow} onSubmit={submitAdd}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
          placeholder={`Add ${ats.label} company slug…`}
          spellCheck={false}
          autoCapitalize="none"
        />
        {ats.verifySupported && (
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={verifying || !draft.trim()}
            onClick={() => void runVerify()}
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        )}
        <button type="submit" className={buttonStyles.primary} disabled={!draft.trim()}>
          Add
        </button>
      </form>
      {localError && <p className={styles.error}>{localError}</p>}
      {verifyMsg && <p className={styles.verify}>{verifyMsg}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Write the CSS module**

Create `ui/src/settings/SourcesPanel.module.css`:

```css
/*
 * [09] SourcesPanel - per-ATS company chips + add/verify row.
 */

.groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.group {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  padding: var(--space-3);
}

.groupHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.groupTitle {
  font-weight: 600;
  color: var(--primary);
  font-size: var(--text-md);
}

.groupCount {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: var(--text-xs);
  color: var(--text-soft);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.emptyChips {
  color: var(--text-soft);
  font-size: var(--text-sm);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.125rem var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: var(--text-sm);
}

.chipAdded {
  composes: chip;
  border-color: var(--accent);
  color: var(--accent);
}

.chipRemove {
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: var(--text-md);
  line-height: 1;
  padding: 0;
  opacity: 0.7;
}

.chipRemove:hover {
  opacity: 1;
  color: var(--danger);
}

.addRow {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.input {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: var(--text-sm);
}

.input:focus {
  outline: none;
  border-color: var(--focus-ring);
  box-shadow: 0 0 0 3px var(--focus-ring-halo);
}

.error {
  margin: var(--space-2) 0 0;
  color: var(--danger);
  font-size: var(--text-sm);
}

.verify {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run ui/src/settings/SourcesPanel.test.tsx`
Expected: PASS - all five cases green.

- [ ] **Step 6: Lint (CSS-module + api-pattern gates) + commit**

Run: `pnpm run lint && pnpm run lint:ui-patterns`
Expected: clean (no string-literal classNames, no inline `fetch`).

```bash
git add ui/src/settings/SourcesPanel.tsx ui/src/settings/SourcesPanel.module.css ui/src/settings/SourcesPanel.test.tsx
git commit -m "feat(ui): SourcesPanel for company-slug management"
```

---

## Task 9: Wire the panel into the Settings tab (`ui/src/Settings.tsx`)

**Files:**
- Modify: `ui/src/Settings.tsx`

- [ ] **Step 1: Import the panel + types**

After the `ScoringProfilePanel` import (line 12), add:

```tsx
import { SourcesPanel } from './settings/SourcesPanel.tsx';
```

In the `api` import line 2, it already imports `api, formatError` - no change. Add the sources types to the existing api import is not needed (types come via the panel). Add this import near the top with the other api type imports:

```tsx
import type { SourcesResponse, VerifyResponse } from './lib/api/index.ts';
```

- [ ] **Step 2: Add sources state**

After the `const [copiedSnippet, ...]` state declaration (line 93), add:

```tsx
  const [sources, setSources] = useState<SourcesResponse | null>(null);
```

- [ ] **Step 3: Load sources in `loadAll`**

Change the `Promise.all` in `loadAll` (lines 96-103) to add the sources request:

```tsx
  const loadAll = useCallback(async (signal?: AbortSignal) => {
    const [p, s, rs, d, e, prof, src] = await Promise.all([
      api.preferences.get({ signal }),
      api.scheduler.status({ signal }),
      api.runSummary.get({ signal }),
      api.diskUsage.get({ signal }),
      api.env.get({ signal }),
      api.profile.get({ signal }),
      api.sources.get({ signal }),
    ]);
    const results = [p, s, rs, d, e, prof, src];
    if (results.some((r) => !r.ok && r.error.kind === 'abort')) return;
    if (p.ok) {
      setPrefs(p.value);
      setProvider(p.value.provider ?? 'auto');
    }
    setScheduler(s.ok ? s.value : null);
    setRunSummary(rs.ok ? rs.value : null);
    setDisk(d.ok ? d.value : null);
    setEnvInfo(e.ok ? e.value : null);
    setProfile(prof.ok ? (prof.value.profile ?? null) : null);
    setGenerating(prof.ok ? (prof.value.generating ?? false) : false);
    setProfileLoaded(prof.ok);
    setSources(src.ok ? src.value : null);
  }, []);
```

- [ ] **Step 4: Add save + verify callbacks**

After the `regenerateProfile` callback (ends line 222), add:

```tsx
  const saveSources = useCallback(async (key: string, add: string[], remove: string[]) => {
    setError(null);
    const r = await api.sources.set({ key, add, remove });
    if (!r.ok) {
      setError(`Could not save sources: ${formatError(r.error)}`);
      return;
    }
    setSources(r.value);
  }, []);

  const verifySource = useCallback(
    async (key: string, slug: string): Promise<VerifyResponse | null> => {
      const r = await api.sources.verify({ key, slug });
      return r.ok ? r.value : null;
    },
    [],
  );
```

- [ ] **Step 5: Render the panel**

After the `<ScoringProfilePanel ... />` block (ends line 359), add:

```tsx
      <SourcesPanel sources={sources} onSave={saveSources} onVerify={verifySource} />
```

- [ ] **Step 6: Typecheck, lint, build the UI**

Run: `pnpm run typecheck && pnpm run lint && pnpm run lint:ui-patterns`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add ui/src/Settings.tsx
git commit -m "feat(ui): mount Job sources panel in Settings"
```

---

## Task 10: Manual verification + final gates

**Files:** none (verification only).

- [ ] **Step 1: Full test + typecheck + build gates**

Run: `pnpm run typecheck && pnpm run lint && pnpm run lint:ui-patterns && pnpm test && pnpm run build`
Expected: all green. (`pnpm test` runs both backend + ui vitest projects.)

- [ ] **Step 2: UI smoke test**

Run: `pnpm run ui`
Then in the browser at `127.0.0.1:5173`:
- Go to Settings → `[09] Job sources`.
- Confirm Ashby/Greenhouse/Lever/Ashby (private) groups render with their shipped companies.
- Type `stripe` under Ashby, click **Verify** → expect a `✓ stripe - N open role(s)` (or `✗ … not found`) message.
- Click **Add** → the chip appears (accent-colored = added).
- Confirm `config/slugs.local.json` now exists and contains `{ "ashby": { "add": ["stripe"], "remove": [] } }`.
- Remove a shipped company (e.g. click × on `linear`) → confirm it disappears and `slugs.local.json` gains it under `remove`.
- Re-add `linear` → confirm it returns and drops out of `remove`.

- [ ] **Step 3: Orchestrator honors the overlay**

Run: `PUPILA_NO_BRIEF_CHECK=1 pnpm run dev` (the brief gate may be bypassed for a structural smoke test).
Expected in the logs: the `[done] ashby fetched=…` count reflects the edited slug set (the removed company no longer probed; the added one fetched). Confirm no crash and `data/jobs.json` is written.

- [ ] **Step 4: Confirm the overlay is gitignored**

Run: `git status --short config/slugs.local.json`
Expected: no output (file is ignored, not staged).

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(sources): verification fixes"
```

(Skip if nothing changed.)

---

## Self-Review Notes

**Spec coverage:**
- "Remove specific companies / add new ones" → Tasks 1, 3, 8, 9 (delta overlay end-to-end).
- "UI section to do it" → Task 8 panel + Task 9 wiring.
- "Check the options" / verify a slug is real → Tasks 5, 6 (probe + verify endpoint), surfaced in Task 8 UI.
- "Keep shipped list clean / track upstream" → delta model in Task 1, gitignore in Task 4, slugs.json never written (Task 6 writes only slugs.local.json).
- Security (slug injection) → Task 2 encoded URL builders + Task 1 `isValidSlug` + Task 6 server re-validation.

**Type consistency check:** `AtsKey` / `SlugDelta` / `SlugOverlay` (Task 1) are reused by `source-probe.ts` (Task 5) and `ui/plugins/sources.ts` (Task 6). The wire shape `SourcesAtsView` (Task 6 `AtsView` → Task 7 `SourcesAtsView`) has identical fields: `key,label,verifySupported,shipped,add,remove,effective`. `api.sources.set` input `{key,add,remove}` matches the PUT handler body and `SourcesPanel.onSave(key, add, remove)`. `VerifyResponse {supported,found}` matches `ProbeResult`.

**Known trade-off:** `src/lib/source-probe.ts` and the fetchers both build board URLs via `src/lib/ats-endpoints.ts`, so there's a single source of truth for the URLs. Ashby-private is intentionally not verifiable (GraphQL); the UI hides its Verify button via `verifySupported: false`.
