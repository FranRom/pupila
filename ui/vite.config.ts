import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Connect, defineConfig, type Plugin } from 'vite';
import { readBriefBody, writeBriefBody } from '../src/lib/brief-template.js';
import { type CvFormat, parseCvBuffer } from '../src/lib/cv-parser.js';
import {
  availableProviders,
  type LlmProvider,
  runLlm,
  SUPPORTED_PROVIDERS,
} from '../src/lib/llm.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPLIED_PATH = path.join(REPO_ROOT, 'config', 'applied.json');
const APPLIED_EXAMPLE_PATH = path.join(REPO_ROOT, 'config', 'applied.example.json');
const JOBS_PATH = path.join(REPO_ROOT, 'data', 'jobs.json');
const REVIEWS_PATH = path.join(REPO_ROOT, 'data', 'ai-reviews.json');
const PREFERENCES_PATH = path.join(REPO_ROOT, 'config', 'preferences.json');
const APPLICATIONS_DIR = path.join(REPO_ROOT, 'data', 'applications');
const CV_BASENAME = path.join(REPO_ROOT, 'config', 'cv');

const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'rejected', 'withdrawn']);
const VALID_CV_FORMATS = new Set<CvFormat>(['pdf', 'docx', 'md', 'txt']);
const VALID_PROVIDER_OR_AUTO = new Set<string>([...SUPPORTED_PROVIDERS, 'auto']);

// How many chars of the parsed CV we send to the LLM. Configurable via
// JOB_HUNT_CV_MAX_CHARS for users hitting OOM kills on large CVs.
const CV_MAX_CHARS = Number(process.env.JOB_HUNT_CV_MAX_CHARS ?? '12000');

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
${cvText.slice(0, CV_MAX_CHARS)}`;
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
          // Persist the raw CV alongside the parsed brief so AI Apply can
          // re-attach it later. Different extensions live side-by-side
          // (e.g. config/cv.pdf + config/cv.md if the user re-uploads as
          // a different format) — the most recent upload wins.
          const cvFilePath = `${CV_BASENAME}.${format}`;
          await writeFile(cvFilePath, buf);
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

interface Preferences {
  provider: LlmProvider | 'auto' | null;
  onboardedAt: string | null;
}

const EMPTY_PREFS: Preferences = { provider: null, onboardedAt: null };

async function readPreferences(): Promise<Preferences> {
  return readJsonOrDefault<Preferences>(PREFERENCES_PATH, EMPTY_PREFS);
}

async function writePreferences(prefs: Preferences): Promise<void> {
  await writeFile(PREFERENCES_PATH, `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
}

