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

  it('coerces invalid verdict to "skip" rather than throwing or defaulting to a false positive', () => {
    const bad = JSON.stringify({ ...JSON.parse(happyJson), verdict: 'maybe' });
    expect(parseReviewJson(bad).verdict).toBe('skip');
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
    expect(arr.verdict).toBe('skip');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseReviewJson('not json at all')).toThrow();
  });

  it('recovers a valid object when the model appends trailing prose after it', () => {
    const withTrailer = `${happyJson}\n\nLet me know if you'd like more detail!`;
    const r = parseReviewJson(withTrailer);
    expect(r.verdict).toBe('match');
    expect(r.summary).toBe('A senior frontend role on web3 wallet team.');
  });

  it('recovers a valid object when trailing content starts immediately (no whitespace)', () => {
    // Reproduces the exact shape observed live: "Unexpected non-whitespace
    // character after JSON at position N" from a strict JSON.parse.
    const withTrailer = `${happyJson}extra unexpected text right after the brace`;
    expect(parseReviewJson(withTrailer).verdict).toBe('match');
  });

  it('does not let a brace inside a quoted string value confuse the balance scan', () => {
    const tricky = JSON.stringify({
      ...JSON.parse(happyJson),
      summary: 'Uses a config like { foo: 1 } internally.',
    });
    const withTrailer = `${tricky}\nsome trailing note`;
    expect(parseReviewJson(withTrailer).summary).toMatch(/foo: 1/);
  });

  it('still throws when there is no balanced JSON object anywhere in the string', () => {
    expect(() => parseReviewJson('{ this never closes and has no valid content')).toThrow();
  });
});

describe('parseReviewJson — recovery', () => {
  const body = '{"summary":"s","verdict":"match","reason":"r"}';

  it('skips a stray brace in leading prose and parses the real object', () => {
    const r = parseReviewJson(`Note {see below}\n${body}`);
    expect(r.verdict).toBe('match');
    expect(r.summary).toBe('s');
  });

  it('still throws when no span parses', () => {
    expect(() => parseReviewJson('no json {here} at all')).toThrow();
  });

  it.each([
    ['Strong match', 'strong-match'],
    ['strong_match', 'strong-match'],
    [' WEAK-MATCH ', 'weak-match'],
    ['Skip', 'skip'],
  ])('normalises the near-miss verdict %j', (given, expected) => {
    expect(parseReviewJson(JSON.stringify({ verdict: given })).verdict).toBe(expected);
  });

  it('still fails safe to skip for an unknown verdict', () => {
    expect(parseReviewJson('{"verdict":"maybe"}').verdict).toBe('skip');
  });
});
