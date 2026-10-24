import { describe, expect, it } from 'vitest';
import {
  mergeProfile,
  type ProfileShape,
  parsePersonalizationDelta,
  sanitizeCategories,
  sanitizeLocation,
} from '../src/lib/profile-generator.js';

describe('parsePersonalizationDelta MED-6 complexity guard', () => {
  it('drops nested-quantifier patterns like (a+)+', () => {
    const raw = JSON.stringify({ keywords: { stackPrimary: ['(a+)+', 'react'] } });
    const out = parsePersonalizationDelta(raw);
    expect(out.keywords.stackPrimary).toEqual(['react']);
  });

  it('drops greedy-wildcard patterns like (.*)*', () => {
    const raw = JSON.stringify({ keywords: { stackPrimary: ['(.*)*', 'next'] } });
    const out = parsePersonalizationDelta(raw);
    expect(out.keywords.stackPrimary).toEqual(['next']);
  });

  it('drops repeated-group patterns', () => {
    const raw = JSON.stringify({ keywords: { stackPrimary: ['(ab)(ab)', 'vue'] } });
    const out = parsePersonalizationDelta(raw);
    expect(out.keywords.stackPrimary).toEqual(['vue']);
  });

  it('drops patterns exceeding the quantifier budget', () => {
    const raw = JSON.stringify({ keywords: { stackPrimary: ['a+b*c?d+e*f?', 'svelte'] } });
    const out = parsePersonalizationDelta(raw);
    expect(out.keywords.stackPrimary).toEqual(['svelte']);
  });

  it('keeps simple patterns unchanged', () => {
    const raw = JSON.stringify({ keywords: { stackPrimary: ['react', 'next\\.?js', 'web3'] } });
    const out = parsePersonalizationDelta(raw);
    expect(out.keywords.stackPrimary).toEqual(['react', 'next\\.?js', 'web3']);
  });
});

