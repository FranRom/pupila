import { describe, expect, it } from 'vitest';
import { buildBriefPrompt } from '../src/lib/brief-prompt.js';

const SAMPLE = 'Jane Doe — Senior Frontend Engineer. React, TypeScript, 8 years.';

describe('buildBriefPrompt', () => {
  it('keeps the three-paragraph output contract for both sources', () => {
    for (const source of ['cv', 'linkedin'] as const) {
      const prompt = buildBriefPrompt(SAMPLE, source, 12_000);
      expect(prompt).toContain('PARAGRAPH 1 — Who they are');
      expect(prompt).toContain('PARAGRAPH 2 — What they');
      expect(prompt).toContain('PARAGRAPH 3 — What to avoid');
      expect(prompt).toContain('No preamble, no markdown fences');
      // The raw document text is always appended.
      expect(prompt).toContain(SAMPLE);
    }
  });

  it('labels the input as CV for the cv source', () => {
    const prompt = buildBriefPrompt(SAMPLE, 'cv', 12_000);
    expect(prompt).toContain('summarizing the following CV');
    expect(prompt).toContain('\nCV:\n');
    // No LinkedIn-specific framing leaks into the CV prompt.
    expect(prompt).not.toMatch(/LinkedIn/i);
  });

  it('adds LinkedIn-tuned framing for the linkedin source', () => {
    const prompt = buildBriefPrompt(SAMPLE, 'linkedin', 12_000);
    expect(prompt).toContain("summarizing the candidate's LinkedIn profile");
    expect(prompt).toContain('Save to PDF');
    expect(prompt).toContain('Ignore LinkedIn boilerplate');
    expect(prompt).toContain('\nLINKEDIN PROFILE:\n');
  });

  it('truncates the document text to maxChars', () => {
    const long = 'x'.repeat(50);
    const prompt = buildBriefPrompt(long, 'cv', 10);
    expect(prompt).toContain('xxxxxxxxxx'); // exactly 10
    expect(prompt).not.toContain('x'.repeat(11));
  });
});
