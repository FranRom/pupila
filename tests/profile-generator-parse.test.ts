import { describe, expect, it } from 'vitest';
import {
  mergeProfile,
  type ProfileShape,
  parsePersonalizationDelta,
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
