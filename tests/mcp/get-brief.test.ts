import { afterEach, describe, expect, it } from 'vitest';
import { runGetBrief } from '../../src/mcp/tools/get-brief.js';
import { buildFixture, type FixtureLayout, parseToolJson } from './_fixtures.js';

interface BriefResponse {
  exists: boolean;
  body: string | null;
  path: string;
}

describe('runGetBrief', () => {
  let fx: FixtureLayout;

  afterEach(async () => {
    if (fx) await fx.cleanup();
  });

  it('returns exists:false and body:null when the brief file does not exist', async () => {
    fx = await buildFixture({});
    const result = await runGetBrief(fx.briefPath);
    const payload = parseToolJson(result.content) as BriefResponse;
    expect(payload.exists).toBe(false);
    expect(payload.body).toBeNull();
    expect(payload.path).toBe(fx.briefPath);
  });

  it('returns the body between markers when present', async () => {
    const marked = [
      '# Candidate brief',
      '',
      'preamble line',
      '',
      '<!-- candidate-brief:start -->',
      '',
      'I am a senior frontend engineer focused on web3 and AI.',
      '',
      '<!-- candidate-brief:end -->',
      '',
    ].join('\n');
    fx = await buildFixture({ brief: marked });
    const result = await runGetBrief(fx.briefPath);
    const payload = parseToolJson(result.content) as BriefResponse;
    expect(payload.exists).toBe(true);
    expect(payload.body).toBe('I am a senior frontend engineer focused on web3 and AI.');
  });

  it('returns whole file trimmed when markers are absent', async () => {
    fx = await buildFixture({ brief: '   no markers here   ' });
    const result = await runGetBrief(fx.briefPath);
    const payload = parseToolJson(result.content) as BriefResponse;
    expect(payload.exists).toBe(true);
    expect(payload.body).toBe('no markers here');
  });

  it('returns exists:true with empty body when the marker block is empty', async () => {
    fx = await buildFixture({
      brief: '<!-- candidate-brief:start -->\n\n\n<!-- candidate-brief:end -->\n',
    });
    const result = await runGetBrief(fx.briefPath);
    const payload = parseToolJson(result.content) as BriefResponse;
    expect(payload.exists).toBe(true);
    expect(payload.body).toBe('');
  });
});
