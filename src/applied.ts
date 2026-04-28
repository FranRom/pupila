import type { ApplicationStatus, AppliedEntry } from './types.js';
import { normalizeUrl, readJsonOrNull, sha1Hex } from './utils.js';

export const STATUS_EMOJI: Record<ApplicationStatus, string> = {
  applied: '📝',
  interview: '💬',
  offer: '🎯',
  rejected: '❌',
  withdrawn: '⏸',
};

const STATUS_ORDER: ApplicationStatus[] = [
  'offer',
  'interview',
  'applied',
  'withdrawn',
  'rejected',
];

export async function loadAppliedMap(
  path = 'config/applied.json',
): Promise<Map<string, AppliedEntry>> {
  const entries = (await readJsonOrNull<AppliedEntry[]>(path)) ?? [];
  const map = new Map<string, AppliedEntry>();
  for (const entry of entries) {
    if (!entry?.url) continue;
    const norm = normalizeUrl(entry.url);
    if (!norm) continue;
    map.set(sha1Hex(norm), entry);
  }
  return map;
}

export function summarizeApplied(entries: AppliedEntry[]): string {
  const counts: Partial<Record<ApplicationStatus, number>> = {};
  for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const parts: string[] = [];
  for (const status of STATUS_ORDER) {
    const n = counts[status];
    if (n) parts.push(`${STATUS_EMOJI[status]} ${n} ${status}`);
  }
  return parts.join(' · ');
}
