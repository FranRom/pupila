import { describe, expect, it } from 'vitest';
import { parseSalary } from '../src/salary.js';

describe('parseSalary', () => {
  it('returns null fields for empty input', () => {
    expect(parseSalary(null)).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary('')).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary('   ')).toEqual({ min: null, max: null, currency: null });
  });

  it('parses K-suffixed range with USD symbol', () => {
    const r = parseSalary('$120K - $180K');
    expect(r).toEqual({ min: 120_000, max: 180_000, currency: 'USD' });
  });

  it('parses K-suffixed range with EUR symbol', () => {
    const r = parseSalary('€80K-€110K');
    expect(r).toEqual({ min: 80_000, max: 110_000, currency: 'EUR' });
  });

  it('parses lowercase k', () => {
    const r = parseSalary('$90k - $130k');
    expect(r.min).toBe(90_000);
    expect(r.max).toBe(130_000);
  });

  it('parses comma-grouped numbers', () => {
    const r = parseSalary('$120,000 - $180,000');
    expect(r).toEqual({ min: 120_000, max: 180_000, currency: 'USD' });
  });

  it('parses currency code suffix (Lever-style)', () => {
    const r = parseSalary('100K-150K USD');
    expect(r).toEqual({ min: 100_000, max: 150_000, currency: 'USD' });
  });

  it('parses GBP and CAD codes', () => {
    expect(parseSalary('£70K - £100K').currency).toBe('GBP');
    expect(parseSalary('CAD 130000 - 170000').currency).toBe('CAD');
  });

  it('handles single-value salary by setting min == max', () => {
    const r = parseSalary('$150K');
    expect(r).toEqual({ min: 150_000, max: 150_000, currency: 'USD' });
  });

  it('parses hourly and converts to annual via 2080 hours', () => {
    const r = parseSalary('$60-$80 per hour');
    expect(r.min).toBe(60 * 2080);
    expect(r.max).toBe(80 * 2080);
    expect(r.currency).toBe('USD');
  });

  it('does not double-multiply when explicit annual marker is present', () => {
    const r = parseSalary('$120,000 per year');
    expect(r.min).toBe(120_000);
    expect(r.max).toBe(120_000);
  });

  it('rejects sub-$1000 amounts as noise (not a real salary)', () => {
    const r = parseSalary('500 USD signing bonus');
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
    expect(r.currency).toBe('USD');
  });

  it('returns currency-only when no amounts found', () => {
    const r = parseSalary('competitive USD package');
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
    expect(r.currency).toBe('USD');
  });

  it('swaps min/max when range comes inverted', () => {
    const r = parseSalary('$200K - $150K');
    expect(r.min).toBe(150_000);
    expect(r.max).toBe(200_000);
  });

  it('parses M-suffixed amounts', () => {
    const r = parseSalary('$1M - $2M');
    expect(r.min).toBe(1_000_000);
    expect(r.max).toBe(2_000_000);
  });

  it('returns nulls for free-text without numbers', () => {
    expect(parseSalary('competitive')).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary('DOE')).toEqual({ min: null, max: null, currency: null });
  });
});
