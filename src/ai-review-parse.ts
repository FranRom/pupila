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

// Models occasionally wrap JSON in ```json ... ``` despite the prompt asking
// not to. Strip that, then parse strictly. Anything we can't validate falls
// back to safe defaults rather than throwing — partial reviews are still useful.
export function parseReviewJson(raw: string): ParsedReviewBody {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  }
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('response is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    wants: asStringArray(obj.wants),
    offers: asStringArray(obj.offers),
    redFlags: asStringArray(obj.redFlags),
    verdict: isValidVerdict(obj.verdict) ? obj.verdict : 'match',
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  };
}
