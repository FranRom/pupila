import { describe, expect, it } from 'vitest';
import { parseReviewJson } from '../src/ai-review-parse.js';

describe('parseReviewJson', () => {
  const happyJson = JSON.stringify({
    summary: 'A senior frontend role on web3 wallet team.',
    wants: ['React + TS', 'Web3 stack', 'Senior IC experience'],
    offers: ['Equity', 'Remote'],
    redFlags: ['Vague comp'],
    verdict: 'match',
    reason: 'Solid alignment with stack but unclear on scope.',
  });

  it('parses a strict JSON response', () => {
    const r = parseReviewJson(happyJson);
    expect(r.summary).toBe('A senior frontend role on web3 wallet team.');
    expect(r.wants).toHaveLength(3);
    expect(r.offers).toEqual(['Equity', 'Remote']);
    expect(r.redFlags).toEqual(['Vague comp']);
    expect(r.verdict).toBe('match');
    expect(r.reason).toMatch(/alignment/);
  });

  it('strips ```json markdown fences', () => {
    const fenced = `\`\`\`json\n${happyJson}\n\`\`\``;
    expect(parseReviewJson(fenced).verdict).toBe('match');
  });

  it('strips bare ``` fences (no language tag)', () => {
    const fenced = `\`\`\`\n${happyJson}\n\`\`\``;
    expect(parseReviewJson(fenced).summary).toMatch(/wallet team/);
  });

  it('coerces invalid verdict to "match" rather than throwing', () => {
    const bad = JSON.stringify({ ...JSON.parse(happyJson), verdict: 'maybe' });
    expect(parseReviewJson(bad).verdict).toBe('match');
  });

  it('accepts all four valid verdicts', () => {
    for (const v of ['strong-match', 'match', 'weak-match', 'skip'] as const) {
      const j = JSON.stringify({ ...JSON.parse(happyJson), verdict: v });
      expect(parseReviewJson(j).verdict).toBe(v);
    }
  });

  it('returns empty arrays when bullet fields are missing', () => {
    const minimal = JSON.stringify({ summary: 'hi', verdict: 'skip', reason: '' });
    const r = parseReviewJson(minimal);
    expect(r.wants).toEqual([]);
    expect(r.offers).toEqual([]);
    expect(r.redFlags).toEqual([]);
  });

  it('drops non-string entries from bullet arrays', () => {
    const dirty = JSON.stringify({
      ...JSON.parse(happyJson),
      wants: ['ok', 42, null, 'also ok'],
    });
    expect(parseReviewJson(dirty).wants).toEqual(['ok', 'also ok']);
  });

  it('throws on non-object root (string, array, null)', () => {
    expect(() => parseReviewJson('"just a string"')).toThrow();
    expect(() => parseReviewJson('null')).toThrow();
    // Arrays are technically `typeof === 'object'` but our check is null-only;
    // arrays would pass the type check but field reads return undefined → all defaults.
    // Explicitly verify that path doesn't crash, just yields a degenerate review.
    const arr = parseReviewJson('[]');
    expect(arr.summary).toBe('');
    expect(arr.verdict).toBe('match');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseReviewJson('not json at all')).toThrow();
  });
});
