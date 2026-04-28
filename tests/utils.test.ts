import { describe, expect, it } from 'vitest';
import {
  formatDateTimeUTC,
  isSafeUrl,
  normalizeText,
  normalizeUrl,
  relativeTime,
  sha1Hex,
  stripHtml,
  withinDays,
} from '../src/utils.js';

describe('isSafeUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('https://example.com')).toBe(true);
  });

  it('rejects javascript:, data:, file: and other schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });

  it('rejects null/empty/garbage', () => {
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('strips utm and tracking params', () => {
    expect(normalizeUrl('https://example.com/job?utm_source=x&id=1')).toBe(
      'https://example.com/job?id=1',
    );
  });

  it('strips trailing slash and www', () => {
    expect(normalizeUrl('https://www.example.com/job/')).toBe('https://example.com/job');
  });

  it('returns empty string for non-http schemes', () => {
    expect(normalizeUrl('javascript:void(0)')).toBe('');
    expect(normalizeUrl('mailto:x@y.com')).toBe('');
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes basic entities', () => {
    expect(stripHtml('<p>hello &amp; goodbye</p>')).toBe('hello & goodbye');
  });

  it('converts <br> and </p> to newlines', () => {
    expect(stripHtml('a<br>b<br>c')).toBe('a\nb\nc');
  });

  it('handles null and empty', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml('')).toBe('');
  });
});

describe('normalizeText', () => {
  it('lowercases, removes punctuation, collapses whitespace', () => {
    expect(normalizeText('  Hello, World!  ')).toBe('hello world');
  });

  it('handles null', () => {
    expect(normalizeText(null)).toBe('');
  });
});

describe('sha1Hex', () => {
  it('produces deterministic 40-char output', () => {
    const a = sha1Hex('test');
    expect(a).toHaveLength(40);
    expect(sha1Hex('test')).toBe(a);
  });
});

describe('relativeTime', () => {
  it('formats minutes, hours, days', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(relativeTime(new Date(now.getTime() - 3 * 3600_000).toISOString(), now)).toBe('3h ago');
    expect(relativeTime(new Date(now.getTime() - 2 * 24 * 3600_000).toISOString(), now)).toBe(
      '2d ago',
    );
  });

  it('returns "unknown" for null', () => {
    expect(relativeTime(null)).toBe('unknown');
  });
});

describe('withinDays', () => {
  it('true for recent dates', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const recent = new Date(now.getTime() - 3 * 24 * 3600_000).toISOString();
    expect(withinDays(recent, 7, now)).toBe(true);
  });

  it('false for old dates', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const old = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
    expect(withinDays(old, 7, now)).toBe(false);
  });

  it('false for null', () => {
    expect(withinDays(null, 7)).toBe(false);
  });
});

describe('formatDateTimeUTC', () => {
  it('formats an ISO string as "DD Month YYYY, HH:MM UTC"', () => {
    expect(formatDateTimeUTC('2026-04-28T19:59:40.444Z')).toBe('28 April 2026, 19:59 UTC');
  });

  it('zero-pads single-digit hours and minutes', () => {
    expect(formatDateTimeUTC('2026-01-05T07:03:00Z')).toBe('5 January 2026, 07:03 UTC');
  });

  it('returns the input verbatim for unparseable values', () => {
    expect(formatDateTimeUTC('not-a-date')).toBe('not-a-date');
  });
});
