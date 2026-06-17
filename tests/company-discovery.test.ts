import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDiscoveryPrompt,
  discoverCompanies,
  fetchBoardTitles,
  parseCandidates,
  resolveSlugVariants,
  scoreRoles,
} from '../src/lib/company-discovery.js';
import type { ProbeResult } from '../src/lib/source-probe.js';

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

describe('scoreRoles', () => {
  const positive = ['front[\\s-]?end', 'full[\\s-]?stack', 'product engineer', 'agent'];
  const junior = ['junior', 'intern', 'working student'];

  it('counts titles matching a positive keyword', () => {
    const r = scoreRoles(
      ['Senior Frontend Engineer', 'Full-Stack Engineer', 'Backend Engineer'],
      positive,
      junior,
    );
    expect(r.matchCount).toBe(2);
    expect(r.sampleTitles).toEqual(['Senior Frontend Engineer', 'Full-Stack Engineer']);
  });

  it('excludes junior/intern/working-student even if otherwise matching', () => {
    const r = scoreRoles(
      ['Junior Frontend Engineer', 'Working Student Frontend'],
      positive,
      junior,
    );
    expect(r.matchCount).toBe(0);
  });

  it('caps sampleTitles at 4', () => {
    const titles = Array.from({ length: 6 }, (_, i) => `Frontend Engineer ${i}`);
    expect(scoreRoles(titles, positive, junior).sampleTitles).toHaveLength(4);
  });

  it('returns zero when no positive keywords configured', () => {
    expect(scoreRoles(['Frontend Engineer'], [], junior).matchCount).toBe(0);
  });
});

function mockFetch(body: string, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
}

describe('fetchBoardTitles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('extracts ashby titles from {jobs:[{title}]}', async () => {
    mockFetch(JSON.stringify({ jobs: [{ title: 'Frontend' }, { title: 'Agent Eng' }] }));
    expect(await fetchBoardTitles('ashby', 'foo')).toEqual(['Frontend', 'Agent Eng']);
  });

  it('extracts lever titles from [{text}]', async () => {
    mockFetch(JSON.stringify([{ text: 'Full-Stack' }]));
    expect(await fetchBoardTitles('lever', 'foo')).toEqual(['Full-Stack']);
  });

  it('extracts recruitee titles from {offers:[{title}]}', async () => {
    mockFetch(JSON.stringify({ offers: [{ title: 'Product Engineer' }] }));
    expect(await fetchBoardTitles('recruitee', 'foo')).toEqual(['Product Engineer']);
  });

  it('extracts personio <position><name> from XML', async () => {
    mockFetch(
      '<workzag-jobs><position><id>1</id><name>Senior Frontend</name></position></workzag-jobs>',
    );
    expect(await fetchBoardTitles('personio', 'foo')).toEqual(['Senior Frontend']);
  });
});

describe('buildDiscoveryPrompt', () => {
  const profile = {
    categories: [{ id: 'fe', label: 'Frontend', keywords: ['frontend', 'react'] }],
    keywords: { junior: ['junior'], engineering: ['engineer'] },
  };

  it('includes supported ATSes, brief, category labels, and the exclude list', () => {
    const p = buildDiscoveryPrompt(profile, 'Senior FE engineer, 8y React', {
      ashby: ['linear'],
      greenhouse: [],
      lever: [],
      recruitee: [],
      personio: [],
    });
    expect(p).toContain('ashby');
    expect(p).toContain('Senior FE engineer');
    expect(p).toContain('Frontend');
    expect(p).toContain('linear'); // excluded company surfaced in prompt
    expect(p.toLowerCase()).toContain('json');
  });
});

const profile = {
  categories: [{ id: 'fe', label: 'FE', keywords: ['frontend', 'agent'] }],
  keywords: { junior: ['junior'], engineering: ['engineer'] },
};
const emptyCurated = { ashby: [], greenhouse: [], lever: [], recruitee: [], personio: [] };

function deps(over: Partial<Parameters<typeof discoverCompanies>[0]> = {}) {
  return {
    profile,
    brief: 'FE engineer',
    curated: emptyCurated,
    runLlm: async () => '[{"name":"N8n","ats":"ashby","slug":"n8n","why":"agentic"}]',
    probe: async (_ats: string, _slug: string): Promise<ProbeResult> => ({
      supported: true,
      state: 'ok',
      found: 3,
    }),
    fetchTitles: async () => ['Senior Frontend Engineer', 'Agent Engineer', 'Backend Engineer'],
    ...over,
  };
}

describe('discoverCompanies', () => {
  it('verifies, scores, and ranks LLM candidates', async () => {
    const r = await discoverCompanies(deps());
    expect(r.proposed).toBe(1);
    expect(r.verified).toBe(1);
    expect(r.suggestions[0]).toMatchObject({
      name: 'N8n',
      ats: 'ashby',
      slug: 'n8n',
      matchCount: 2,
      totalRoles: 3,
    });
  });

  it('drops candidates whose boards are not live', async () => {
    const r = await discoverCompanies(
      deps({ probe: async () => ({ supported: true, state: 'not_found', found: 0 }) }),
    );
    expect(r.verified).toBe(0);
    expect(r.suggestions).toEqual([]);
  });

  it('skips slugs already curated', async () => {
    const r = await discoverCompanies(deps({ curated: { ...emptyCurated, ashby: ['n8n'] } }));
    expect(r.verified).toBe(0);
  });

  it('returns an error (not throw) when the LLM output is unparseable', async () => {
    const r = await discoverCompanies(deps({ runLlm: async () => 'sorry, no JSON' }));
    expect(r.suggestions).toEqual([]);
    expect(r.proposed).toBe(0);
  });

  it('ranks higher-matchCount companies first', async () => {
    let call = 0;
    const r = await discoverCompanies(
      deps({
        runLlm: async () =>
          '[{"name":"Low","ats":"ashby","slug":"low"},{"name":"High","ats":"ashby","slug":"high"}]',
        fetchTitles: async () =>
          call++ === 0 ? ['Frontend Engineer'] : ['Frontend Engineer', 'Agent Engineer'],
      }),
    );
    expect(r.suggestions.map((s) => s.matchCount)).toEqual([2, 1]);
  });
});
