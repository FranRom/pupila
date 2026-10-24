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

// Near-miss spellings ("Strong match", "strong_match") are normalised to the
// canonical form rather than dropped to `skip`, which would silently hide a
// real match the model clearly intended.
function normalizeVerdict(v: unknown): unknown {
  return typeof v === 'string'
    ? v
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
    : v;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

// Tries each `{` in turn and returns the first balanced `{...}` span that
// parses to an object, string- and escape-aware so a brace inside a quoted
// field value doesn't miscount. Used as a fallback when the model surrounds
// the JSON with prose despite the prompt asking for JSON only — trailing
// commentary (`{...}\n\nLet me know...`) or a stray brace in leading prose
// (`Note {see below}\n{...}`) both trip a strict whole-string JSON.parse even
// though the object itself is perfectly valid.
function extractJsonObject(s: string): unknown {
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
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
        if (depth === 0) {
          try {
            const candidate: unknown = JSON.parse(s.slice(start, i + 1));
            if (typeof candidate === 'object' && candidate !== null) return candidate;
          } catch {
            // not valid JSON — try the next `{`
          }
          break;
        }
      }
    }
  }
  return undefined;
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
    // original error if no `{...}` span parses, so genuinely non-JSON
    // responses still fail loudly as before.
    const extracted = extractJsonObject(cleaned);
    if (extracted === undefined) throw err;
    parsed = extracted;
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
    verdict: isValidVerdict(normalizeVerdict(obj.verdict))
      ? (normalizeVerdict(obj.verdict) as AiVerdict)
      : 'skip',
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  };
}
