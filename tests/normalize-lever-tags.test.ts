import { describe, expect, it } from 'vitest';
import { normalizeLever } from '../src/normalize.js';
import type { RawLeverJobWithSlug } from '../src/types.js';

const lever = (over: Partial<RawLeverJobWithSlug>): RawLeverJobWithSlug =>
  ({
    id: 'a1',
    text: 'Senior Engineer',
    hostedUrl: 'https://jobs.lever.co/acme/a1',
    createdAt: 1_700_000_000_000,
    categories: { location: 'Europe' },
    __slug: 'acme',
    ...over,
  }) as RawLeverJobWithSlug;

describe('normalizeLever — workplace type', () => {
  it('keeps the workplace type as a tag so hybrid / on-site is distinguishable from unknown', () => {
    const [hybrid] = normalizeLever([lever({ workplaceType: 'hybrid' })], '2026-10-01T00:00:00Z');
    expect(hybrid?.tags).toContain('hybrid');
    expect(hybrid?.remote).toBe(false);
  });
});
