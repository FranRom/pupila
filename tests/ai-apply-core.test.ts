import { describe, expect, it } from 'vitest';
import { buildAiApplyPrompt, CV_MAX_CHARS } from '../src/lib/ai-apply.js';

// NOTE: Integration testing of the LLM spawn + cancel path is intentionally
// omitted here. Those require a real (or heavily mocked) child_process spawn
// and would be flaky in CI. The key invariant is covered by the endpoint
// refactor: runAiApplyForJob is wired up identically to the prior inline
// logic. If process-spawn behaviour needs coverage, a separate integration
// test with a mock CLI binary would be the right approach.

describe('buildAiApplyPrompt', () => {
  const brief = 'Senior frontend engineer with 8 years React/TypeScript experience.';
  const baseJob = {
    id: 'abc123',
    title: 'Senior Frontend Engineer',
    company: 'Acme Corp',
    url: 'https://jobs.acme.com/123',
    location: 'Remote',
    body: 'We are looking for a senior frontend engineer who knows React.',
    fitScore: 85,
  };

  it('includes the brief verbatim in the prompt', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: baseJob,
      cvText: 'My CV content',
      cvFilename: null,
    });
    expect(prompt).toContain(brief);
  });

  it('includes job title, company, and URL', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: baseJob,
      cvText: 'My CV content',
      cvFilename: null,
    });
    expect(prompt).toContain('Senior Frontend Engineer');
    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('https://jobs.acme.com/123');
  });

  it('truncates job body at ~6000 chars', () => {
    const longBody = 'x'.repeat(7000);
    const prompt = buildAiApplyPrompt({
      brief,
      job: { ...baseJob, body: longBody },
      cvText: 'My CV content',
      cvFilename: null,
    });
    // The first 6000 chars of the body should be present
    expect(prompt).toContain('x'.repeat(6000));
    // But not chars from the tail (positions 6001+)
    // If 7000 chars appeared, the prompt would be significantly larger
    // We verify the slice happened: the body section cannot contain the full 7000 x's
    const bodySection = prompt.slice(prompt.indexOf('JOB DESCRIPTION'));
    expect(bodySection).not.toContain('x'.repeat(6001));
  });

  it('truncates CV at CV_MAX_CHARS', () => {
    // Build a CV larger than the cap so we can verify the slice
    const longCv = 'c'.repeat(CV_MAX_CHARS + 1000);
    const prompt = buildAiApplyPrompt({
      brief,
      job: baseJob,
      cvText: longCv,
      cvFilename: null,
    });
    expect(prompt).toContain('c'.repeat(CV_MAX_CHARS));
    expect(prompt).not.toContain('c'.repeat(CV_MAX_CHARS + 1));
  });

  it('includes CV filename in prompt when provided', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: baseJob,
      cvText: 'My CV content',
      cvFilename: '/home/user/config/cv.pdf',
    });
    expect(prompt).toContain('/home/user/config/cv.pdf');
  });

  it('omits CV filename line when cvFilename is null', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: baseJob,
      cvText: 'My CV content',
      cvFilename: null,
    });
    expect(prompt).not.toContain('The full file is on disk at');
  });

  it('handles null/missing job body gracefully', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: { ...baseJob, body: undefined },
      cvText: 'My CV content',
      cvFilename: null,
    });
    // Should not throw; JOB DESCRIPTION section should be present but empty
    expect(prompt).toContain('JOB DESCRIPTION');
  });

  it('handles null company gracefully', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: { ...baseJob, company: null },
      cvText: 'My CV content',
      cvFilename: null,
    });
    expect(prompt).toContain('unknown');
  });

  it('handles null location gracefully', () => {
    const prompt = buildAiApplyPrompt({
      brief,
      job: { ...baseJob, location: null },
      cvText: 'My CV content',
      cvFilename: null,
    });
    expect(prompt).toContain('not specified');
  });
});
