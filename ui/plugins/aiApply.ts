import path from 'node:path';
import type { Plugin } from 'vite';
import {
  type AppliedEntry,
  type RunAiApplyResult,
  runAiApplyForJob,
} from '../../src/lib/ai-apply.js';
import { readBriefBody } from '../../src/lib/brief-template.js';
import { JOBS_PATH, REPO_ROOT } from './_paths.ts';
import { findCvPath, readBody, readJsonOrDefault, readPreferences } from './_shared.ts';

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
// kicks off `runAiApplyForJob` in the background with an `onChunk` callback
// that streams stdout into `state.output`, and returns 202 immediately. The
// UI then polls GET /api/ai-apply-progress for live state. On completion the
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

function applyResultToState(result: RunAiApplyResult, state: AiApplyState): void {
  if (result.ok) {
    state.path = result.applicationPath;
    state.applied = result.appliedEntry;
    state.output = result.cleanedOutput.slice(-AI_APPLY_OUTPUT_CAP);
    state.status = 'done';
    state.finishedAt = new Date().toISOString();
    return;
  }
  switch (result.reason) {
    case 'empty-output':
      state.status = 'error';
      state.error = 'LLM returned empty output';
      state.finishedAt = new Date().toISOString();
      break;
    case 'cancelled':
      // Cannot happen in the endpoint path (no AbortSignal is passed), but
      // handled defensively to avoid unhandled branches.
      state.status = 'error';
      state.error = 'cancelled';
      state.finishedAt = new Date().toISOString();
      break;
    case 'precondition':
      // Also cannot happen here — we pre-flight these before calling the
      // core; this branch is purely defensive.
      state.status = 'error';
      state.error = result.message;
      state.finishedAt = new Date().toISOString();
      break;
  }
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

          // Pre-flight: validate all preconditions and return 4xx immediately
          // before seeding state or kicking off the background task. This
          // preserves the existing HTTP contract that the UI relies on.
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

          const prefs = await readPreferences();
          const provider = prefs.provider && prefs.provider !== 'auto' ? prefs.provider : undefined;

          // All inputs validated — seed the state slot, kick off the core in
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
              const result = await runAiApplyForJob({
                jobId,
                provider,
                repoRoot: REPO_ROOT,
                onChunk: (chunk: string) => {
                  // Append + cap to AI_APPLY_OUTPUT_CAP chars to keep the
                  // poll response bounded.
                  state.output = (state.output + chunk).slice(-AI_APPLY_OUTPUT_CAP);
                },
                // No AbortSignal for the Jobs-tab endpoint — the existing UI
                // has no cancel button. Only the future queue worker passes a
                // signal.
              });
              applyResultToState(result, state);
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
