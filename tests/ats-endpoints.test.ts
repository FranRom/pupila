import { describe, expect, it } from 'vitest';
import { ashbyBoardUrl, greenhouseBoardUrl, leverBoardUrl } from '../src/lib/ats-endpoints.js';

describe('ATS board URLs', () => {
  it('leaves valid slugs untouched', () => {
    expect(ashbyBoardUrl('linear')).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true',
    );
    expect(greenhouseBoardUrl('anthropic')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true',
    );
    expect(leverBoardUrl('ledger')).toBe('https://api.lever.co/v0/postings/ledger?mode=json');
  });
  it('preserves dotted/dashed slugs', () => {
    expect(ashbyBoardUrl('monad.foundation')).toContain('/job-board/monad.foundation?');
  });
  it('encodes path-breaking characters', () => {
    expect(ashbyBoardUrl('a/b')).toContain('/job-board/a%2Fb?');
    expect(greenhouseBoardUrl('a b')).toContain('/boards/a%20b/jobs');
  });
});
