import { describe, expect, it } from 'vitest';
import { STATUS_EMOJI, summarizeApplied } from '../src/applied.js';
import type { AppliedEntry } from '../src/types.js';

function entry(status: AppliedEntry['status'], url = 'https://example.com/job/1'): AppliedEntry {
  return { url, status, date: '2026-04-29' };
}

describe('STATUS_EMOJI', () => {
  it('has an emoji for every status', () => {
    expect(STATUS_EMOJI.applied).toBeDefined();
    expect(STATUS_EMOJI.interview).toBeDefined();
    expect(STATUS_EMOJI.offer).toBeDefined();
    expect(STATUS_EMOJI.rejected).toBeDefined();
    expect(STATUS_EMOJI.withdrawn).toBeDefined();
  });
});

describe('summarizeApplied', () => {
  it('renders empty string for no entries', () => {
    expect(summarizeApplied([])).toBe('');
  });

  it('groups by status with counts and emojis', () => {
    const result = summarizeApplied([entry('applied'), entry('applied'), entry('interview')]);
    expect(result).toContain('2 applied');
    expect(result).toContain('1 interview');
    expect(result).toContain('💬');
    expect(result).toContain('📝');
  });

  it('orders offer first, rejected last', () => {
    const result = summarizeApplied([entry('rejected'), entry('offer'), entry('applied')]);
    const offerPos = result.indexOf('offer');
    const rejectedPos = result.indexOf('rejected');
    expect(offerPos).toBeLessThan(rejectedPos);
  });
});
