// Helpers for MCP tool unit tests. Builds a self-contained tmpdir with
// jobs.json / applied.json / ai-reviews.json / jobs-bodies.json so the
// runners can be exercised against deterministic data without touching the
// real working tree.

import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AiReviews, AppliedEntry, Job, Source } from '../../src/types.js';
import { normalizeUrl, sha1Hex } from '../../src/utils.js';

export function jobIdFor(url: string): string {
  return sha1Hex(normalizeUrl(url));
}

// Crypto-random suffix instead of a module-level counter. The repo's
// coding-style rule explicitly forbids module-level mutation, and a counter
// also leaks across test files within a worker — both problems here.
function uniqueSuffix(): string {
  return randomBytes(6).toString('hex');
}

export interface JobOverrides {
  source?: Source;
  title?: string;
  company?: string | null;
  url?: string;
  location?: string | null;
  body?: string;
  bodyPreview?: string;
  tags?: string[];
  salary?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  postedAt?: string | null;
  fetchedAt?: string;
  fitScore?: number;
  categories?: string[];
  remote?: boolean;
}

export function makeJob(overrides: JobOverrides = {}): Job {
  const suffix = uniqueSuffix();
  const url = overrides.url ?? `https://example.com/jobs/${suffix}`;
  return {
    id: jobIdFor(url),
    source: overrides.source ?? 'ashby',
    title: overrides.title ?? `Senior Frontend Engineer #${suffix}`,
    company: overrides.company ?? 'Acme Co',
    url,
    location: overrides.location ?? 'Remote',
    remote: overrides.remote ?? true,
    body: overrides.body ?? '',
    bodyPreview: overrides.bodyPreview,
    tags: overrides.tags ?? ['react', 'typescript'],
    salary: overrides.salary ?? null,
    salaryMin: overrides.salaryMin ?? null,
    salaryMax: overrides.salaryMax ?? null,
    salaryCurrency: overrides.salaryCurrency ?? null,
    postedAt: overrides.postedAt ?? '2026-05-10T00:00:00.000Z',
    fetchedAt: overrides.fetchedAt ?? '2026-05-15T00:00:00.000Z',
    fitScore: overrides.fitScore ?? 80,
    categories: overrides.categories ?? [],
  };
}

export interface FixtureLayout {
  dir: string;
  jobsPath: string;
  appliedPath: string;
  reviewsPath: string;
  jobsBodiesPath: string;
  briefPath: string;
  cleanup: () => Promise<void>;
}

export interface FixtureContent {
  jobs?: Job[];
  applied?: AppliedEntry[];
  reviews?: AiReviews;
  jobsBodies?: Record<string, string>;
  brief?: string;
}

export async function buildFixture(content: FixtureContent = {}): Promise<FixtureLayout> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pupila-mcp-test-'));
  const jobsPath = path.join(dir, 'jobs.json');
  const appliedPath = path.join(dir, 'applied.json');
  const reviewsPath = path.join(dir, 'ai-reviews.json');
  const jobsBodiesPath = path.join(dir, 'jobs-bodies.json');
  const briefPath = path.join(dir, 'candidate-brief.md');

  if (content.jobs) await writeFile(jobsPath, JSON.stringify(content.jobs), 'utf8');
  if (content.applied) await writeFile(appliedPath, JSON.stringify(content.applied), 'utf8');
  if (content.reviews) await writeFile(reviewsPath, JSON.stringify(content.reviews), 'utf8');
  if (content.jobsBodies)
    await writeFile(jobsBodiesPath, JSON.stringify(content.jobsBodies), 'utf8');
  if (content.brief !== undefined) await writeFile(briefPath, content.brief, 'utf8');

  return {
    dir,
    jobsPath,
    appliedPath,
    reviewsPath,
    jobsBodiesPath,
    briefPath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function parseToolJson(content: { type: 'text'; text: string }[]): unknown {
  const first = content[0];
  if (!first) throw new Error('empty content');
  return JSON.parse(first.text);
}
