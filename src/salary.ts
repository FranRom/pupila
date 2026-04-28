export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
}

const NULL_RESULT: ParsedSalary = { min: null, max: null, currency: null };

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₽': 'RUB',
  '₩': 'KRW',
};

const CURRENCY_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'JPY',
  'INR',
  'SGD',
  'BRL',
  'MXN',
  'NOK',
  'SEK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'NZD',
]);

const HOURLY_RE = /\b(per[\s-]?hour|\/\s?hr|\/\s?hour|hourly|an hour)\b/i;
const ANNUAL_RE = /\b(per[\s-]?year|\/\s?yr|\/\s?year|annually|annual|p\.?a\.?)\b/i;
const HOURS_PER_YEAR = 2080;

function detectCurrency(raw: string): string | null {
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(sym)) return code;
  }
  const upper = raw.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  return null;
}

function parseAmount(token: string): number | null {
  const cleaned = token.replace(/[^0-9.kKmM,]/g, '');
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  let multiplier = 1;
  let body = lower;
  if (lower.endsWith('k')) {
    multiplier = 1_000;
    body = lower.slice(0, -1);
  } else if (lower.endsWith('m')) {
    multiplier = 1_000_000;
    body = lower.slice(0, -1);
  }
  const normalized = body.replace(/,/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * multiplier;
}

export function parseSalary(raw: string | null | undefined): ParsedSalary {
  if (!raw) return NULL_RESULT;
  const text = raw.trim();
  if (!text) return NULL_RESULT;

  const currency = detectCurrency(text);
  const isHourly = HOURLY_RE.test(text);

  const tokenRe = /(\d{1,3}(?:[,.\s]?\d{3})*(?:\.\d+)?\s*[kKmM]?|\d+(?:\.\d+)?\s*[kKmM]?)/g;
  const tokens = text.match(tokenRe) ?? [];
  const amounts = tokens.map((t) => parseAmount(t)).filter((n): n is number => n !== null);

  if (amounts.length === 0) return { min: null, max: null, currency };

  let min: number;
  let max: number;
  if (amounts.length === 1) {
    min = amounts[0] as number;
    max = amounts[0] as number;
  } else {
    const sorted = [...amounts].sort((a, b) => a - b);
    min = sorted[0] as number;
    max = sorted[sorted.length - 1] as number;
  }

  if (isHourly && !ANNUAL_RE.test(text)) {
    if (min < 1000) min = Math.round(min * HOURS_PER_YEAR);
    if (max < 1000) max = Math.round(max * HOURS_PER_YEAR);
  }

  if (min < 1000 || max < 1000) return { min: null, max: null, currency };
  if (min > max) [min, max] = [max, min];

  return { min, max, currency };
}
