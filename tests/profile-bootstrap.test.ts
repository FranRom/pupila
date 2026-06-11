import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilters, loadProfile } from '../src/filters.js';
import { bootstrapProfileIfMissing } from '../src/lib/profile-bootstrap.js';

const REPO_DEFAULT = path.resolve('config/profile.default.json');

describe('bootstrapProfileIfMissing', () => {
  let dir: string;
  let defaultPath: string;
  let profilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'profile-bootstrap-'));
    defaultPath = path.join(dir, 'profile.default.json');
    profilePath = path.join(dir, 'profile.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('copies the default to profile.json when missing', async () => {
    await writeFile(defaultPath, '{"scoring":{},"weights":{},"keywords":{}}', 'utf8');
    const result = await bootstrapProfileIfMissing({ defaultPath, profilePath });
    expect(result.bootstrapped).toBe(true);
    const written = await readFile(profilePath, 'utf8');
    expect(JSON.parse(written)).toEqual({ scoring: {}, weights: {}, keywords: {} });
  });

  it('is a no-op when profile.json already exists', async () => {
    await writeFile(defaultPath, '{"scoring":{},"weights":{},"keywords":{}}', 'utf8');
    await writeFile(profilePath, '{"already":"there"}', 'utf8');
    const result = await bootstrapProfileIfMissing({ defaultPath, profilePath });
    expect(result.bootstrapped).toBe(false);
    const written = await readFile(profilePath, 'utf8');
    expect(JSON.parse(written)).toEqual({ already: 'there' });
  });

  it('propagates non-EEXIST errors (e.g. missing default file)', async () => {
    await expect(bootstrapProfileIfMissing({ defaultPath, profilePath })).rejects.toThrow();
  });
});

describe('committed config/profile.default.json', () => {
  let dir: string;
  let profilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'profile-default-shape-'));
    profilePath = path.join(dir, 'profile.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads as a valid FilterProfile and builds a working filter', async () => {
    await bootstrapProfileIfMissing({ defaultPath: REPO_DEFAULT, profilePath });
    const profile = await loadProfile(profilePath);
    expect(profile.scoring.minScoreToKeep).toBeTypeOf('number');
    expect(profile.weights).toBeTypeOf('object');
    expect(profile.keywords).toBeTypeOf('object');
    // createFilters compiles every keyword list to a regex on load — this
    // catches a malformed fragment in profile.default.json at test time
    // instead of mid-run for someone who just cloned the repo.
    const { applyFilters } = createFilters(profile);
    expect(applyFilters([]).kept).toEqual([]);
  });

  it('zeroes every personal weight in the default', async () => {
    await bootstrapProfileIfMissing({ defaultPath: REPO_DEFAULT, profilePath });
    const profile = await loadProfile(profilePath);
    const personal = ['stackPrimary', 'stackRn', 'stackOther', 'roleTitle', 'roleBody'] as const;
    for (const key of personal) {
      expect(profile.weights[key]).toBe(0);
    }
  });

  it('ships an empty roles array in the default', async () => {
    await bootstrapProfileIfMissing({ defaultPath: REPO_DEFAULT, profilePath });
    const profile = await loadProfile(profilePath);
    expect(profile.roles).toEqual([]);
  });

  it('leaves every personal keyword array empty in the default', async () => {
    await bootstrapProfileIfMissing({ defaultPath: REPO_DEFAULT, profilePath });
    const profile = await loadProfile(profilePath);
    const personal = ['stackPrimary', 'stackRn', 'stackOther', 'titleExcludedSpecialties'] as const;
    for (const key of personal) {
      const value = profile.keywords[key];
      expect(Array.isArray(value)).toBe(true);
      expect((value as readonly string[]).length).toBe(0);
    }
  });
});
