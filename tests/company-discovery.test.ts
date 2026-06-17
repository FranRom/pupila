import { describe, expect, it } from 'vitest';
import { parseCandidates } from '../src/lib/company-discovery.js';

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
