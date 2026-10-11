import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addFavorite,
  hasFavorite,
  listFavoriteIds,
  loadFavorites,
  removeFavorite,
} from '../src/lib/favorites.js';

// Each test gets its own tmp directory to avoid cross-test contamination
let tmpDir: string;
let favoritesPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'favorites-test-'));
  favoritesPath = join(tmpDir, 'favorites.json');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('loadFavorites', () => {
  it('returns { favorites: [] } when file is missing', async () => {
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [] });
  });

  it('returns { favorites: [] } when file contains malformed JSON', async () => {
    await writeFile(favoritesPath, 'not valid json', 'utf8');
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [] });
  });

  it('returns { favorites: [] } when .favorites is not an array', async () => {
    await writeFile(favoritesPath, JSON.stringify({ favorites: 'oops' }), 'utf8');
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [] });
  });

  it('returns { favorites: [] } when file contains a bare array instead of envelope', async () => {
    await writeFile(
      favoritesPath,
      JSON.stringify([{ jobId: 'abc', favoritedAt: '2026-05-11T10:00:00.000Z' }]),
      'utf8',
    );
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [] });
  });

  it('returns parsed favorites when file is valid', async () => {
    const data = {
      favorites: [{ jobId: 'abc123', favoritedAt: '2026-05-11T10:23:00.000Z' }],
    };
    await writeFile(favoritesPath, JSON.stringify(data), 'utf8');
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual(data);
  });
});

describe('addFavorite', () => {
  it('creates the file with one entry when file is missing', async () => {
    await addFavorite('job-001', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites).toHaveLength(1);
    expect(result.favorites[0]?.jobId).toBe('job-001');
  });

  it('is idempotent: adding the same jobId twice results in one entry only', async () => {
    await addFavorite('job-002', favoritesPath);
    await addFavorite('job-002', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites.filter((f) => f.jobId === 'job-002')).toHaveLength(1);
  });

  it('does not update favoritedAt when jobId already exists', async () => {
    await addFavorite('job-003', favoritesPath);
    const first = await loadFavorites(favoritesPath);
    const firstTime = first.favorites[0]?.favoritedAt;

    await addFavorite('job-003', favoritesPath);
    const second = await loadFavorites(favoritesPath);
    expect(second.favorites[0]?.favoritedAt).toBe(firstTime);
  });

  it('writes a valid ISO 8601 favoritedAt timestamp', async () => {
    await addFavorite('job-004', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    const favoritedAt = result.favorites[0]?.favoritedAt ?? '';
    expect(favoritedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('accumulates multiple distinct jobIds', async () => {
    await addFavorite('job-005', favoritesPath);
    await addFavorite('job-006', favoritesPath);
    await addFavorite('job-007', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites).toHaveLength(3);
    const ids = result.favorites.map((f) => f.jobId);
    expect(ids).toContain('job-005');
    expect(ids).toContain('job-006');
    expect(ids).toContain('job-007');
  });

  it('is atomic: no .tmp file leftover after a successful write', async () => {
    await addFavorite('job-008', favoritesPath);
    const { access } = await import('node:fs/promises');
    const tmpExists = await access(`${favoritesPath}.tmp`)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it('creates parent directory if missing', async () => {
    const nestedPath = join(tmpDir, 'nested', 'deep', 'favorites.json');
    await addFavorite('job-009', nestedPath);
    const result = await loadFavorites(nestedPath);
    expect(result.favorites).toHaveLength(1);
    expect(result.favorites[0]?.jobId).toBe('job-009');
  });

  it('written file is valid JSON readable directly', async () => {
    await addFavorite('job-010', favoritesPath);
    const raw = await readFile(favoritesPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).toHaveProperty('favorites');
  });
});

describe('removeFavorite', () => {
  it('removes an existing entry', async () => {
    await addFavorite('remove-job-1', favoritesPath);
    await addFavorite('remove-job-2', favoritesPath);
    await removeFavorite('remove-job-1', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites).toHaveLength(1);
    expect(result.favorites[0]?.jobId).toBe('remove-job-2');
  });

  it('is a no-op when jobId is not present (does not throw)', async () => {
    await addFavorite('keep-job', favoritesPath);
    await expect(removeFavorite('not-present', favoritesPath)).resolves.toBeUndefined();
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites).toHaveLength(1);
    expect(result.favorites[0]?.jobId).toBe('keep-job');
  });

  it('works on a missing file (no-op, does not throw)', async () => {
    await expect(removeFavorite('any-job', favoritesPath)).resolves.toBeUndefined();
    const result = await loadFavorites(favoritesPath);
    expect(result.favorites).toHaveLength(0);
  });

  it('removes only the target jobId, not others', async () => {
    await addFavorite('alpha', favoritesPath);
    await addFavorite('beta', favoritesPath);
    await addFavorite('gamma', favoritesPath);
    await removeFavorite('beta', favoritesPath);
    const result = await loadFavorites(favoritesPath);
    const ids = result.favorites.map((f) => f.jobId);
    expect(ids).toContain('alpha');
    expect(ids).not.toContain('beta');
    expect(ids).toContain('gamma');
    expect(ids).toHaveLength(2);
  });

  it('is atomic: no .tmp file leftover after a successful remove', async () => {
    await addFavorite('atomic-job', favoritesPath);
    await removeFavorite('atomic-job', favoritesPath);
    const { access } = await import('node:fs/promises');
    const tmpExists = await access(`${favoritesPath}.tmp`)
      .then(() => true)
      .catch(() => false);
    expect(tmpExists).toBe(false);
  });

  it('result is valid JSON after remove', async () => {
    await addFavorite('json-job', favoritesPath);
    await removeFavorite('json-job', favoritesPath);
    const raw = await readFile(favoritesPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).toHaveProperty('favorites');
  });
});

describe('hasFavorite', () => {
  it('returns false for an unknown jobId on missing file', async () => {
    const result = await hasFavorite('not-there', favoritesPath);
    expect(result).toBe(false);
  });

  it('returns false for an unknown jobId on existing file', async () => {
    await addFavorite('known-job', favoritesPath);
    const result = await hasFavorite('unknown-job', favoritesPath);
    expect(result).toBe(false);
  });

  it('returns true for a jobId that was added', async () => {
    await addFavorite('existing-job', favoritesPath);
    const result = await hasFavorite('existing-job', favoritesPath);
    expect(result).toBe(true);
  });
});

describe('listFavoriteIds', () => {
  it('returns an empty Set when file is missing', async () => {
    const result = await listFavoriteIds(favoritesPath);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('returns a Set containing all added jobIds', async () => {
    await addFavorite('set-job-1', favoritesPath);
    await addFavorite('set-job-2', favoritesPath);
    await addFavorite('set-job-3', favoritesPath);
    const result = await listFavoriteIds(favoritesPath);
    expect(result).toBeInstanceOf(Set);
    expect(result.has('set-job-1')).toBe(true);
    expect(result.has('set-job-2')).toBe(true);
    expect(result.has('set-job-3')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('supports O(1) .has() lookups', async () => {
    await addFavorite('lookup-job', favoritesPath);
    const ids = await listFavoriteIds(favoritesPath);
    expect(ids.has('lookup-job')).toBe(true);
    expect(ids.has('missing-job')).toBe(false);
  });
});
