import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    expect(result).toEqual({ favorites: [], damaged: true });
  });

  it('returns { favorites: [] } when .favorites is not an array', async () => {
    await writeFile(favoritesPath, JSON.stringify({ favorites: 'oops' }), 'utf8');
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [], damaged: true });
  });

  it('returns { favorites: [] } when file contains a bare array instead of envelope', async () => {
    await writeFile(
      favoritesPath,
      JSON.stringify([{ jobId: 'abc', favoritedAt: '2026-05-11T10:00:00.000Z' }]),
      'utf8',
    );
    const result = await loadFavorites(favoritesPath);
    expect(result).toEqual({ favorites: [], damaged: true });
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
    // The store writes to a unique `<path>.<pid>.<uuid>.tmp`, so look for ANY
    // leftover temp file, not one fixed name the implementation never uses.
    expect((await readdir(tmpDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
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
    // The store writes to a unique `<path>.<pid>.<uuid>.tmp`, so look for ANY
    // leftover temp file, not one fixed name the implementation never uses.
    expect((await readdir(tmpDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
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

describe('concurrent writes', () => {
  const id = (n: number) =>
    String(n % 10).repeat(39) + String.fromCharCode(97 + Math.floor(n / 10));

  it('keeps every favorite when many adds run at once', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => id(i));
    await Promise.all(ids.map((i) => addFavorite(i, favoritesPath)));
    expect(await listFavoriteIds(favoritesPath)).toEqual(new Set(ids));
  });

  it('applies overlapping add/remove in call order and leaves valid JSON', async () => {
    await addFavorite(id(1), favoritesPath);
    await Promise.all([
      addFavorite(id(2), favoritesPath),
      removeFavorite(id(1), favoritesPath),
      addFavorite(id(3), favoritesPath),
    ]);
    expect(await listFavoriteIds(favoritesPath)).toEqual(new Set([id(2), id(3)]));
    JSON.parse(await readFile(favoritesPath, 'utf8'));
  });

  it('leaves no temp files behind', async () => {
    await Promise.all([1, 2, 3, 4].map((n) => addFavorite(id(n), favoritesPath)));
    const files = await readdir(tmpDir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a failing write does not block later writes', async () => {
    await writeFile(join(tmpDir, 'blocker'), 'x');
    const bad = join(tmpDir, 'blocker', 'favorites.json');
    await expect(addFavorite(id(1), bad)).rejects.toThrow();
    await expect(addFavorite(id(1), bad)).rejects.toThrow();
    await addFavorite(id(2), favoritesPath);
    expect(await hasFavorite(id(2), favoritesPath)).toBe(true);
  });
});

describe('corrupt file protection', () => {
  it('moves an unreadable file aside instead of erasing it on the next write', async () => {
    await writeFile(favoritesPath, '{"favorites": [ {"jobId": "keepme"');
    await addFavorite('a'.repeat(40), favoritesPath);
    const files = await readdir(tmpDir);
    const aside = files.find((f) => f.startsWith('favorites.json.corrupt-'));
    expect(aside).toBeDefined();
    expect(await readFile(join(tmpDir, aside as string), 'utf8')).toContain('keepme');
    expect(await listFavoriteIds(favoritesPath)).toEqual(new Set(['a'.repeat(40)]));
  });

  it('does not quarantine a file that is simply missing', async () => {
    await addFavorite('a'.repeat(40), favoritesPath);
    expect((await readdir(tmpDir)).some((f) => f.includes('corrupt'))).toBe(false);
  });
});

describe('damaged file detection', () => {
  it('does not flag a missing file as damaged', async () => {
    expect(await loadFavorites(favoritesPath)).toEqual({ favorites: [] });
  });

  it('does not flag a healthy file', async () => {
    await addFavorite('a'.repeat(40), favoritesPath);
    expect((await loadFavorites(favoritesPath)).damaged).toBeUndefined();
  });

  it('flags an unparseable file so the caller can tell the user', async () => {
    await writeFile(favoritesPath, '{"favorites": [ {"jobId": "keepme"');
    expect(await loadFavorites(favoritesPath)).toEqual({ favorites: [], damaged: true });
  });

  it('flags a parseable file of the wrong shape', async () => {
    await writeFile(favoritesPath, '{"nope": true}');
    expect((await loadFavorites(favoritesPath)).damaged).toBe(true);
  });

  it('flags a file with some invalid entries but still returns the valid ones', async () => {
    await writeFile(
      favoritesPath,
      JSON.stringify({ favorites: [{ jobId: 'partial' }, { jobId: 'ok', favoritedAt: 'x' }] }),
    );
    const r = await loadFavorites(favoritesPath);
    expect(r.damaged).toBe(true);
    expect(r.favorites.map((f) => f.jobId)).toEqual(['ok']);
  });
});

describe('partially invalid file', () => {
  it('keeps the valid entries and copies the original aside before the write', async () => {
    const original = JSON.stringify({
      favorites: [{ jobId: 'partial' }, { jobId: 'ok', favoritedAt: 'x' }],
    });
    await writeFile(favoritesPath, original);
    await addFavorite('b'.repeat(40), favoritesPath);

    expect([...(await listFavoriteIds(favoritesPath))].sort()).toEqual(['b'.repeat(40), 'ok']);
    const aside = (await readdir(tmpDir)).find((f) => f.startsWith('favorites.json.corrupt-'));
    expect(aside).toBeDefined();
    // The invalid entry is recoverable from the copy, not erased by the write.
    expect(await readFile(join(tmpDir, aside as string), 'utf8')).toBe(original);
  });
});