// `/api/preferences` — first-run wizard target. GET returns the stored
// preferences (or empty defaults). POST validates `provider` against the
// supported list (plus `auto`) and stamps `onboardedAt` if not already set.
function preferencesApiPlugin(): Plugin {
  return {
    name: 'job-hunt-preferences-api',
    configureServer(server) {
      server.middlewares.use('/api/preferences', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const prefs = await readPreferences();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(prefs));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as Partial<Preferences>;
            const provider =
              typeof body.provider === 'string' && VALID_PROVIDER_OR_AUTO.has(body.provider)
                ? (body.provider as Preferences['provider'])
                : null;
            if (!provider) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: `provider must be one of: ${[...VALID_PROVIDER_OR_AUTO].join(', ')}`,
                }),
              );
              return;
            }
            const existing = await readPreferences();
            const next: Preferences = {
              provider,
              onboardedAt: existing.onboardedAt ?? new Date().toISOString().slice(0, 10),
            };
            await writePreferences(next);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(next));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[preferences api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

// `/api/llm-detect` — probes which CLIs are on PATH. Used by the
// onboarding wizard to ✓/✗ each provider option.
function llmDetectApiPlugin(): Plugin {
  return {
    name: 'job-hunt-llm-detect-api',
    configureServer(server) {
      server.middlewares.use('/api/llm-detect', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const available = await availableProviders();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available }));
        } catch (err) {
          console.error('[llm-detect api]', err);
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

interface AiApplyPostBody {
  jobId?: unknown;
}

interface JobShape {
  id: string;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  body?: string;
  fitScore: number;
}

const CV_EXTENSIONS: readonly CvFormat[] = ['pdf', 'docx', 'md', 'txt'];

async function findCvPath(): Promise<{ path: string; format: CvFormat } | null> {
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

function buildAiApplyPrompt(args: {
  brief: string;
  job: JobShape;
  cvText: string;
  cvFilename: string | null;
}): string {
  const { brief, job, cvText, cvFilename } = args;
  return `You are helping a candidate apply to a specific job. Generate a tailored application package the candidate can copy/paste into the actual application form.

CANDIDATE BRIEF
${brief.trim()}

CV (full text)
${cvText.slice(0, Math.min(CV_MAX_CHARS, 9000))}
${cvFilename ? `\n(The full file is on disk at ${cvFilename}.)` : ''}

JOB
Title: ${job.title}
Company: ${job.company ?? 'unknown'}
Location: ${job.location ?? 'not specified'}
URL: ${job.url}
Rule-based fit score: ${job.fitScore}/100

JOB DESCRIPTION
${(job.body ?? '').slice(0, 6000)}

OUTPUT
Return STRICT MARKDOWN with these exact H2 sections, in this order, no preamble, no fences:

## Cover letter
A 3-4 paragraph cover letter, written in first person, naturally incorporating 2-3 specific things from the candidate's CV that match this role. No filler. No "I am writing to apply for...". Open with a strong, role-specific hook.

## Highlights
A bulleted list (4-6 items) of the candidate's strongest matches against the JD, each one a short sentence with a concrete number/project where possible. These are talking points the candidate can use in the form's "why are you a good fit" question.

## Common-question answers
For each of these typical application questions, give a 2-3 sentence answer the candidate can copy:

- Why this company?
- Why this role?
- What's your ideal team size and dynamic?
- Earliest start date?
- Salary expectations? (Use a range derived from the candidate's brief if present, otherwise say "open to discussion based on full comp package".)

## Apply checklist
A short bulleted action list specific to this posting:
- Files needed (CV: yes; portfolio link if relevant)
- Form fields to expect
- Anything in the JD that needs a custom answer beyond what's above`;
}

// `/api/ai-apply` — generate a tailored application package for a job.
// v1: cover-letter generator. The headless LLM CLIs can't drive a browser,
// so we save the package to data/applications/<jobId>.md and the user
// copy/pastes it into the actual form.
//
// TODO: Phase 2 — browser-driven autosubmit. Once we add Playwright (or
// claude-code with a browser MCP), this endpoint should:
//   1. Spin up a browser session.
//   2. Open job.url.
//   3. Use the LLM to identify form fields.
//   4. Pre-fill each field with a tailored excerpt of the package below.
//   5. Attach the CV file from `cvPath`.
//   6. Stop short of submit; return control to the user for review.
function aiApplyApiPlugin(): Plugin {
  return {
    name: 'job-hunt-ai-apply-api',
    configureServer(server) {
      server.middlewares.use('/api/ai-apply', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = (await readBody(req)) as AiApplyPostBody;
          const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
          if (!jobId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'jobId required' }));
            return;
          }

          const jobs = await readJsonOrDefault<JobShape[]>(JOBS_PATH, []);
          const job = jobs.find((j) => j.id === jobId);
          if (!job) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `job ${jobId} not found in data/jobs.json` }));
            return;
          }

          const briefBody = await readBriefBody();
          if (!briefBody) {
            res.statusCode = 412;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'config/candidate-brief.md is missing or empty — finish onboarding first.',
              }),
            );
            return;
          }

          const cv = await findCvPath();
          if (!cv) {
            res.statusCode = 412;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error:
                  'No CV found at config/cv.{pdf,docx,md,txt} — re-upload via the Profile tab.',
              }),
            );
            return;
          }
          const cvBuf = await readFile(cv.path);
          const cvText = await parseCvBuffer(cvBuf, cv.format);

          const prefs = await readPreferences();
          const provider = prefs.provider && prefs.provider !== 'auto' ? prefs.provider : undefined;

          const prompt = buildAiApplyPrompt({
            brief: briefBody,
            job: {
              id: job.id,
              title: job.title,
              company: job.company,
              url: job.url,
              location: job.location,
              body: job.body,
              fitScore: job.fitScore,
            },
            cvText,
            cvFilename: cv.path,
          });

          let raw: string;
          try {
            raw = await runLlm(prompt, provider);
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `LLM CLI failed: ${err instanceof Error ? err.message : String(err)}`,
              }),
            );
            return;
          }

          const cleaned = raw.trim();
          if (!cleaned) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'LLM returned empty output' }));
            return;
          }

          // mkdir -p data/applications/
          const fs = await import('node:fs/promises');
          await fs.mkdir(APPLICATIONS_DIR, { recursive: true });
          const applicationPath = path.join(APPLICATIONS_DIR, `${jobId}.md`);
          const header = `<!-- Auto-generated by /api/ai-apply for job ${jobId} on ${new Date().toISOString()} -->\n# ${job.title} — ${job.company ?? 'unknown'}\n\n[${job.url}](${job.url})\n\n`;
          await writeFile(applicationPath, `${header}${cleaned}\n`, 'utf8');

          // Auto-mark as applied in config/applied.json (mirrors the
          // existing /api/applied POST flow, but inline so we don't
          // re-do an HTTP round-trip).
          const entries = await readApplied();
          const idx = entries.findIndex((e) => e?.url === job.url);
          const today = new Date().toISOString().slice(0, 10);
          const next: AppliedEntry = {
            url: job.url,
            status: 'applied',
            date: today,
            notes: `Application package: data/applications/${jobId}.md`,
          };
          if (idx >= 0) entries[idx] = next;
          else entries.push(next);
          await writeApplied(entries);

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              path: `data/applications/${jobId}.md`,
              body: cleaned,
              applied: next,
              provider: provider ?? 'auto',
            }),
          );
        } catch (err) {
          console.error('[ai-apply api]', err);
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
  plugins: [
    react(),
    appliedApiPlugin(),
    briefApiPlugin(),
    dataApiPlugin(),
    preferencesApiPlugin(),
    llmDetectApiPlugin(),
    aiApplyApiPlugin(),
  ],
  server: { port: 5173, open: true, host: '127.0.0.1' },
});
