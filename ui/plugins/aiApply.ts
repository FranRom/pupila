import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { readBriefBody } from '../../src/lib/brief-template.js';
import { parseCvBuffer } from '../../src/lib/cv-parser.js';
import { runLlm } from '../../src/lib/llm.js';
import { APPLICATIONS_DIR, JOBS_PATH, REPO_ROOT } from './_paths.ts';
import {
  type AppliedEntry,
  CV_MAX_CHARS,
  findCvPath,
  readApplied,
  readBody,
  readJsonOrDefault,
  readPreferences,
  writeApplied,
} from './_shared.ts';

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
// AI Apply lives in two stages now. POST /api/ai-apply validates inputs
// (job exists, brief present, CV present), writes an initial state slot,
// kicks off `runLlm` in the background with an `onChunk` callback that
// streams stdout into `state.output`, and returns 202 immediately. The UI
// then polls GET /api/ai-apply-progress for live state. On completion the
// markdown file gets written and config/applied.json is updated.
//
// Single in-flight (the LLM CLI is heavy + the streaming dock can only
// show one at a time anyway).
type AiApplyStatus = 'idle' | 'running' | 'done' | 'error';
const AI_APPLY_OUTPUT_CAP = 16_000;

interface AiApplyState {
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  cvPath: string | null;
  status: AiApplyStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  path: string | null;
  applied: AppliedEntry | null;
  provider: string | null;
  error: string | null;
}

function emptyAiApplyState(): AiApplyState {
  return {
    jobId: null,
    jobTitle: null,
    company: null,
    cvPath: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    output: '',
    path: null,
    applied: null,
    provider: null,
    error: null,
  };
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

export function aiApplyApiPlugin(): Plugin {
  let state: AiApplyState = emptyAiApplyState();
  let inFlight = false;

  return {
    name: 'job-hunt-ai-apply-api',
    configureServer(server) {
      server.middlewares.use('/api/ai-apply-progress', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(state));
      });

      server.middlewares.use('/api/ai-apply', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (inFlight) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'an AI Apply run is already in flight',
              state,
            }),
          );
          return;
        }
        // Claim the lock SYNCHRONOUSLY before any await — otherwise a
        // second concurrent POST can slip past the guard during the first
        // `await readBody(req)`, launching two LLM processes. Any early
        // return below releases the lock; the background block clears it
        // on completion.
        inFlight = true;
        try {
          const body = (await readBody(req)) as AiApplyPostBody;
          const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
          if (!jobId) {
            inFlight = false;
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'jobId required' }));
            return;
          }

          const jobs = await readJsonOrDefault<JobShape[]>(JOBS_PATH, []);
          const job = jobs.find((j) => j.id === jobId);
          if (!job) {
            inFlight = false;
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `job ${jobId} not found in data/jobs.json` }));
            return;
          }

          const briefBody = await readBriefBody();
          if (!briefBody) {
            inFlight = false;
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
            inFlight = false;
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

          // All inputs validated — seed the state slot, kick off the LLM in
          // the background (lock already claimed at the top), return 202.
          // path.relative only returns '' when both paths are identical, which
          // can't happen here (cv.path is a file, REPO_ROOT is a directory).
          const cvRelativePath = path.relative(REPO_ROOT, cv.path);
          state = {
            jobId,
            jobTitle: job.title,
            company: job.company,
            cvPath: cvRelativePath,
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            output: '',
            path: null,
            applied: null,
            provider: provider ?? 'auto',
            error: null,
          };

          // Background — never awaited inside the request handler.
          (async () => {
            try {
              const raw = await runLlm(prompt, provider, (chunk: string) => {
                // Append + cap to AI_APPLY_OUTPUT_CAP chars to keep the
                // poll response bounded.
                state.output = (state.output + chunk).slice(-AI_APPLY_OUTPUT_CAP);
              });
              const cleaned = raw.trim();
              if (!cleaned) {
                state.status = 'error';
                state.error = 'LLM returned empty output';
                state.finishedAt = new Date().toISOString();
                return;
              }
              const fs = await import('node:fs/promises');
              await fs.mkdir(APPLICATIONS_DIR, { recursive: true });
              const applicationPath = path.join(APPLICATIONS_DIR, `${jobId}.md`);
              const header = `<!-- Auto-generated by /api/ai-apply for job ${jobId} on ${new Date().toISOString()} -->\n# ${job.title} — ${job.company ?? 'unknown'}\n\n[${job.url}](${job.url})\n\n`;
              await writeFile(applicationPath, `${header}${cleaned}\n`, 'utf8');

              const entries = await readApplied();
              const idx = entries.findIndex((e) => e?.url === job.url);
              const today = new Date().toISOString().slice(0, 10);
              const appliedEntry: AppliedEntry = {
                url: job.url,
                status: 'applied',
                date: today,
                notes: `Application package: data/applications/${jobId}.md`,
              };
              if (idx >= 0) entries[idx] = appliedEntry;
              else entries.push(appliedEntry);
              await writeApplied(entries);

              state.path = `data/applications/${jobId}.md`;
              state.applied = appliedEntry;
              state.output = cleaned.slice(-AI_APPLY_OUTPUT_CAP);
              state.status = 'done';
              state.finishedAt = new Date().toISOString();
            } catch (err) {
              state.status = 'error';
              state.error = `LLM CLI failed: ${err instanceof Error ? err.message : String(err)}`;
              state.finishedAt = new Date().toISOString();
            } finally {
              inFlight = false;
            }
          })().catch((err) => {
            // Defensive — should not be reachable since the inner try/catch
            // covers everything, but log if it ever does.
            console.error('[ai-apply background]', err);
            inFlight = false;
          });

          res.statusCode = 202;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(state));
        } catch (err) {
          inFlight = false;
          console.error('[ai-apply api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
