import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Connect, defineConfig, type Plugin } from 'vite';
import { readBriefBody, writeBriefBody } from '../src/lib/brief-template.js';
import { type CvFormat, parseCvBuffer } from '../src/lib/cv-parser.js';
import { runLlm } from '../src/lib/llm.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPLIED_PATH = path.join(REPO_ROOT, 'config', 'applied.json');
const APPLIED_EXAMPLE_PATH = path.join(REPO_ROOT, 'config', 'applied.example.json');
const JOBS_PATH = path.join(REPO_ROOT, 'data', 'jobs.json');
const REVIEWS_PATH = path.join(REPO_ROOT, 'data', 'ai-reviews.json');

const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'rejected', 'withdrawn']);
const VALID_CV_FORMATS = new Set<CvFormat>(['pdf', 'docx', 'md', 'txt']);

// Read a JSON file, falling back to a default if it doesn't exist or is
// invalid. Used so the UI keeps working on a fresh clone where the personal
// data files (gitignored) haven't been generated yet.
async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    return fallback;
  }
}

interface AppliedEntry {
  url: string;
  status: string;
  date: string;
  notes?: string;
}

async function readApplied(): Promise<AppliedEntry[]> {
  // Try the live (gitignored) file first; fall back to the committed
  // template so a fresh clone shows the example structure.
  for (const candidate of [APPLIED_PATH, APPLIED_EXAMPLE_PATH]) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as AppliedEntry[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  return [];
}

async function writeApplied(entries: AppliedEntry[]): Promise<void> {
  await writeFile(APPLIED_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function appliedApiPlugin(): Plugin {
  return {
    name: 'job-hunt-applied-api',
    configureServer(server) {
      server.middlewares.use('/api/applied', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const entries = await readApplied();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entries));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as Partial<AppliedEntry>;
            const url = typeof body.url === 'string' ? body.url.trim() : '';
            const status = typeof body.status === 'string' ? body.status : '';
            const date =
              typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
                ? body.date
                : todayIso();
            const notes =
              typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;
            if (!url || !VALID_STATUSES.has(status)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid url or status' }));
              return;
            }
            const entries = await readApplied();
            const idx = entries.findIndex((e) => e?.url === url);
            const next: AppliedEntry = {
              url,
              status,
              date,
              ...(notes ? { notes } : {}),
            };
            if (idx >= 0) entries[idx] = next;
            else entries.push(next);
            await writeApplied(entries);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(next));
            return;
          }
          if (req.method === 'DELETE') {
            const body = (await readBody(req)) as Partial<AppliedEntry>;
            const url = typeof body.url === 'string' ? body.url.trim() : '';
            if (!url) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid url' }));
              return;
            }
            const entries = await readApplied();
            const filtered = entries.filter((e) => e?.url !== url);
            await writeApplied(filtered);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[applied api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

function buildCvSummaryPrompt(cvText: string): string {
  return `You are summarizing the following CV into a short candidate brief that will be sent to an LLM each time the candidate's job-matching tool evaluates a posting. The brief decides whether the LLM agrees with the rule-based fit score.

Output ONLY three short paragraphs as plain markdown text. No preamble, no markdown fences, no headings, no commentary.

PARAGRAPH 1 — Who they are: role, years of experience, primary location, primary stack/skills. Be concrete (frameworks, languages, tools they ship with regularly).
PARAGRAPH 2 — What they're looking for: target seniority (senior / lead / staff / principal IC), domains/sectors of interest, location preference (remote-worldwide / remote-EMEA / hybrid in <city> / open to relocation).
PARAGRAPH 3 — What to avoid: roles that look like a fit on paper but aren't. Examples: wrong specialty, wrong level, on-site only, US-only positions, support/solutions/devrel/GTM titles.

Aim for 6-10 lines total. Drop anything that doesn't help a job-matching tool decide. Don't editorialize.

CV:
${cvText.slice(0, 12000)}`;
}

function stripFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:[a-z]+)?\n?/i, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

interface BriefGetResponse {
  body: string | null;
}

interface BriefPostBody {
  markdown?: unknown;
}

interface CvPostBody {
  format?: unknown;
  data?: unknown;
}

function briefApiPlugin(): Plugin {
  return {
    name: 'job-hunt-brief-api',
    configureServer(server) {
      server.middlewares.use('/api/brief', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const body = await readBriefBody();
            const payload: BriefGetResponse = { body };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as BriefPostBody;
            const markdown = typeof body.markdown === 'string' ? body.markdown : '';
            if (!markdown.trim()) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'empty markdown' }));
              return;
            }
            await writeBriefBody(markdown);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, body: markdown.trim() }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[brief api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/cv', async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          const body = (await readBody(req)) as CvPostBody;
          const format = typeof body.format === 'string' ? (body.format as CvFormat) : null;
          const data = typeof body.data === 'string' ? body.data : '';
          if (!format || !VALID_CV_FORMATS.has(format)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid format (pdf/docx/md/txt)' }));
            return;
          }
          if (!data) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'empty data' }));
            return;
          }
          // Binary formats arrive base64-encoded; text formats arrive as
          // utf-8 strings sent via JSON. Either way, normalize to a Buffer.
          const buf =
            format === 'pdf' || format === 'docx'
              ? Buffer.from(data, 'base64')
              : Buffer.from(data, 'utf-8');
          const cvText = await parseCvBuffer(buf, format);
          if (!cvText.trim()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'parsed CV is empty' }));
            return;
          }
          const raw = await runLlm(buildCvSummaryPrompt(cvText));
          const cleaned = stripFences(raw);
          if (!cleaned) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'LLM returned empty output' }));
            return;
          }
          await writeBriefBody(cleaned);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, body: cleaned }));
        } catch (err) {
          console.error('[cv api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

// `data/jobs.json` and `data/ai-reviews.json` are gitignored personal /
// AI-generated artifacts, so we serve them at runtime via these endpoints
// instead of statically importing them. A fresh clone with no data files
// gets `[]` / `{}` and renders the empty state cleanly.
function dataApiPlugin(): Plugin {
  return {
    name: 'job-hunt-data-api',
    configureServer(server) {
      server.middlewares.use('/api/jobs', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const jobs = await readJsonOrDefault<unknown[]>(JOBS_PATH, []);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(jobs));
        } catch (err) {
          console.error('[jobs api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/reviews', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const reviews = await readJsonOrDefault<Record<string, unknown>>(REVIEWS_PATH, {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reviews));
        } catch (err) {
          console.error('[reviews api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), appliedApiPlugin(), briefApiPlugin(), dataApiPlugin()],
  server: { port: 5173, open: true, host: '127.0.0.1' },
});
