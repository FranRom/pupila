import { readFile, stat, writeFile } from 'node:fs/promises';
import type { Connect } from 'vite';
import type { CvFormat } from '../../src/lib/cv-parser.js';
import { type LlmProvider, SUPPORTED_PROVIDERS } from '../../src/lib/llm.js';
import { APPLIED_PATH, CV_BASENAME, PREFERENCES_PATH } from './_paths.ts';

export type { LlmProvider };

// How many chars of the parsed CV we send to the LLM. Configurable via
// JOB_HUNT_CV_MAX_CHARS for users hitting OOM kills on large CVs.
export const CV_MAX_CHARS = Number(process.env.JOB_HUNT_CV_MAX_CHARS ?? '12000');

export const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'rejected', 'withdrawn']);
export const VALID_CV_FORMATS = new Set<CvFormat>(['pdf', 'docx', 'md', 'txt']);
export const VALID_PROVIDER_OR_AUTO = new Set<string>([...SUPPORTED_PROVIDERS, 'auto']);

const CV_EXTENSIONS: readonly CvFormat[] = ['pdf', 'docx', 'md', 'txt'];

export interface AppliedEntry {
  url: string;
  status: string;
  date: string;
  notes?: string;
}

export interface Preferences {
  provider: LlmProvider | 'auto' | null;
  onboardedAt: string | null;
}

export const EMPTY_PREFS: Preferences = { provider: null, onboardedAt: null };

// Read a JSON file, falling back to a default if it doesn't exist or is
// invalid. Used so the UI keeps working on a fresh clone where the personal
// data files (gitignored) haven't been generated yet.
export async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    return fallback;
  }
}

export function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readApplied(): Promise<AppliedEntry[]> {
  try {
    const raw = await readFile(APPLIED_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AppliedEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeApplied(entries: AppliedEntry[]): Promise<void> {
  await writeFile(APPLIED_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export async function readPreferences(): Promise<Preferences> {
  return readJsonOrDefault<Preferences>(PREFERENCES_PATH, EMPTY_PREFS);
}

export async function writePreferences(prefs: Preferences): Promise<void> {
  await writeFile(PREFERENCES_PATH, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
}

export async function findCvPath(): Promise<{ path: string; format: CvFormat } | null> {
  for (const ext of CV_EXTENSIONS) {
    const candidate = `${CV_BASENAME}.${ext}`;
    try {
      await readFile(candidate);
      return { path: candidate, format: ext };
    } catch {
      // try next
    }
  }
  return null;
}

export async function safeMtime(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    return s.mtime.toISOString();
  } catch {
    return null;
  }
}

export async function maxMtime(paths: readonly string[]): Promise<string | null> {
  let best = 0;
  for (const p of paths) {
    try {
      const s = await stat(p);
      const t = s.mtime.getTime();
      if (t > best) best = t;
    } catch {
      // missing → skip
    }
  }
  return best === 0 ? null : new Date(best).toISOString();
}
