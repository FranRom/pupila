# LLM Company Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-click "Discover for my profile" action in Settings → Job sources that uses the user's LLM CLI to propose companies, live-probes them against the supported ATSes, ranks them by how many open roles match the user's profile, and lets the user accept picks into the `slugs.local.json` overlay.

**Architecture:** A pure, dependency-injected core library (`src/lib/company-discovery.ts`) orchestrates: build prompt → `runLlm` → parse candidates → resolve slug variants → `probeSlug` (liveness) → `fetchBoardTitles` → `scoreRoles` (title-keyword relevance) → ranked `Suggestion[]`. A thin Vite middleware endpoint (`POST /api/sources/discover`) calls it; the UI renders a checklist and reuses the existing per-ATS overlay-add (`onSave`) to accept picks. Discovery is read-only; only the existing add path writes `slugs.local.json`.

**Tech Stack:** Node 22 / TS (NodeNext, ESM), Vitest, existing `src/lib/{llm,source-probe,slugs,ats-endpoints}.ts`, `src/filters.ts#loadProfile`, `src/rss.ts#parseXml`, React 19 UI with CSS Modules + `lib/api` client.

---

## Spec

`docs/superpowers/specs/2026-06-17-llm-company-discovery-design.md`

## File structure

| File | Responsibility |
|---|---|
| `src/lib/company-discovery.ts` *(new)* | Types + the whole discovery pipeline (pure functions + injectable orchestrator) |
| `tests/company-discovery.test.ts` *(new)* | Unit + injected-dep integration tests |
| `ui/plugins/sources.ts` *(modify)* | Add `POST /api/sources/discover` middleware |
| `ui/src/lib/api/index.ts` *(modify)* | `api.sources.discover()` + `DiscoverResult`/`Suggestion` types |
| `ui/src/settings/SourcesPanel.tsx` *(modify)* | Discover button + suggestions checklist; accept reuses `onSave` |
| `ui/src/settings/SourcesPanel.module.css` *(modify)* | Styles for the discover block |
| `ui/src/Settings.tsx` *(modify)* | Wire `onDiscover` prop → `api.sources.discover()` |

**Scope note:** Discovery targets the five REST/XML ATSes only — `DISCOVERY_ATS_KEYS = ['ashby','greenhouse','lever','recruitee','personio']`. `ashbyPrivate` is excluded (its board is GraphQL; `fetchBoardTitles` has no path for it).

---

### Task 1: Core types + `parseCandidates`

**Files:**
- Create: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/company-discovery.test.ts
import { describe, expect, it } from 'vitest';
import { parseCandidates } from '../src/lib/company-discovery.js';

