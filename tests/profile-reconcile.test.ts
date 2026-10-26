import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProfile } from '../src/filters.js';
import { reconcileLocationLock } from '../src/lib/profile-reconcile.js';

describe('reconcileLocationLock', () => {
  it('adds shipped fragments the personal list lacks', () => {
    expect(reconcileLocationLock(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops fragments an earlier release shipped and a later one replaced', () => {
    const out = reconcileLocationLock(['relocat(e|ion|ing)', 'in[- ]office', 'mine'], ['new']);
    expect(out).toEqual(['mine', 'new']);
  });

  it("keeps the user's own fragments and does not duplicate shipped ones", () => {
    expect(reconcileLocationLock(['mine', 'a'], ['a'])).toEqual(['mine', 'a']);
  });
});

describe('loadProfile — shipped lock fragments reach an existing profile.json', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'profile-reconcile-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const profile = (locationLock: string[]) =>
    JSON.stringify({ scoring: {}, weights: {}, keywords: { locationLock } });

  it('merges the sibling profile.default.json in memory and leaves the file alone', async () => {
    const personalPath = path.join(dir, 'profile.json');
    const original = profile(['relocat(e|ion|ing)', 'mine']);
    await writeFile(personalPath, original);
    await writeFile(path.join(dir, 'profile.default.json'), profile(['citizenship required']));
    const loaded = await loadProfile(personalPath);
    expect(loaded.keywords.locationLock).toEqual(['mine', 'citizenship required']);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(personalPath, 'utf8')).toBe(original);
  });

  it('is a no-op without a sibling default', async () => {
    const personalPath = path.join(dir, 'profile.json');
    await writeFile(personalPath, profile(['mine']));
    expect((await loadProfile(personalPath)).keywords.locationLock).toEqual(['mine']);
  });
});
