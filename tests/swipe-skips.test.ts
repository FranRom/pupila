import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addSwipeSkip,
  hasSwipeSkip,
  listSwipeSkipIds,
  loadSwipeSkips,
} from '../src/lib/swipe-skips.js';

// Each test gets its own tmp directory to avoid cross-test contamination
let tmpDir: string;
let skipsPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'swipe-skips-test-'));
  skipsPath = join(tmpDir, 'swipe-skips.json');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('loadSwipeSkips', () => {
  it('returns { skips: [] } when file is missing', async () => {
    const result = await loadSwipeSkips(skipsPath);
    expect(result).toEqual({ skips: [] });
  });

  it('returns { skips: [] } when file contains malformed JSON', async () => {
    await writeFile(skipsPath, 'not valid json', 'utf8');
    const result = await loadSwipeSkips(skipsPath);
    expect(result).toEqual({ skips: [] });
  });

  it('returns { skips: [] } when .skips is not an array', async () => {
    await writeFile(skipsPath, JSON.stringify({ skips: 'oops' }), 'utf8');
    const result = await loadSwipeSkips(skipsPath);
    expect(result).toEqual({ skips: [] });
  });

  it('returns { skips: [] } when file contains a bare array instead of envelope', async () => {
    await writeFile(
      skipsPath,
      JSON.stringify([{ jobId: 'abc', skippedAt: '2026-05-11T10:00:00.000Z' }]),
      'utf8',
    );
    const result = await loadSwipeSkips(skipsPath);
    expect(result).toEqual({ skips: [] });
  });

  it('returns parsed skips when file is valid', async () => {
    const data = {
      skips: [{ jobId: 'abc123', skippedAt: '2026-05-11T10:23:00.000Z' }],
    };
    await writeFile(skipsPath, JSON.stringify(data), 'utf8');
    const result = await loadSwipeSkips(skipsPath);
    expect(result).toEqual(data);
  });
});

describe('addSwipeSkip', () => {
  it('creates the file with one entry when file is missing', async () => {
    await addSwipeSkip('job-001', skipsPath);
    const result = await loadSwipeSkips(skipsPath);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]?.jobId).toBe('job-001');
  });

  it('is idempotent: adding the same jobId twice results in one entry only', async () => {
    await addSwipeSkip('job-002', skipsPath);
    await addSwipeSkip('job-002', skipsPath);
    const result = await loadSwipeSkips(skipsPath);
    expect(result.skips.filter((s) => s.jobId === 'job-002')).toHaveLength(1);
  });

  it('does not update skippedAt when jobId already exists', async () => {
    await addSwipeSkip('job-003', skipsPath);
    const first = await loadSwipeSkips(skipsPath);
    const firstTime = first.skips[0]?.skippedAt;

    await addSwipeSkip('job-003', skipsPath);
    const second = await loadSwipeSkips(skipsPath);
    expect(second.skips[0]?.skippedAt).toBe(firstTime);
  });

  it('writes a valid ISO 8601 skippedAt timestamp', async () => {
    await addSwipeSkip('job-004', skipsPath);
    const result = await loadSwipeSkips(skipsPath);
    const skippedAt = result.skips[0]?.skippedAt ?? '';
    expect(skippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('accumulates multiple distinct jobIds', async () => {
    await addSwipeSkip('job-005', skipsPath);
    await addSwipeSkip('job-006', skipsPath);
    await addSwipeSkip('job-007', skipsPath);
    const result = await loadSwipeSkips(skipsPath);
    expect(result.skips).toHaveLength(3);
    const ids = result.skips.map((s) => s.jobId);
    expect(ids).toContain('job-005');
    expect(ids).toContain('job-006');
    expect(ids).toContain('job-007');
  });

  it('is atomic: no .tmp file leftover after a successful write', async () => {
    await addSwipeSkip('job-008', skipsPath);
    const { access } = await import('node:fs/promises');
    const tmpExists = await access(`${skipsPath}.tmp`)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it('creates parent directory if missing', async () => {
    const nestedPath = join(tmpDir, 'nested', 'deep', 'swipe-skips.json');
    await addSwipeSkip('job-009', nestedPath);
    const result = await loadSwipeSkips(nestedPath);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]?.jobId).toBe('job-009');
  });

  it('written file is valid JSON readable directly', async () => {
    await addSwipeSkip('job-010', skipsPath);
    const raw = await readFile(skipsPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).toHaveProperty('skips');
  });
});

describe('hasSwipeSkip', () => {
  it('returns false for an unknown jobId on missing file', async () => {
    const result = await hasSwipeSkip('not-there', skipsPath);
    expect(result).toBe(false);
  });

  it('returns false for an unknown jobId on existing file', async () => {
    await addSwipeSkip('known-job', skipsPath);
    const result = await hasSwipeSkip('unknown-job', skipsPath);
    expect(result).toBe(false);
  });

  it('returns true for a jobId that was added', async () => {
    await addSwipeSkip('existing-job', skipsPath);
    const result = await hasSwipeSkip('existing-job', skipsPath);
    expect(result).toBe(true);
  });
});

describe('listSwipeSkipIds', () => {
  it('returns an empty Set when file is missing', async () => {
    const result = await listSwipeSkipIds(skipsPath);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('returns a Set containing all added jobIds', async () => {
    await addSwipeSkip('set-job-1', skipsPath);
    await addSwipeSkip('set-job-2', skipsPath);
    await addSwipeSkip('set-job-3', skipsPath);
    const result = await listSwipeSkipIds(skipsPath);
    expect(result).toBeInstanceOf(Set);
    expect(result.has('set-job-1')).toBe(true);
    expect(result.has('set-job-2')).toBe(true);
    expect(result.has('set-job-3')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('supports O(1) .has() lookups', async () => {
    await addSwipeSkip('lookup-job', skipsPath);
    const ids = await listSwipeSkipIds(skipsPath);
    expect(ids.has('lookup-job')).toBe(true);
    expect(ids.has('missing-job')).toBe(false);
  });
});