describe('parseCandidates', () => {
  it('parses a bare JSON array', () => {
    const out = parseCandidates('[{"name":"n8n","ats":"ashby","slug":"n8n","why":"agentic"}]');
    expect(out).toEqual([{ name: 'n8n', ats: 'ashby', slug: 'n8n', why: 'agentic' }]);
  });

  it('strips a ```json fence', () => {
    const out = parseCandidates('```json\n[{"name":"Pitch"}]\n```');
    expect(out).toEqual([{ name: 'Pitch', ats: undefined, slug: undefined, why: undefined }]);
  });

  it('recovers an array embedded in prose', () => {
    const out = parseCandidates('Sure! Here:\n[{"name":"Figma"}]\nHope that helps');
    expect(out.map((c) => c.name)).toEqual(['Figma']);
  });

  it('accepts an object wrapper { companies: [...] }', () => {
    expect(parseCandidates('{"companies":[{"name":"Dust"}]}').map((c) => c.name)).toEqual(['Dust']);
  });

  it('drops invalid ats, blank names, and garbage', () => {
    const out = parseCandidates('[{"name":"OK","ats":"workday"},{"name":""},{"x":1},"junk"]');
    expect(out).toEqual([{ name: 'OK', ats: undefined, slug: undefined, why: undefined }]);
  });

  it('returns [] on unparseable input', () => {
    expect(parseCandidates('not json at all')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `parseCandidates` is not exported (module/file missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/company-discovery.ts
import { ATS_KEYS, type AtsKey } from './slugs.js';

/** ATSes discovery can probe (REST/XML). Excludes ashbyPrivate (GraphQL). */
export const DISCOVERY_ATS_KEYS = [
  'ashby',
  'greenhouse',
  'lever',
  'recruitee',
  'personio',
] as const satisfies readonly AtsKey[];
export type DiscoveryAtsKey = (typeof DISCOVERY_ATS_KEYS)[number];

/** A company the LLM proposed. `ats`/`slug` are best-guesses; we verify both. */
export interface Candidate {
  name: string;
  ats?: AtsKey;
  slug?: string;
  why?: string;
}

function isAtsKey(v: unknown): v is AtsKey {
  return typeof v === 'string' && (ATS_KEYS as readonly string[]).includes(v);
}

export function parseCandidates(raw: string): Candidate[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as { companies?: unknown })?.companies ?? null);
  if (!Array.isArray(arr)) return [];

  const out: Candidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      ats: isAtsKey(o.ats) ? o.ats : undefined,
      slug: typeof o.slug === 'string' ? o.slug : undefined,
      why: typeof o.why === 'string' ? o.why : undefined,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): candidate types + LLM-output parser"
```

---

### Task 2: `resolveSlugVariants`

**Files:**
- Modify: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/company-discovery.test.ts
import { resolveSlugVariants } from '../src/lib/company-discovery.js';

describe('resolveSlugVariants', () => {
  it('puts the LLM slug guess first, then name-derived variants', () => {
    expect(resolveSlugVariants('Aleph Alpha', 'aleph-alpha')).toEqual([
      'aleph-alpha',
      'alephalpha',
    ]);
  });

  it('derives compact + hyphenated variants from the name when no guess', () => {
    expect(resolveSlugVariants('Black Forest Labs')).toEqual([
      'blackforestlabs',
      'black-forest-labs',
    ]);
  });

  it('dedupes and drops variants failing SLUG_PATTERN', () => {
    expect(resolveSlugVariants('n8n')).toEqual(['n8n']);
  });

  it('caps at 4 variants', () => {
    expect(resolveSlugVariants('A B C D E F', 'x').length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `resolveSlugVariants` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/company-discovery.ts
import { ATS_KEYS, type AtsKey, SLUG_PATTERN } from './slugs.js';
// ^ replace the existing `import { ATS_KEYS, type AtsKey } from './slugs.js';`

const MAX_VARIANTS = 4;

/** Ordered, deduped, SLUG_PATTERN-valid slug candidates for one company. */
export function resolveSlugVariants(name: string, slugGuess?: string): string[] {
  const base = name.toLowerCase().trim();
  const raw = [
    slugGuess?.toLowerCase().trim(),
    base.replace(/[^a-z0-9]+/g, ''), // "alephalpha"
    base.replace(/[^a-z0-9]+/g, '-'), // "aleph-alpha"
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (!v) continue;
    const s = v.replace(/^-+|-+$/g, '');
    if (s && SLUG_PATTERN.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.slice(0, MAX_VARIANTS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): slug-variant resolution"
```

---

### Task 3: `scoreRoles`

**Files:**
- Modify: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/company-discovery.test.ts
import { scoreRoles } from '../src/lib/company-discovery.js';

describe('scoreRoles', () => {
  const positive = ['front[\\s-]?end', 'full[\\s-]?stack', 'product engineer', 'agent'];
  const junior = ['junior', 'intern', 'working student'];

  it('counts titles matching a positive keyword', () => {
    const r = scoreRoles(
      ['Senior Frontend Engineer', 'Full-Stack Engineer', 'Backend Engineer'],
      positive,
      junior,
    );
    expect(r.matchCount).toBe(2);
    expect(r.sampleTitles).toEqual(['Senior Frontend Engineer', 'Full-Stack Engineer']);
  });

  it('excludes junior/intern/working-student even if otherwise matching', () => {
    const r = scoreRoles(['Junior Frontend Engineer', 'Working Student Frontend'], positive, junior);
    expect(r.matchCount).toBe(0);
  });

  it('caps sampleTitles at 4', () => {
    const titles = Array.from({ length: 6 }, (_, i) => `Frontend Engineer ${i}`);
    expect(scoreRoles(titles, positive, junior).sampleTitles).toHaveLength(4);
  });

  it('returns zero when no positive keywords configured', () => {
    expect(scoreRoles(['Frontend Engineer'], [], junior).matchCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `scoreRoles` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/company-discovery.ts

export interface RoleScore {
  matchCount: number;
  sampleTitles: string[];
}

const SAMPLE_LIMIT = 4;

/** Build a case-insensitive matcher from keyword/regex-fragment strings. Empty → never matches. */
function compileKeywords(keywords: readonly string[]): RegExp | null {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return new RegExp(`(?:${cleaned.join('|')})`, 'i');
}

/**
 * Title-keyword relevance: count titles that match a positive keyword and are
 * NOT junior-excluded. `positiveKeywords` come from the profile's category
 * keyword arrays; `juniorKeywords` from `profile.keywords.junior`.
 */
export function scoreRoles(
  titles: readonly string[],
  positiveKeywords: readonly string[],
  juniorKeywords: readonly string[],
): RoleScore {
  const positive = compileKeywords(positiveKeywords);
  if (!positive) return { matchCount: 0, sampleTitles: [] };
  const junior = compileKeywords(juniorKeywords);
  const matched = titles.filter((t) => positive.test(t) && !(junior?.test(t) ?? false));
  return { matchCount: matched.length, sampleTitles: matched.slice(0, SAMPLE_LIMIT) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): title-keyword relevance scoring"
```

---

### Task 4: `fetchBoardTitles`

**Files:**
- Modify: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test** (mocks `globalThis.fetch`)

```ts
// append to tests/company-discovery.test.ts
import { afterEach, beforeEach, vi } from 'vitest';
import { fetchBoardTitles } from '../src/lib/company-discovery.js';

function mockFetch(body: string, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
}

describe('fetchBoardTitles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('extracts ashby titles from {jobs:[{title}]}', async () => {
    mockFetch(JSON.stringify({ jobs: [{ title: 'Frontend' }, { title: 'Agent Eng' }] }));
    expect(await fetchBoardTitles('ashby', 'foo')).toEqual(['Frontend', 'Agent Eng']);
  });

  it('extracts lever titles from [{text}]', async () => {
    mockFetch(JSON.stringify([{ text: 'Full-Stack' }]));
    expect(await fetchBoardTitles('lever', 'foo')).toEqual(['Full-Stack']);
  });

  it('extracts recruitee titles from {offers:[{title}]}', async () => {
    mockFetch(JSON.stringify({ offers: [{ title: 'Product Engineer' }] }));
    expect(await fetchBoardTitles('recruitee', 'foo')).toEqual(['Product Engineer']);
  });

  it('extracts personio <position><name> from XML', async () => {
    mockFetch(
      '<workzag-jobs><position><id>1</id><name>Senior Frontend</name></position></workzag-jobs>',
    );
    expect(await fetchBoardTitles('personio', 'foo')).toEqual(['Senior Frontend']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `fetchBoardTitles` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/company-discovery.ts
import {
  ashbyBoardUrl,
  greenhouseBoardUrl,
  leverBoardUrl,
  personioBoardUrl,
  recruiteeBoardUrl,
} from './ats-endpoints.js';
import { parseXml } from '../rss.js';
import { fetchJson, fetchText, JSON_HEADERS, RSS_HEADERS } from '../utils.js';

interface JobsBody {
  jobs?: { title?: string }[];
}
interface PersonioRoot {
  'workzag-jobs'?: { position?: { name?: string } | { name?: string }[] } | null;
}

const clean = (arr: (string | undefined)[]): string[] =>
  arr.map((s) => (s ?? '').trim()).filter(Boolean);

/** Fetch one board and return its role titles. Throws on network/parse error. */
export async function fetchBoardTitles(ats: DiscoveryAtsKey, slug: string): Promise<string[]> {
  if (ats === 'personio') {
    const xml = await fetchText(personioBoardUrl(slug), { headers: RSS_HEADERS });
    const pos = (parseXml(xml) as PersonioRoot)['workzag-jobs']?.position;
    const list = pos ? (Array.isArray(pos) ? pos : [pos]) : [];
    return clean(list.map((p) => p?.name));
  }
  if (ats === 'recruitee') {
    const d = await fetchJson<{ offers?: { title?: string }[] }>(recruiteeBoardUrl(slug), {
      headers: JSON_HEADERS,
    });
    return clean((d.offers ?? []).map((o) => o.title));
  }
  if (ats === 'lever') {
    const d = await fetchJson<{ text?: string }[]>(leverBoardUrl(slug), { headers: JSON_HEADERS });
    return clean((Array.isArray(d) ? d : []).map((j) => j.text));
  }
  const url = ats === 'greenhouse' ? greenhouseBoardUrl(slug) : ashbyBoardUrl(slug);
  const d = await fetchJson<JobsBody>(url, { headers: JSON_HEADERS });
  return clean((d.jobs ?? []).map((j) => j.title));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): per-ATS board title extraction"
```

---

### Task 5: `buildDiscoveryPrompt`

**Files:**
- Modify: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/company-discovery.test.ts
import { buildDiscoveryPrompt } from '../src/lib/company-discovery.js';

describe('buildDiscoveryPrompt', () => {
  const profile = {
    categories: [{ id: 'fe', label: 'Frontend', keywords: ['frontend', 'react'] }],
    keywords: { junior: ['junior'], engineering: ['engineer'] },
  };

  it('includes supported ATSes, brief, category labels, and the exclude list', () => {
    const p = buildDiscoveryPrompt(profile, 'Senior FE engineer, 8y React', {
      ashby: ['linear'],
      greenhouse: [],
      lever: [],
      recruitee: [],
      personio: [],
    });
    expect(p).toContain('ashby');
    expect(p).toContain('Senior FE engineer');
    expect(p).toContain('Frontend');
    expect(p).toContain('linear'); // excluded company surfaced in prompt
    expect(p.toLowerCase()).toContain('json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `buildDiscoveryPrompt` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/company-discovery.ts

/** Minimal shape of the profile fields discovery reads (subset of FilterProfile). */
export interface DiscoveryProfile {
  categories?: readonly { id: string; label?: string; keywords: readonly string[] }[];
  keywords?: { junior?: readonly string[]; engineering?: readonly string[] } & Record<
    string,
    readonly string[] | undefined
  >;
}

export type CuratedSlugs = Record<DiscoveryAtsKey, readonly string[]>;

export function buildDiscoveryPrompt(
  profile: DiscoveryProfile,
  brief: string,
  curated: CuratedSlugs,
): string {
  const cats = (profile.categories ?? [])
    .map((c) => c.label ?? c.id)
    .filter(Boolean)
    .join(', ');
  const excluded = DISCOVERY_ATS_KEYS.flatMap((k) => curated[k] ?? []).join(', ');
  return [
    'You are helping a job-seeker find more companies to track on public ATS job boards.',
    `Supported ATS platforms (only suggest companies on these): ${DISCOVERY_ATS_KEYS.join(', ')}.`,
    '',
    'Candidate brief:',
    brief.trim() || '(no brief provided)',
    '',
    cats ? `Target role categories: ${cats}.` : '',
    '',
    `Already tracked (DO NOT suggest these): ${excluded || '(none)'}.`,
    '',
    'Suggest up to 25 real companies that actively hire for the target roles and host',
    'their jobs on one of the supported ATS platforms. Prefer companies building with AI.',
    '',
    'Return STRICT JSON only — an array, no prose, no markdown fences:',
    '[{"name": "Company", "ats": "ashby|greenhouse|lever|recruitee|personio", "slug": "best-guess-slug", "why": "one short reason"}]',
    'The "ats" and "slug" are best guesses; they will be verified, so include them when unsure.',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): profile-grounded LLM prompt builder"
```

---

### Task 6: `discoverCompanies` orchestrator (injected deps)

**Files:**
- Modify: `src/lib/company-discovery.ts`
- Test: `tests/company-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/company-discovery.test.ts
import { discoverCompanies } from '../src/lib/company-discovery.js';
import type { ProbeResult } from '../src/lib/source-probe.js';

const profile = {
  categories: [{ id: 'fe', label: 'FE', keywords: ['frontend', 'agent'] }],
  keywords: { junior: ['junior'], engineering: ['engineer'] },
};
const emptyCurated = { ashby: [], greenhouse: [], lever: [], recruitee: [], personio: [] };

function deps(over: Partial<Parameters<typeof discoverCompanies>[0]> = {}) {
  return {
    profile,
    brief: 'FE engineer',
    curated: emptyCurated,
    runLlm: async () => '[{"name":"N8n","ats":"ashby","slug":"n8n","why":"agentic"}]',
    probe: async (_ats: string, _slug: string): Promise<ProbeResult> => ({
      supported: true,
      state: 'ok',
      found: 3,
    }),
    fetchTitles: async () => ['Senior Frontend Engineer', 'Agent Engineer', 'Backend Engineer'],
    ...over,
  };
}

describe('discoverCompanies', () => {
  it('verifies, scores, and ranks LLM candidates', async () => {
    const r = await discoverCompanies(deps());
    expect(r.proposed).toBe(1);
    expect(r.verified).toBe(1);
    expect(r.suggestions[0]).toMatchObject({
      name: 'N8n',
      ats: 'ashby',
      slug: 'n8n',
      matchCount: 2,
      totalRoles: 3,
    });
  });

  it('drops candidates whose boards are not live', async () => {
    const r = await discoverCompanies(
      deps({ probe: async () => ({ supported: true, state: 'not_found', found: 0 }) }),
    );
    expect(r.verified).toBe(0);
    expect(r.suggestions).toEqual([]);
  });

  it('skips slugs already curated', async () => {
    const r = await discoverCompanies(
      deps({ curated: { ...emptyCurated, ashby: ['n8n'] } }),
    );
    expect(r.verified).toBe(0);
  });

  it('returns an error (not throw) when the LLM output is unparseable', async () => {
    const r = await discoverCompanies(deps({ runLlm: async () => 'sorry, no JSON' }));
    expect(r.suggestions).toEqual([]);
    expect(r.proposed).toBe(0);
  });

  it('ranks higher-matchCount companies first', async () => {
    let call = 0;
    const r = await discoverCompanies(
      deps({
        runLlm: async () =>
          '[{"name":"Low","ats":"ashby","slug":"low"},{"name":"High","ats":"ashby","slug":"high"}]',
        fetchTitles: async () =>
          call++ === 0 ? ['Frontend Engineer'] : ['Frontend Engineer', 'Agent Engineer'],
      }),
    );
    expect(r.suggestions.map((s) => s.matchCount)).toEqual([2, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/company-discovery.test.ts`
Expected: FAIL — `discoverCompanies` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/lib/company-discovery.ts
import { runLlm } from './llm.js';
import { type ProbeResult, probeSlug } from './source-probe.js';

const MAX_CANDIDATES = 25;

export interface Suggestion {
  name: string;
  ats: DiscoveryAtsKey;
  slug: string;
  matchCount: number;
  totalRoles: number;
  sampleTitles: string[];
  why?: string;
}

export interface DiscoverResult {
  suggestions: Suggestion[];
  proposed: number;
  verified: number;
  errors: string[];
}

export interface DiscoverOptions {
  profile: DiscoveryProfile;
  brief: string;
  curated: CuratedSlugs;
  // Injectable for tests; default to the real implementations.
  runLlm?: (prompt: string) => Promise<string>;
  probe?: (ats: DiscoveryAtsKey, slug: string) => Promise<ProbeResult>;
  fetchTitles?: (ats: DiscoveryAtsKey, slug: string) => Promise<string[]>;
}

function positiveKeywords(p: DiscoveryProfile): string[] {
  const cat = (p.categories ?? []).flatMap((c) => [...c.keywords]);
  return cat.length ? cat : [...(p.keywords?.engineering ?? [])];
}

export async function discoverCompanies(opts: DiscoverOptions): Promise<DiscoverResult> {
  const runLlmFn = opts.runLlm ?? runLlm;
  const probeFn = opts.probe ?? probeSlug;
  const fetchTitlesFn = opts.fetchTitles ?? fetchBoardTitles;
  const errors: string[] = [];

  let candidates: Candidate[];
  try {
    const raw = await runLlmFn(buildDiscoveryPrompt(opts.profile, opts.brief, opts.curated));
    candidates = parseCandidates(raw).slice(0, MAX_CANDIDATES);
  } catch (err) {
    return { suggestions: [], proposed: 0, verified: 0, errors: [(err as Error).message] };
  }

  const posKw = positiveKeywords(opts.profile);
  const juniorKw = [...(opts.profile.keywords?.junior ?? [])];
  const isCurated = (ats: DiscoveryAtsKey, slug: string) =>
    (opts.curated[ats] ?? []).includes(slug);

  const settled = await Promise.all(
    candidates.map(async (c): Promise<Suggestion | null> => {
      try {
        const order: DiscoveryAtsKey[] =
          c.ats && (DISCOVERY_ATS_KEYS as readonly string[]).includes(c.ats)
            ? [c.ats as DiscoveryAtsKey, ...DISCOVERY_ATS_KEYS.filter((k) => k !== c.ats)]
            : [...DISCOVERY_ATS_KEYS];
        const variants = resolveSlugVariants(c.name, c.slug);
        for (const ats of order) {
          for (const slug of variants) {
            if (isCurated(ats, slug)) continue;
            const res = await probeFn(ats, slug);
            if (res.state === 'ok' && res.found > 0) {
              const titles = await fetchTitlesFn(ats, slug);
              const score = scoreRoles(titles, posKw, juniorKw);
              return {
                name: c.name,
                ats,
                slug,
                matchCount: score.matchCount,
                totalRoles: titles.length,
                sampleTitles: score.sampleTitles,
                why: c.why,
              };
            }
          }
        }
        return null;
      } catch (err) {
        errors.push(`${c.name}: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  const suggestions = settled
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.matchCount - a.matchCount);
  return { suggestions, proposed: candidates.length, verified: suggestions.length, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/company-discovery.test.ts && pnpm run typecheck`
Expected: PASS (all discovery tests) + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-discovery.ts tests/company-discovery.test.ts
git commit -m "feat(discovery): orchestrator (verify + score + rank)"
```

---

### Task 7: `POST /api/sources/discover` endpoint

**Files:**
- Modify: `ui/plugins/sources.ts` (add a middleware before the `/api/sources` route; reuse `BASE`, `loadSlugOverlay`, `resolveSlugs`)

- [ ] **Step 1: Add the endpoint**

Add near the top of `ui/plugins/sources.ts` (imports):

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../../src/filters.js';
import {
  type CuratedSlugs,
  DISCOVERY_ATS_KEYS,
  discoverCompanies,
} from '../../src/lib/company-discovery.js';

const BRIEF_PATH = fileURLToPath(new URL('../../config/candidate-brief.md', import.meta.url));
```

Add this middleware inside `configureServer(server)`, **before** the `server.middlewares.use('/api/sources', …)` block (connect matches by prefix):

```ts
// POST /api/sources/discover → LLM-propose companies, verify live, rank by
// profile fit. Read-only: returns suggestions; the user accepts via PUT.
server.middlewares.use('/api/sources/discover', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  try {
    const profile = await loadProfile();
    let brief = '';
    try {
      brief = await readFile(BRIEF_PATH, 'utf8');
    } catch {
      brief = '';
    }
    if (!(profile.categories?.length || brief.trim())) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Set up your profile or candidate brief first.' }));
      return;
    }
    const overlay = await loadSlugOverlay(SLUGS_LOCAL_PATH);
    const curated = Object.fromEntries(
      DISCOVERY_ATS_KEYS.map((k) => [k, resolveSlugs(BASE[k], overlay[k])]),
    ) as CuratedSlugs;
    const result = await discoverCompanies({ profile, brief, curated });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[sources discover api]', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});
```

- [ ] **Step 2: Manually verify the endpoint**

Run (in one terminal): `pnpm run ui`
Run (in another): `curl -s -X POST http://127.0.0.1:5173/api/sources/discover | head -c 400`
Expected: a JSON object `{"suggestions":[...],"proposed":N,"verified":M,"errors":[...]}` (or a `400` with the "Set up your profile…" message if no profile/brief, or a clear LLM-not-found error). It must NOT hang or 500 with a stack.

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/plugins/sources.ts
git commit -m "feat(discovery): /api/sources/discover endpoint"
```

---

### Task 8: API client method + types

**Files:**
- Modify: `ui/src/lib/api/index.ts` (add `Suggestion`/`DiscoverResult` types + `api.sources.discover()`)

- [ ] **Step 1: Add types and method**

Add the response types near the other source types in `ui/src/lib/api/index.ts`:

```ts
export interface DiscoverySuggestion {
  name: string;
  ats: string;
  slug: string;
  matchCount: number;
  totalRoles: number;
  sampleTitles: string[];
  why?: string;
}

export interface DiscoverResult {
  suggestions: DiscoverySuggestion[];
  proposed: number;
  verified: number;
  errors: string[];
}
```

Add `discover` to the `sources` namespace (next to `verify`/`checkHealth`), following the existing `request<T>` pattern in this file:

```ts
discover: (opt: { signal?: AbortSignal } = {}) =>
  request<DiscoverResult>('/api/sources/discover', { method: 'POST', signal: opt.signal }),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/api/index.ts
git commit -m "feat(discovery): api client discover() method"
```

---

### Task 9: Wire `onDiscover` through Settings → SourcesPanel

**Files:**
- Modify: `ui/src/Settings.tsx` (add `onDiscover` calling `api.sources.discover()`, pass to `SourcesPanel`)
- Modify: `ui/src/settings/SourcesPanel.tsx` (accept `onDiscover` prop; add a discover block — button, suggestions checklist, accept)
- Modify: `ui/src/settings/SourcesPanel.module.css` (styles)

Follow the existing `onVerify`/`onCheckHealth` prop pattern already in `SourcesPanel` — the parent owns the api call; the panel renders + selects.

- [ ] **Step 1: Settings.tsx — add the handler and prop**

In `ui/src/Settings.tsx`, where `<SourcesPanel … onVerify={…} onCheckHealth={…} />` is rendered, add:

```tsx
const handleDiscover = useCallback(async () => {
  const r = await api.sources.discover();
  if (!r.ok) throw new Error(formatError(r.error));
  return r.value; // DiscoverResult
}, []);
```

and pass `onDiscover={handleDiscover}` to `<SourcesPanel … />`. Import `DiscoverResult` type from `./lib/api/index.ts` and `formatError` from `./lib/api/client.ts` if not already imported.

- [ ] **Step 2: SourcesPanel.tsx — props + discover UI**

Add to `SourcesPanelProps`:

```ts
onDiscover: () => Promise<DiscoverResult>;
```

Inside `SourcesPanel`, add discovery state + handlers (this is one concern with >2 useState, but it's local to the panel header so keep it here, mirroring the existing `health`/`checking` pattern):

```tsx
const [discovering, setDiscovering] = useState(false);
const [discoverError, setDiscoverError] = useState<string | null>(null);
const [suggestions, setSuggestions] = useState<DiscoverySuggestion[] | null>(null);
const [picked, setPicked] = useState<Set<string>>(new Set()); // key = `${ats}:${slug}`

const runDiscover = useCallback(async () => {
  setDiscovering(true);
  setDiscoverError(null);
  try {
    const result = await onDiscover();
    setSuggestions(result.suggestions);
    setPicked(new Set());
  } catch (err) {
    setDiscoverError(err instanceof Error ? err.message : String(err));
  } finally {
    setDiscovering(false);
  }
}, [onDiscover]);

const togglePick = useCallback((key: string) => {
  setPicked((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
}, []);

const addPicked = useCallback(async () => {
  // Group picks by ATS and merge into that ATS's existing `add` list, then save
  // via the existing per-ATS overlay-add path (onSave).
  const byAts = new Map<string, string[]>();
  for (const key of picked) {
    const [ats, slug] = key.split(':');
    byAts.set(ats, [...(byAts.get(ats) ?? []), slug]);
  }
  for (const [ats, slugs] of byAts) {
    const group = sources?.ats.find((a) => a.key === ats);
    if (!group) continue;
    const merged = Array.from(new Set([...group.add, ...slugs]));
    await onSave(ats, merged, group.remove);
  }
  setSuggestions(null);
  setPicked(new Set());
}, [picked, sources, onSave]);
```

Render a discover block in the panel header (below the existing "Check board health" button). Use CSS-module classes only (no string literals):

```tsx
<div className={styles.discover}>
  <button
    type="button"
    className={buttonStyles.secondary}
    disabled={discovering}
    onClick={runDiscover}
  >
    {discovering ? 'Discovering…' : '✨ Discover for my profile'}
  </button>
  {discoverError && <p className={styles.discoverError}>{discoverError}</p>}
  {suggestions && (
    <div className={styles.suggestions}>
      {suggestions.length === 0 ? (
        <p className={styles.discoverEmpty}>No new companies found.</p>
      ) : (
        <>
          <ul className={styles.suggestionList}>
            {suggestions.map((s) => {
              const key = `${s.ats}:${s.slug}`;
              return (
                <li key={key} className={styles.suggestion}>
                  <label className={styles.suggestionLabel}>
                    <input
                      type="checkbox"
                      checked={picked.has(key)}
                      onChange={() => togglePick(key)}
                    />
                    <span className={styles.suggestionName}>{s.name}</span>
                    <span className={styles.suggestionMeta}>
                      {s.ats} · {s.matchCount}/{s.totalRoles} roles
                    </span>
                  </label>
                  {s.sampleTitles.length > 0 && (
                    <span className={styles.suggestionTitles}>{s.sampleTitles.join(' · ')}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={buttonStyles.primary}
            disabled={picked.size === 0}
            onClick={addPicked}
          >
            Add selected ({picked.size})
          </button>
        </>
      )}
    </div>
  )}
</div>
```

Add the imports at the top of `SourcesPanel.tsx`:

```ts
import type { DiscoverResult, DiscoverySuggestion } from '../lib/api/index.ts';
```

- [ ] **Step 3: SourcesPanel.module.css — add styles**

Append (use existing tokens, camelCase selectors):

```css
.discover {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.discoverError {
  color: var(--danger);
  font-size: var(--text-sm);
}
.discoverEmpty {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.suggestionList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.suggestion {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.suggestionLabel {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}
.suggestionName {
  font-weight: 600;
}
.suggestionMeta {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.suggestionTitles {
  color: var(--text-muted);
  font-size: var(--text-xs);
  padding-left: var(--space-4);
}
```

> Verify token names against `ui/src/styles/tokens.css` before committing; substitute the nearest existing token if any of `--space-1`/`--text-xs`/`--danger` differ.

- [ ] **Step 4: Lint + typecheck + UI patterns**

Run: `pnpm run lint && pnpm run typecheck && pnpm run lint:ui-patterns`
Expected: PASS (no string-literal classNames, no inline `fetch`).

- [ ] **Step 5: Manual smoke**

Run: `pnpm run ui` → Settings → Job sources → click **✨ Discover for my profile**.
Expected: spinner → a checklist of verified companies with role counts → select a few → **Add selected** → they appear as personal-add chips under the right ATS, and `config/slugs.local.json` gains them.

- [ ] **Step 6: Commit**

```bash
git add ui/src/Settings.tsx ui/src/settings/SourcesPanel.tsx ui/src/settings/SourcesPanel.module.css
git commit -m "feat(discovery): Settings UI — discover button + accept flow"
```

---

### Task 10: Component test for the discover flow

**Files:**
- Create: `ui/src/settings/SourcesPanel.test.tsx` (or extend if it exists)

- [ ] **Step 1: Write the test** (jsdom, per `ui/CLAUDE.md`)

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourcesPanel } from './SourcesPanel.tsx';

const baseSources = {
  ats: [
    { key: 'ashby', label: 'Ashby', note: '', verifySupported: true, shipped: ['linear'], add: [], remove: [], effective: ['linear'] },
  ],
};

it('discovers, lets the user pick, and saves via onSave', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onDiscover = vi.fn().mockResolvedValue({
    suggestions: [
      { name: 'N8n', ats: 'ashby', slug: 'n8n', matchCount: 2, totalRoles: 3, sampleTitles: ['Senior Product Engineer'] },
    ],
    proposed: 1,
    verified: 1,
    errors: [],
  });

  render(
    <SourcesPanel
      sources={baseSources}
      onSave={onSave}
      onVerify={vi.fn()}
      onCheckHealth={vi.fn()}
      onDiscover={onDiscover}
    />,
  );

  fireEvent.click(screen.getByText(/Discover for my profile/i));
  await waitFor(() => expect(screen.getByText('N8n')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText(/Add selected/i));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['n8n'], []));
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run ui/src/settings/SourcesPanel.test.tsx`
Expected: PASS. (If `SourcesPanel`'s real props differ from `baseSources`, adjust the fixture to match the actual `AtsView` shape — read the component first.)

- [ ] **Step 3: Full gate**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`
Expected: PASS (all tests; lint clean apart from the pre-existing CSS warnings).

- [ ] **Step 4: Commit**

```bash
git add ui/src/settings/SourcesPanel.test.tsx
git commit -m "test(discovery): SourcesPanel discover + accept flow"
```

---

## Self-review notes

- **Spec coverage:** prompt grounding (T5), user-LLM via `runLlm` (T6), live probe verify (T6), relevance ranking (T3+T6), slug resolution (T2), read-only discover endpoint (T7), overlay-only accept via existing `onSave` (T9), error-not-throw (T1/T6/T7), DACH/all 5 ATSes incl. Personio XML (T4), tests (T1–T6, T10). ✓
- **Out of scope (per spec):** CLI/MCP wrappers, data-mining source, ashbyPrivate (GraphQL) — intentionally excluded; `DISCOVERY_ATS_KEYS` enforces it.
- **Type consistency:** `DiscoveryAtsKey`, `Candidate`, `RoleScore`, `Suggestion`, `DiscoverResult`, `DiscoveryProfile`, `CuratedSlugs` defined in T1–T6 and reused unchanged in T7–T10. UI mirrors as `DiscoverySuggestion`/`DiscoverResult` (string `ats`) in T8.
- **Manual verification** steps (T7, T9) require a real LLM CLI on PATH; if absent, the endpoint returns a clear error which the UI surfaces (also acceptable as the "it doesn't crash" check).