describe('parsePersonalizationDelta — roles', () => {
  it('parses a roles array with id, label, titleMatch and optional bodyMatch', () => {
    const raw = JSON.stringify({
      roles: [
        {
          id: 'frontend',
          label: 'Frontend Engineer',
          titleMatch: ['frontend', 'react'],
          bodyMatch: ['design system'],
        },
        { id: 'product', label: 'Product Engineer', titleMatch: ['product engineer'] },
      ],
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.roles).toEqual([
      {
        id: 'frontend',
        label: 'Frontend Engineer',
        titleMatch: ['frontend', 'react'],
        bodyMatch: ['design system'],
      },
      { id: 'product', label: 'Product Engineer', titleMatch: ['product engineer'] },
    ]);
  });

  it('drops roles with no usable titleMatch', () => {
    const raw = JSON.stringify({
      roles: [
        { id: 'x', label: 'X', titleMatch: [] },
        { id: 'fe', label: 'FE', titleMatch: ['frontend'] },
      ],
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.roles).toEqual([{ id: 'fe', label: 'FE', titleMatch: ['frontend'] }]);
  });

  it('sanitizes risky regexes inside role titleMatch', () => {
    const raw = JSON.stringify({
      roles: [{ id: 'fe', label: 'FE', titleMatch: ['(a+)+', 'frontend'] }],
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.roles?.[0]?.titleMatch).toEqual(['frontend']);
  });

  it('drops roles missing id or label', () => {
    const raw = JSON.stringify({
      roles: [{ titleMatch: ['frontend'] }, { id: 'fe', titleMatch: ['frontend'] }],
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.roles ?? []).toEqual([]);
  });
});

describe('mergeProfile — roles', () => {
  it('replaces roles[] from the delta and reports the change', () => {
    const base: ProfileShape = {
      weights: {},
      keywords: {},
      roles: [{ id: 'old', label: 'Old', titleMatch: ['x'] }],
    };
    const out = mergeProfile(base, {
      weights: {},
      keywords: {},
      roles: [{ id: 'fe', label: 'FE', titleMatch: ['frontend'] }],
    });
    expect(out.profile.roles).toEqual([{ id: 'fe', label: 'FE', titleMatch: ['frontend'] }]);
    expect(out.rolesChanged).toBe(true);
  });

  it('leaves roles untouched when the delta carries none', () => {
    const base: ProfileShape = {
      weights: {},
      keywords: {},
      roles: [{ id: 'fe', label: 'FE', titleMatch: ['frontend'] }],
    };
    const out = mergeProfile(base, { weights: {}, keywords: {} });
    expect(out.profile.roles).toEqual([{ id: 'fe', label: 'FE', titleMatch: ['frontend'] }]);
    expect(out.rolesChanged).toBe(false);
  });
});

describe('sanitizeCategories', () => {
  it('keeps a valid category with scope/weight/limit', () => {
    const out = sanitizeCategories([
      {
        id: 'web3',
        label: 'Web3',
        keywords: ['web3', 'defi'],
        scope: 'body',
        weight: 20,
        limit: 5,
      },
    ]);
    expect(out).toEqual([
      {
        id: 'web3',
        label: 'Web3',
        keywords: ['web3', 'defi'],
        scope: 'body',
        weight: 20,
        limit: 5,
      },
    ]);
  });

  it('omits scope/weight/limit when absent or invalid (consumer defaults apply)', () => {
    const out = sanitizeCategories([
      { id: 'ai', label: 'AI', keywords: ['llm'], scope: 'bogus', weight: -3 },
    ]);
    expect(out).toEqual([{ id: 'ai', label: 'AI', keywords: ['llm'] }]);
  });

  it('drops categories with no usable keyword and dedupes by id', () => {
    const out = sanitizeCategories([
      { id: 'empty', label: 'Empty', keywords: [] },
      { id: 'web3', label: 'Web3', keywords: ['web3'] },
      { id: 'web3', label: 'Dupe', keywords: ['crypto'] },
    ]);
    expect(out).toEqual([{ id: 'web3', label: 'Web3', keywords: ['web3'] }]);
  });

  it('clamps weight to the 50 cap and keeps literal keywords (incl. punctuation)', () => {
    // Category keywords are literal terms, so punctuation like node.js / c++ is
    // preserved as-is (not dropped as "invalid regex").
    const out = sanitizeCategories([
      { id: 'x', label: 'X', keywords: ['node.js', 'c++'], weight: 999 },
    ]);
    expect(out).toEqual([{ id: 'x', label: 'X', keywords: ['node.js', 'c++'], weight: 50 }]);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeCategories(undefined)).toEqual([]);
    expect(sanitizeCategories('nope')).toEqual([]);
  });
});

describe('parsePersonalizationDelta — categories', () => {
  it('extracts a sanitized categories array', () => {
    const raw = JSON.stringify({
      categories: [{ id: 'web3', label: 'Web3', keywords: ['web3', 'defi'], weight: 20 }],
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.categories).toEqual([
      { id: 'web3', label: 'Web3', keywords: ['web3', 'defi'], weight: 20 },
    ]);
  });

  it('omits categories when none survive validation', () => {
    const raw = JSON.stringify({ categories: [{ id: 'x', label: 'X', keywords: [] }] });
    expect(parsePersonalizationDelta(raw).categories).toBeUndefined();
  });
});

describe('mergeProfile — categories', () => {
  it('replaces categories[] from the delta and reports the change', () => {
    const base: ProfileShape = {
      weights: {},
      keywords: {},
      categories: [{ id: 'old', label: 'Old', keywords: ['x'] }],
    };
    const out = mergeProfile(base, {
      weights: {},
      keywords: {},
      categories: [{ id: 'web3', label: 'Web3', keywords: ['web3'] }],
    });
    expect(out.profile.categories).toEqual([{ id: 'web3', label: 'Web3', keywords: ['web3'] }]);
    expect(out.categoriesChanged).toBe(true);
  });

  it('leaves categories untouched when the delta carries none', () => {
    const base: ProfileShape = {
      weights: {},
      keywords: {},
      categories: [{ id: 'web3', label: 'Web3', keywords: ['web3'] }],
    };
    const out = mergeProfile(base, { weights: {}, keywords: {} });
    expect(out.profile.categories).toEqual([{ id: 'web3', label: 'Web3', keywords: ['web3'] }]);
    expect(out.categoriesChanged).toBe(false);
  });
});

describe('sanitizeLocation', () => {
  it('coerces a valid location, lowercasing + de-duping regions', () => {
    const loc = sanitizeLocation({
      basedIn: '  Spain ',
      workTypes: ['remote', 'hybrid', 'bogus'],
      acceptedRegions: ['Europe', 'EUROPE', ' EMEA '],
      excludeOutsideAcceptedRegions: true,
    });
    expect(loc).toEqual({
      basedIn: 'Spain',
      workTypes: ['remote', 'hybrid'],
      acceptedRegions: ['europe', 'emea'],
      excludeOutsideAcceptedRegions: true,
    });
  });

  it('returns a neutral default for garbage input', () => {
    expect(sanitizeLocation(undefined)).toEqual({
      basedIn: '',
      workTypes: [],
      acceptedRegions: [],
      excludeOutsideAcceptedRegions: false,
    });
  });

  it('drops unknown workTypes and non-boolean exclude flag', () => {
    const loc = sanitizeLocation({ workTypes: ['onsite'], excludeOutsideAcceptedRegions: 'yes' });
    expect(loc.workTypes).toEqual(['onsite']);
    expect(loc.excludeOutsideAcceptedRegions).toBe(false);
  });

  describe('timezone fields', () => {
    it('keeps utcOffset and maxTimezoneDiffHours across a UI edit round-trip', () => {
      const loc = sanitizeLocation({
        basedIn: 'Thailand',
        workTypes: ['remote'],
        acceptedRegions: ['apac'],
        excludeOutsideAcceptedRegions: true,
        utcOffset: 7,
        maxTimezoneDiffHours: 6,
      });
      expect(loc.utcOffset).toBe(7);
      expect(loc.maxTimezoneDiffHours).toBe(6);
      // Idempotent: sanitizing an already-sanitized value changes nothing.
      expect(sanitizeLocation(loc)).toEqual(loc);
    });

    it('accepts fractional offsets and negative offsets', () => {
      expect(sanitizeLocation({ utcOffset: 5.5 }).utcOffset).toBe(5.5);
      expect(sanitizeLocation({ utcOffset: -8 }).utcOffset).toBe(-8);
    });

    it('omits utcOffset when absent, non-numeric or out of range', () => {
      expect('utcOffset' in sanitizeLocation({})).toBe(false);
      expect('utcOffset' in sanitizeLocation({ utcOffset: '7' })).toBe(false);
      expect('utcOffset' in sanitizeLocation({ utcOffset: Number.NaN })).toBe(false);
      expect('utcOffset' in sanitizeLocation({ utcOffset: 15 })).toBe(false);
      expect('utcOffset' in sanitizeLocation({ utcOffset: -13 })).toBe(false);
    });

    it('clamps maxTimezoneDiffHours to 12 and rejects negatives', () => {
      expect(sanitizeLocation({ maxTimezoneDiffHours: 40 }).maxTimezoneDiffHours).toBe(12);
      expect(sanitizeLocation({ maxTimezoneDiffHours: 0 }).maxTimezoneDiffHours).toBe(0);
      expect('maxTimezoneDiffHours' in sanitizeLocation({ maxTimezoneDiffHours: -1 })).toBe(false);
    });
  });
});

describe('parsePersonalizationDelta — location', () => {
  it('extracts a location with signal', () => {
    const raw = JSON.stringify({
      location: { basedIn: 'Spain', workTypes: ['remote'], acceptedRegions: ['Europe'] },
    });
    const out = parsePersonalizationDelta(raw);
    expect(out.location).toEqual({
      basedIn: 'Spain',
      workTypes: ['remote'],
      acceptedRegions: ['europe'],
      excludeOutsideAcceptedRegions: false,
    });
  });

  it('omits an empty/signal-less location object', () => {
    const raw = JSON.stringify({ location: { basedIn: '', workTypes: [], acceptedRegions: [] } });
    expect(parsePersonalizationDelta(raw).location).toBeUndefined();
  });
});

describe('mergeProfile — location', () => {
  it('replaces location from the delta and reports the change', () => {
    const base: ProfileShape = { weights: {}, keywords: {} };
    const out = mergeProfile(base, {
      weights: {},
      keywords: {},
      location: {
        basedIn: 'Spain',
        workTypes: ['remote'],
        acceptedRegions: ['europe'],
        excludeOutsideAcceptedRegions: true,
      },
    });
    expect(out.profile.location?.basedIn).toBe('Spain');
    expect(out.locationChanged).toBe(true);
  });

  it('leaves location untouched when the delta carries none', () => {
    const base: ProfileShape = {
      weights: {},
      keywords: {},
      location: {
        basedIn: 'Spain',
        workTypes: ['remote'],
        acceptedRegions: ['europe'],
        excludeOutsideAcceptedRegions: true,
      },
    };
    const out = mergeProfile(base, { weights: {}, keywords: {} });
    expect(out.profile.location?.basedIn).toBe('Spain');
    expect(out.locationChanged).toBe(false);
  });
});

describe('mergeProfile — location keeps the candidate-set timezone fields', () => {
  const base: ProfileShape = {
    weights: {},
    keywords: {},
    location: {
      basedIn: 'Thailand',
      workTypes: ['remote'],
      acceptedRegions: ['apac'],
      excludeOutsideAcceptedRegions: true,
      utcOffset: 7,
      maxTimezoneDiffHours: 6,
    },
  };
  // What sanitizeLocation yields for an LLM delta: the brief never states these.
  const delta = {
    weights: {},
    keywords: {},
    location: {
      basedIn: 'Thailand',
      workTypes: ['remote' as const],
      acceptedRegions: ['apac', 'europe'],
      excludeOutsideAcceptedRegions: true,
    },
  };

  it('carries utcOffset and maxTimezoneDiffHours over when the delta lacks them', () => {
    const out = mergeProfile(base, delta);
    expect(out.profile.location?.utcOffset).toBe(7);
    expect(out.profile.location?.maxTimezoneDiffHours).toBe(6);
    expect(out.profile.location?.acceptedRegions).toEqual(['apac', 'europe']);
    expect(out.locationChanged).toBe(true);
  });

  it('lets the delta override them when it does carry values', () => {
    const out = mergeProfile(base, {
      ...delta,
      location: { ...delta.location, utcOffset: 1, maxTimezoneDiffHours: 3 },
    });
    expect(out.profile.location?.utcOffset).toBe(1);
    expect(out.profile.location?.maxTimezoneDiffHours).toBe(3);
  });

  it('reports no change when the delta only repeats the stored location', () => {
    const out = mergeProfile(base, {
      ...delta,
      location: { ...delta.location, acceptedRegions: ['apac'] },
    });
    expect(out.locationChanged).toBe(false);
  });
});
