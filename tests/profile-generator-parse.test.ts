import { describe, expect, it } from 'vitest';
import { parsePersonalizationDelta } from '../src/lib/profile-generator.js';

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
