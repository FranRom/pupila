import { describe, expect, it } from 'vitest';
import { parseCandidates, resolveSlugVariants } from '../src/lib/company-discovery.js';

describe('parseCandidates', () => {
  it('parses a bare JSON array', () => {
    const out = parseCandidates('[{"name":"n8n","ats":"ashby","slug":"n8n","why":"agentic"}]');
    expect(out).toEqual([{ name: 'n8n', ats: 'ashby', slug: 'n8n', why: 'agentic' }]);
  });

  it('strips a ```json fence', () => {
    const out = parseCandidates('```json\n[{"name":"Pitch"}]\n```');
    expect(out).toEqual([{ name: 'Pitch', ats: undefined, slug: undefined, why: undefined }]);
  });

  it('recovers an array embedded in prose', () => {
    const out = parseCandidates('Sure! Here:\n[{"name":"Figma"}]\nHope that helps');
    expect(out.map((c) => c.name)).toEqual(['Figma']);
  });

  it('accepts an object wrapper { companies: [...] }', () => {
    expect(parseCandidates('{"companies":[{"name":"Dust"}]}').map((c) => c.name)).toEqual(['Dust']);
  });

  it('drops invalid ats, blank names, and garbage', () => {
    const out = parseCandidates('[{"name":"OK","ats":"workday"},{"name":""},{"x":1},"junk"]');
    expect(out).toEqual([{ name: 'OK', ats: undefined, slug: undefined, why: undefined }]);
  });

  it('returns [] on unparseable input', () => {
    expect(parseCandidates('not json at all')).toEqual([]);
  });
});

describe('resolveSlugVariants', () => {
  it('puts the LLM slug guess first, then name-derived variants', () => {
    expect(resolveSlugVariants('Aleph Alpha', 'aleph-alpha')).toEqual([
      'aleph-alpha',
      'alephalpha',
    ]);
  });

  it('derives compact + hyphenated variants from the name when no guess', () => {
    expect(resolveSlugVariants('Black Forest Labs')).toEqual([
      'blackforestlabs',
      'black-forest-labs',
    ]);
  });

  it('dedupes and drops variants failing SLUG_PATTERN', () => {
    expect(resolveSlugVariants('n8n')).toEqual(['n8n']);
  });

  it('caps at 4 variants', () => {
    expect(resolveSlugVariants('A B C D E F', 'x').length).toBeLessThanOrEqual(4);
  });
});
