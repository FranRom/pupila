import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClearApplied } from '../../src/mcp/tools/clear-applied.js';
import { type AppliedMutationPaths, runMarkApplied } from '../../src/mcp/tools/mark-applied.js';
import { runUpdateStatus } from '../../src/mcp/tools/update-status.js';
import type { AppliedEntry } from '../../src/types.js';
import { buildFixture, type FixtureLayout, jobIdFor, makeJob, parseToolJson } from './_fixtures.js';

function pathsFor(fx: FixtureLayout): AppliedMutationPaths {
  return { appliedPath: fx.appliedPath, jobsPath: fx.jobsPath };
}

async function readEntries(p: string): Promise<AppliedEntry[]> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as AppliedEntry[];
  } catch {
    return [];
  }
}

describe('mark_applied / update_status / clear_applied', () => {
  let fx: FixtureLayout;
  const targetUrl = 'https://applied.example/job-a';
  const otherUrl = 'https://applied.example/job-b';

  beforeEach(async () => {
    fx = await buildFixture({
      jobs: [makeJob({ url: targetUrl }), makeJob({ url: otherUrl })],
    });
  });

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  describe('mark_applied', () => {
    it('creates a new entry with default status applied + today date', async () => {
      const result = await runMarkApplied({ url: targetUrl, status: 'applied' }, pathsFor(fx));
      const payload = parseToolJson(result.content) as {
        ok: boolean;
        created: boolean;
        entry: AppliedEntry;
      };
      expect(payload.ok).toBe(true);
      expect(payload.created).toBe(true);
      expect(payload.entry.url).toBe(targetUrl);
      expect(payload.entry.status).toBe('applied');
      expect(payload.entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const entries = await readEntries(fx.appliedPath);
      expect(entries).toHaveLength(1);
    });

    it('upserts existing entry by URL (overwrites)', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied', notes: 'first' }, pathsFor(fx));
      const result = await runMarkApplied(
        { url: targetUrl, status: 'interview', notes: 'updated' },
        pathsFor(fx),
      );
      const payload = parseToolJson(result.content) as { created: boolean; entry: AppliedEntry };
      expect(payload.created).toBe(false);
      expect(payload.entry.status).toBe('interview');
      expect(payload.entry.notes).toBe('updated');

      const entries = await readEntries(fx.appliedPath);
      expect(entries).toHaveLength(1);
    });

    it('accepts jobId and resolves the URL from jobs.json', async () => {
      const jobId = jobIdFor(targetUrl);
      const result = await runMarkApplied({ jobId, status: 'applied' }, pathsFor(fx));
      const payload = parseToolJson(result.content) as { entry: AppliedEntry };
      expect(payload.entry.url).toBe(targetUrl);
    });

    it('returns error envelope when neither url nor jobId provided', async () => {
      const result = await runMarkApplied({ status: 'applied' }, pathsFor(fx));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires either');
    });

    it('returns error envelope when jobId is not in jobs.json', async () => {
      const ghost = 'f'.repeat(40);
      const result = await runMarkApplied({ jobId: ghost, status: 'applied' }, pathsFor(fx));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
    });

    it('writes atomically (no partial file on a fresh write)', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied' }, pathsFor(fx));
      const text = await readFile(fx.appliedPath, 'utf8');
      // Atomic write produces a complete, parseable JSON file.
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text.endsWith('\n')).toBe(true);
    });
  });

  describe('update_status', () => {
    it('requires status (Zod) and an existing entry (runtime)', async () => {
      // Try update on a URL that hasn't been marked yet.
      const result = await runUpdateStatus({ url: targetUrl, status: 'interview' }, pathsFor(fx));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('no applied entry');
    });

    it('updates an existing entry preserving non-patched fields', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied', notes: 'initial' }, pathsFor(fx));
      const result = await runUpdateStatus({ url: targetUrl, status: 'offer' }, pathsFor(fx));
      const payload = parseToolJson(result.content) as { entry: AppliedEntry };
      expect(payload.entry.status).toBe('offer');
      expect(payload.entry.notes).toBe('initial');
    });

    it('explicitly clears notes when passed an empty string', async () => {
      await runMarkApplied(
        { url: targetUrl, status: 'applied', notes: 'will be cleared' },
        pathsFor(fx),
      );
      const result = await runUpdateStatus(
        { url: targetUrl, status: 'applied', notes: '' },
        pathsFor(fx),
      );
      const payload = parseToolJson(result.content) as { entry: AppliedEntry };
      expect(payload.entry.notes).toBe('');
    });
  });

  describe('clear_applied', () => {
    it('removes an existing entry by URL', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied' }, pathsFor(fx));
      const result = await runClearApplied({ url: targetUrl }, pathsFor(fx));
      const payload = parseToolJson(result.content) as { ok: boolean; removed: number };
      expect(payload.ok).toBe(true);
      expect(payload.removed).toBe(1);

      const entries = await readEntries(fx.appliedPath);
      expect(entries).toHaveLength(0);
    });

    it('removes by jobId', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied' }, pathsFor(fx));
      const jobId = jobIdFor(targetUrl);
      const result = await runClearApplied({ jobId }, pathsFor(fx));
      const payload = parseToolJson(result.content) as { removed: number };
      expect(payload.removed).toBe(1);
    });

    it('is idempotent — removed: 0 when no entry exists, not an error', async () => {
      const result = await runClearApplied({ url: targetUrl }, pathsFor(fx));
      expect(result.isError).toBeUndefined();
      const payload = parseToolJson(result.content) as { ok: boolean; removed: number };
      expect(payload.ok).toBe(true);
      expect(payload.removed).toBe(0);
    });

    it('does not affect other entries', async () => {
      await runMarkApplied({ url: targetUrl, status: 'applied' }, pathsFor(fx));
      await runMarkApplied({ url: otherUrl, status: 'interview' }, pathsFor(fx));
      await runClearApplied({ url: targetUrl }, pathsFor(fx));
      const entries = await readEntries(fx.appliedPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.url).toBe(otherUrl);
    });
  });
});
