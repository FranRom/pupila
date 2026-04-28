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
