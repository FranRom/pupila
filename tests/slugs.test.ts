import { describe, expect, it } from 'vitest';
import {
  ATS_KEYS,
  isValidSlug,
  resolveSlugs,
  sanitizeDelta,
  sanitizeOverlay,
} from '../src/lib/slugs.js';

describe('isValidSlug', () => {
  it('accepts real ATS slugs', () => {
    for (const s of ['linear', 'polygon-labs', 'li.fi', 'monad.foundation', 'chainlink-labs']) {
      expect(isValidSlug(s)).toBe(true);
    }
  });
  it('rejects injection / junk', () => {
    for (const s of [
      '',
      ' ',
      'a/b',
      '../etc',
      'Foo',
      'a?x=1',
      'a b',
      'a#b',
      123,
      null,
      undefined,
    ]) {
      expect(isValidSlug(s as unknown)).toBe(false);
    }
  });
  it('rejects over-long slugs', () => {
    expect(isValidSlug('a'.repeat(101))).toBe(false);
  });
});

describe('resolveSlugs', () => {
  const base = ['linear', 'ramp', 'uniswap'];
  it('returns base unchanged with no delta', () => {
    expect(resolveSlugs(base, undefined)).toEqual(base);
  });
  it('appends additions after base, preserving order', () => {
    expect(resolveSlugs(base, { add: ['stripe'], remove: [] })).toEqual([
      'linear',
      'ramp',
      'uniswap',
      'stripe',
    ]);
  });
  it('drops removed shipped slugs', () => {
    expect(resolveSlugs(base, { add: [], remove: ['uniswap'] })).toEqual(['linear', 'ramp']);
  });
  it('dedupes when an addition duplicates a shipped slug', () => {
    expect(resolveSlugs(base, { add: ['ramp'], remove: [] })).toEqual(base);
  });
});

describe('sanitizeDelta', () => {
  it('filters invalid slugs and dedupes', () => {
    expect(
      sanitizeDelta({ add: ['stripe', 'stripe', 'BAD/x', 5], remove: ['uniswap', ''] }),
    ).toEqual({
      add: ['stripe'],
      remove: ['uniswap'],
    });
  });
  it('lets add win over remove for the same slug', () => {
    expect(sanitizeDelta({ add: ['ramp'], remove: ['ramp'] })).toEqual({
      add: ['ramp'],
      remove: [],
    });
  });
  it('coerces missing fields to empty arrays', () => {
    expect(sanitizeDelta({})).toEqual({ add: [], remove: [] });
    expect(sanitizeDelta(null)).toEqual({ add: [], remove: [] });
  });
});

describe('sanitizeOverlay', () => {
  it('keeps only known ATS keys with non-empty deltas', () => {
    const overlay = sanitizeOverlay({
      ashby: { add: ['stripe'], remove: [] },
      greenhouse: { add: [], remove: [] },
      bogus: { add: ['x'], remove: [] },
    });
    expect(overlay).toEqual({ ashby: { add: ['stripe'], remove: [] } });
    expect(ATS_KEYS).toContain('ashbyPrivate');
  });
});
