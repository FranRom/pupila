import { describe, expect, it } from 'vitest';
import { normalizeHnHiring } from '../src/normalize.js';
import type { RawHnHiringPost } from '../src/types.js';

const fetchedAt = '2026-04-28T07:00:00Z';

function makePost(text: string, commentId = 1): RawHnHiringPost {
  return {
    storyId: 100,
    commentId,
    text,
    createdAt: '2026-04-28T00:00:00Z',
  };
}

describe('normalizeHnHiring', () => {
  it('extracts company + title from a pipe-separated header', () => {
    const [j] = normalizeHnHiring(
      [
        makePost(
          'Acme | Senior Frontend Engineer | Remote (EMEA) | apply@acme.com\n\nWe are hiring...',
        ),
      ],
      fetchedAt,
    );
    expect(j?.company).toBe('Acme');
    expect(j?.title).toBe('Senior Frontend Engineer');
  });

  it('handles em-dash separator', () => {
    const [j] = normalizeHnHiring(
      [makePost('Acme Corp — Staff Software Engineer — Remote\n\nWe are hiring...')],
      fetchedAt,
    );
    expect(j?.company).toBe('Acme Corp');
    expect(j?.title).toMatch(/Staff Software Engineer/);
  });

  it('returns null company when the post is one paragraph with no header', () => {
    // The original bug: long body with no separator was being used as company.
    const longBody =
      'By turning legal code into AI code, Norm enables enterprises to move faster and more comprehensively in their legal and compliance processes with reliability and trust. Norm AI, the leading Legal & Compliance AI company, has raised $140 million.';
    const [j] = normalizeHnHiring([makePost(longBody)], fetchedAt);
    expect(j?.company).toBeNull();
    expect(j?.title.length).toBeLessThanOrEqual(140);
  });

  it('rejects company candidates that look like sentences (period inside)', () => {
    const [j] = normalizeHnHiring(
      [makePost('We are hiring. | Senior Engineer | Remote\n\nDetails...')],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
  });

  it('accepts a domain-style company name with an embedded period (not sentence punctuation)', () => {
    // Regression: the old check rejected ANY period, so "Rivio.ai" and
    // similar domain-style startup names were nulled out even though the
    // header was otherwise a perfectly normal "Company | Title | Location".
    const [j] = normalizeHnHiring(
      [
        makePost(
          'Rivio.ai | Senior / Staff Software Engineer | SF, hybrid/remote (US only)\n\nDetails...',
        ),
      ],
      fetchedAt,
    );
    expect(j?.company).toBe('Rivio.ai');
  });

  it('strips leading markdown emphasis markers before the company plausibility check', () => {
    // Regression: a poster's "*Y Combinator*" survived asPlain() (which
    // strips HTML, not markdown) verbatim, and the leading "*" failed the
    // alphanumeric-start check, nulling out an otherwise valid company.
    const [j] = normalizeHnHiring(
      [
        makePost(
          '*Y Combinator | Product Engineers | San Francisco (Onsite) | Full-time\n\nYC is hiring.',
        ),
      ],
      fetchedAt,
    );
    expect(j?.company).toBe('Y Combinator');
  });

  // Regression: when a post never states a company at all (solo/stealth
  // posting) the FIRST header field is the role, not a company — e.g.
  // "Senior Full Stack Engineer | New York, NY | Onsite | $160k-$210k...".
  // The old code assumed headerParts[0] is always company, so the title
  // text was duplicated verbatim into `company`, reading as if a company
  // were literally named after the job title.
  it('leaves company null when the first header field is itself a role, not a company', () => {
    const [j] = normalizeHnHiring(
      [
        makePost(
          'Senior Full Stack Engineer | New York, NY | Onsite | $160k-$210k + equity\n\nRebuilding core marketplace flows.',
        ),
      ],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
    expect(j?.title).toBe('Senior Full Stack Engineer');
  });

  it('rejects company candidates that exceed 60 chars', () => {
    const longCo = 'A'.repeat(61);
    const [j] = normalizeHnHiring(
      [makePost(`${longCo} | Senior Engineer | Remote\n\nDetails...`)],
      fetchedAt,
    );
    expect(j?.company).toBeNull();
  });

  it('falls back to a role-pattern title when no header exists', () => {
    const body =
      'We are looking for a Senior Frontend Engineer to join our team and help us scale our platform.';
    const [j] = normalizeHnHiring([makePost(body)], fetchedAt);
    expect(j?.title).toMatch(/Senior Frontend Engineer/i);
  });

  it('skips empty / very short comments', () => {
    expect(normalizeHnHiring([makePost('hi')], fetchedAt)).toEqual([]);
  });
});

describe('normalizeHnHiring — header parsing regressions', () => {
  const at = '2026-07-01T00:00:00.000Z';
  const post = (text: string) => ({ storyId: 1, commentId: 99, text, createdAt: at });

  // A plain hyphen used to be a header separator, so the most common word in
  // these posts was split in half.
  it('does not split an unpadded hyphen inside Full-Stack', () => {
    const [job] = normalizeHnHiring(
      [
        post(
          'Acme | Full-Stack Software Engineer | REMOTE\nWe build things for people who like them.',
        ),
      ],
      at,
    );
    expect(job?.title).toContain('Full-Stack Software Engineer');
    expect(job?.title).not.toBe('Stack Software Engineer');
  });

  it('still splits a space-padded hyphen as a real separator', () => {
    const [job] = normalizeHnHiring(
      [post('Acme - Senior Backend Engineer - REMOTE\nWe build things for people who like them.')],
      at,
    );
    expect(job?.company).toBe('Acme');
    expect(job?.title).toContain('Senior Backend Engineer');
  });

  it('decodes hex entities in the header', () => {
    const [job] = normalizeHnHiring(
      [
        post(
          'Acme | Full-stack &#x2F; AI Engineer | REMOTE\nWe build things for people who like them.',
        ),
      ],
      at,
    );
    expect(job?.title).toContain('/');
    expect(job?.title).not.toContain('&#x2F;');
  });

  // A prose header used to be promoted wholesale into the title.
  it('finds a role phrase in the body when no header field names one', () => {
    const [job] = normalizeHnHiring(
      [
        post(
          'Shepherd | led by Intact Private Capital, the investment arm of one of the largest insurers\nWe are hiring a Senior Software Engineer to own our platform.',
        ),
      ],
      at,
    );
    expect(job?.title.toLowerCase()).toContain('engineer');
    expect(job?.title).not.toContain('Intact Private Capital');
  });

  // Regression: a plural header field ("... Engineers") was missed by a
  // singular-only role check, falling through to the body-phrase search and
  // promoting a 60-char run-on onto the title instead of the clean header
  // field itself.
  it('picks a plural role field from the header instead of falling through to a run-on body match', () => {
    const [job] = normalizeHnHiring(
      [
        post(
          "Fusionbox | Python + TypeScript Engineers | United States | Full-time | REMOTE (US-only) We're a software engineering consultancy that builds enterprise software.",
        ),
      ],
      at,
    );
    expect(job?.title).toBe('Python + TypeScript Engineers');
    expect(job?.title).not.toContain('REMOTE (US-only)');
  });
});

describe('normalizeHnHiring — role words inside a company name', () => {
  const run = (text: string) => normalizeHnHiring([makePost(text)], fetchedAt)[0];

  it('keeps "Lead Bank" as the company when a later field is the role', () => {
    const j = run('Lead Bank | Senior Engineer | Remote | Full-time\n\nWe are hiring engineers.');
    expect(j?.company).toBe('Lead Bank');
    expect(j?.title).toBe('Senior Engineer');
  });

  it('keeps "Head Hunter Labs" as the company too', () => {
    const j = run('Head Hunter Labs | Staff Engineer | Remote\n\nWe are hiring engineers.');
    expect(j?.company).toBe('Head Hunter Labs');
    expect(j?.title).toBe('Staff Engineer');
  });

  it('still treats a lone role header as having no company', () => {
    const j = run(
      'Senior Full Stack Engineer | New York, NY | Onsite | $160k-$210k\n\nWe are hiring a full stack engineer.',
    );
    expect(j?.company).toBeNull();
    expect(j?.title).toBe('Senior Full Stack Engineer');
  });
});
