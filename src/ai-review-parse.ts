// Pure parser for the LLM's review response. Lives in its own file so the
// orchestrator (`src/ai-review.ts`, which calls `process.exit` on import)
// can stay separate from the testable bit.

import type { AiVerdict } from './types.js';

export interface ParsedReviewBody {
  summary: string;
  wants: string[];
  offers: string[];
  redFlags: string[];
  verdict: AiVerdict;
  reason: string;
}

function isValidVerdict(v: unknown): v is AiVerdict {
  return v === 'strong-match' || v === 'match' || v === 'weak-match' || v === 'skip';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

// Scans for the first balanced top-level `{...}` object in a string, string-
// and-escape aware so a brace inside a quoted field value doesn't miscount.
// Used as a fallback when the model appends trailing prose after the JSON
// object despite the prompt asking for JSON only — e.g. `{...}\n\nLet me
// know if you'd like more detail.` trips a strict whole-string JSON.parse
// even though the object itself is perfectly valid.
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Models occasionally wrap JSON in ```json ... ``` despite the prompt asking
// not to. Strip that, then parse strictly. Anything we can't validate falls
// back to safe defaults rather than throwing — partial reviews are still useful.
export function parseReviewJson(raw: string): ParsedReviewBody {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // Trailing content after a well-formed object (extra commentary the model
    // added despite instructions) fails a strict parse of the whole string.
    // Recover the object itself before giving up — only re-throw the
    // original error if there's no balanced `{...}` to extract at all, so
    // genuinely non-JSON responses still fail loudly as before.
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted === null) throw err;
    parsed = JSON.parse(extracted);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('response is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    wants: asStringArray(obj.wants),
    offers: asStringArray(obj.offers),
    redFlags: asStringArray(obj.redFlags),
    // Malformed/off-spec verdict must fail safe to the most conservative
    // reading, not the most favorable one — an unparseable verdict is not
    // evidence of a match.
    verdict: isValidVerdict(obj.verdict) ? obj.verdict : 'skip',
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  };
}
