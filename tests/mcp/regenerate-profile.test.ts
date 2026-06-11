import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PersonalizationDelta, ProfileShape } from '../../src/lib/profile-generator.js';
import {
  __resetRegenerateProfileLockForTests,
  type RegenerateProfileDeps,
  runRegenerateProfile,
} from '../../src/mcp/tools/regenerate-profile.js';
import { buildFixture, type FixtureLayout, parseToolJson } from './_fixtures.js';

interface RegenSuccess {
  ok: true;
  provider: string;
  weightsChanged: string[];
  keywordsChanged: string[];
  rolesChanged: boolean;
  categoriesChanged: boolean;
}

function baseProfile(): ProfileShape {
  return {
    weights: { stackPrimary: 5 },
    keywords: { stackPrimary: ['react'] },
  };
}

function stubGenerate(delta: PersonalizationDelta) {
  return async (_brief: string, _provider: unknown) => delta;
}

function depsWith(
  fx: FixtureLayout,
  generate: (brief: string, provider: unknown) => Promise<PersonalizationDelta>,
): RegenerateProfileDeps {
  const profilePath = path.join(fx.dir, 'profile.json');
  return {
    briefPath: fx.briefPath,
    profilePath,
    readBrief: async (p) => {
      try {
        return await readFile(p, 'utf8');
      } catch {
        return null;
      }
    },
    generateDelta: generate as RegenerateProfileDeps['generateDelta'],
  };
}

describe('regenerate_profile', () => {
  let fx: FixtureLayout;

  beforeEach(() => {
    __resetRegenerateProfileLockForTests();
  });

  afterEach(async () => {
    __resetRegenerateProfileLockForTests();
    if (fx) await fx.cleanup();
  });

  it('returns precondition error when the brief is missing', async () => {
    fx = await buildFixture({});
    const deps = depsWith(fx, stubGenerate({ weights: {}, keywords: {} }));
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');
    const result = await runRegenerateProfile({}, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('candidate-brief');
  });

  it('returns precondition error when profile.json is missing/unparseable', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · remote' });
    const deps = depsWith(fx, stubGenerate({ weights: {}, keywords: {} }));
    const result = await runRegenerateProfile({}, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('profile.json');
  });

  it('merges weights + keywords from the delta and reports what changed', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · remote' });
    const deps = depsWith(
      fx,
      stubGenerate({
        weights: { stackPrimary: 20, stackOther: 15 },
        keywords: { stackPrimary: ['react', 'vue'], stackOther: ['graphql'] },
      }),
    );
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    const result = await runRegenerateProfile({ provider: 'auto' }, deps);
    expect(result.isError).toBeUndefined();
    const payload = parseToolJson(result.content) as RegenSuccess;
    expect(payload.ok).toBe(true);
    expect(payload.provider).toBe('auto');
    expect(payload.weightsChanged).toContain('stackPrimary');
    expect(payload.weightsChanged).toContain('stackOther');
    expect(payload.keywordsChanged).toContain('stackPrimary');
    expect(payload.keywordsChanged).toContain('stackOther');

    // Verify the merge actually landed in the file.
    const written = JSON.parse(await readFile(deps.profilePath, 'utf8')) as ProfileShape;
    expect(written.weights.stackPrimary).toBe(20);
    expect(written.keywords.stackPrimary).toEqual(['react', 'vue']);
  });

  it('merges categories[] from the delta and reports categoriesChanged', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · ai · remote' });
    const deps = depsWith(
      fx,
      stubGenerate({
        weights: {},
        keywords: {},
        categories: [
          { id: 'web3', label: 'Web3', keywords: ['web3', 'defi'], weight: 20 },
          { id: 'ai', label: 'AI', keywords: ['llm', 'anthropic'] },
        ],
      }),
    );
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    const result = await runRegenerateProfile({}, deps);
    expect(result.isError).toBeUndefined();
    const payload = parseToolJson(result.content) as RegenSuccess;
    expect(payload.categoriesChanged).toBe(true);

    const written = JSON.parse(await readFile(deps.profilePath, 'utf8')) as ProfileShape;
    expect(written.categories?.map((c) => c.id)).toEqual(['web3', 'ai']);
  });

  it('merges roles[] from the delta and reports rolesChanged', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer + Product Engineer · remote' });
    const deps = depsWith(
      fx,
      stubGenerate({
        weights: {},
        keywords: {},
        roles: [
          { id: 'frontend', label: 'Frontend Engineer', titleMatch: ['frontend'] },
          { id: 'product', label: 'Product Engineer', titleMatch: ['product engineer'] },
        ],
      }),
    );
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    const result = await runRegenerateProfile({}, deps);
    expect(result.isError).toBeUndefined();
    const payload = parseToolJson(result.content) as RegenSuccess;
    expect(payload.rolesChanged).toBe(true);

    const written = JSON.parse(await readFile(deps.profilePath, 'utf8')) as ProfileShape;
    expect(written.roles?.map((r) => r.id)).toEqual(['frontend', 'product']);
  });

  it('passes a non-auto provider through to the generator', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · remote' });
    const captured: { provider?: string } = {};
    const deps = depsWith(fx, async (_brief, provider) => {
      captured.provider = provider as string | undefined;
      return { weights: {}, keywords: {} };
    });
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    await runRegenerateProfile({ provider: 'claude' }, deps);
    expect(captured.provider).toBe('claude');
  });

  it("converts provider='auto' to undefined for the generator", async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · remote' });
    const captured: { provider?: unknown } = {};
    const deps = depsWith(fx, async (_brief, provider) => {
      captured.provider = provider;
      return { weights: {}, keywords: {} };
    });
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    await runRegenerateProfile({ provider: 'auto' }, deps);
    expect(captured.provider).toBeUndefined();
  });

  it('single-flight: second concurrent call returns an error envelope', async () => {
    fx = await buildFixture({ brief: 'Senior FE engineer · web3 · remote' });
    let resolveFirst: (() => void) | null = null;
    const deps = depsWith(
      fx,
      async () =>
        new Promise<PersonalizationDelta>((resolve) => {
          resolveFirst = () => resolve({ weights: {}, keywords: {} });
        }),
    );
    await writeFile(deps.profilePath, JSON.stringify(baseProfile()), 'utf8');

    const firstPromise = runRegenerateProfile({}, deps);
    // Yield so the lock is acquired by the first call.
    await new Promise((r) => setTimeout(r, 5));
    const second = await runRegenerateProfile({}, deps);
    expect(second.isError).toBe(true);
    expect(second.content[0]?.text).toContain('already running');

    if (!resolveFirst) throw new Error('first call never reached generator');
    (resolveFirst as () => void)();
    await firstPromise;
  });
});
