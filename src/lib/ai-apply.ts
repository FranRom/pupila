// Core AI Apply logic extracted from ui/plugins/aiApply.ts so that both
// the HTTP endpoint (single-shot Jobs tab) and future queue workers can
// share the same prompt builder, LLM spawn, applied-entry write, and file
// write without duplication.
//
// This module lives under src/ and MUST NOT import from ui/. Callers in ui/
// import this module; the dependency arrow only goes one way.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidJobId } from './apply-queue.js';
import { readBriefBody } from './brief-template.js';
import { parseCvBuffer } from './cv-parser.js';
import { detectLlmCli, type LlmProvider } from './llm.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// How many chars of the parsed CV we send to the LLM. Configurable via
// PUPILA_CV_MAX_CHARS for users hitting OOM kills on large CVs.
export const CV_MAX_CHARS = Number(process.env.PUPILA_CV_MAX_CHARS ?? '12000');

// This file lives at src/lib/ai-apply.ts, so ../../ resolves to repo root.
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Env vars that Claude Code sets in any spawned process. Strip them before
// spawning the LLM CLI so that `claude` doesn't SIGKILL itself when it
// detects it's running inside a Claude Code session.
const CLAUDE_CODE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_CONFIG_DIR',
  'ENABLE_BACKGROUND_TASKS',
  'ANTHROPIC_API_KEY',
] as const;

function buildSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of CLAUDE_CODE_ENV_VARS) {
    delete env[k];
  }
  return env;
}

// CV extensions to check, in priority order.
const CV_EXTENSIONS = ['pdf', 'docx', 'md', 'txt'] as const;
type CvExt = (typeof CV_EXTENSIONS)[number];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunAiApplyOptions {
  jobId: string;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Repo root override — used by tests. Defaults to the actual repo root. */
  repoRoot?: string;
  /** LLM provider override. undefined = auto-detect. */
  provider?: LlmProvider | undefined;
}

export interface AppliedEntry {
  url: string;
  status: 'applied';
  date: string;
  notes?: string;
}

export type RunAiApplyResult =
  | {
      ok: true;
      applicationPath: string;
      appliedEntry: AppliedEntry;
      cleanedOutput: string;
    }
  | {
      ok: false;
      reason: 'cancelled';
      partialPath: string | null;
      partialOutput: string;
    }
  | {
      ok: false;
      reason: 'empty-output';
      partialOutput: string;
    }
  | {
      ok: false;
      reason: 'precondition';
      message: string;
    };

// ---------------------------------------------------------------------------
// Internal job shape (subset of the persisted slim Job)
// ---------------------------------------------------------------------------

interface SlimJob {
  id: string;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  body?: string;
  fitScore: number;
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for unit tests)
// ---------------------------------------------------------------------------

export function buildAiApplyPrompt(args: {
  brief: string;
  job: Pick<SlimJob, 'id' | 'title' | 'company' | 'url' | 'location' | 'body' | 'fitScore'>;
  cvText: string;
  cvFilename: string | null;
}): string {
  const { brief, job, cvText, cvFilename } = args;
  return `You are helping a candidate apply to a specific job. Generate a tailored application package the candidate can copy/paste into the actual application form.

CANDIDATE BRIEF
${brief.trim()}

CV (full text)
${cvText.slice(0, CV_MAX_CHARS)}
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

// ---------------------------------------------------------------------------
// CV-finding helper (mirrors _shared.ts:findCvPath without importing ui/)
// ---------------------------------------------------------------------------

async function findCvPathLocal(
  cvBasename: string,
): Promise<{ path: string; format: CvExt } | null> {
  for (const ext of CV_EXTENSIONS) {
    const candidate = `${cvBasename}.${ext}`;
    try {
      await readFile(candidate);
      return { path: candidate, format: ext };
    } catch {
      // try next extension
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Atomic JSON write helper
// ---------------------------------------------------------------------------

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// LLM spawn with AbortSignal support
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  aborted: boolean;
}

function spawnLlm(
  cmd: string,
  args: readonly string[],
  prompt: string,
  onChunk: ((chunk: string) => void) | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildSpawnEnv(),
      detached: true,
      // Explicit — never invoke a shell. All user-controlled content (job
      // title/url/body, brief, cv) flows via stdin only; argv is static.
      shell: false,
    });
    proc.unref();

    let stdout = '';
    let aborted = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    function doAbort(): void {
      if (settled) return;
      aborted = true;
      proc.kill('SIGTERM');
      // SIGKILL escalation after 5 s
      killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // process may have already exited
        }
      }, 5000);
    }

    if (abortSignal) {
      if (abortSignal.aborted) {
        doAbort();
      } else {
        abortSignal.addEventListener('abort', doAbort, { once: true });
      }
    }

    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      if (onChunk) {
        try {
          onChunk(chunk);
        } catch {
          // never let a callback exception break the LLM run
        }
      }
    });

    // Absorb stderr — callers don't need it; keep the channel drained
    proc.stderr.on('data', () => {});

    proc.stdin.on('error', () => {});
    proc.stdin.write(prompt, (err) => {
      if (err) return;
      proc.stdin.end();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (abortSignal) abortSignal.removeEventListener('abort', doAbort);
      reject(err);
    });

    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (abortSignal) abortSignal.removeEventListener('abort', doAbort);
      resolve({ stdout, exitCode: code, signal, aborted });
    });
  });
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function runAiApplyForJob(opts: RunAiApplyOptions): Promise<RunAiApplyResult> {
  const { jobId, onChunk, signal, repoRoot = DEFAULT_REPO_ROOT, provider } = opts;

  // Defense in depth: even though the queue file is supposed to only ever
  // contain valid jobIds (validated at /api/apply-queue entry points), a
  // direct caller (or a hand-edited queue file) could pass a path-traversal
  // payload that would otherwise land at path.join(applicationsDir, jobId).
  if (!isValidJobId(jobId)) {
    return { ok: false, reason: 'precondition', message: `invalid jobId format: ${jobId}` };
  }

  // Derived paths
  const jobsPath = path.resolve(repoRoot, 'data', 'jobs.json');
  const jobsBodiesPath = path.resolve(repoRoot, 'data', 'jobs-bodies.json');
  const appliedPath = path.resolve(repoRoot, 'config', 'applied.json');
  const briefPath = path.resolve(repoRoot, 'config', 'candidate-brief.md');
  const applicationsDir = path.resolve(repoRoot, 'data', 'applications');
  const cvBasename = path.resolve(repoRoot, 'config', 'cv');

  // 1. Find job
  let jobs: SlimJob[] = [];
  try {
    const raw = await readFile(jobsPath, 'utf8');
    jobs = JSON.parse(raw) as SlimJob[];
  } catch {
    // jobs stays []
  }
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return {
      ok: false,
      reason: 'precondition',
      message: `job ${jobId} not found in data/jobs.json`,
    };
  }

  // 2. Read body from sidecar (data/jobs-bodies.json), fall back to slim body
  let jobBody = job.body ?? '';
  try {
    const bodiesRaw = await readFile(jobsBodiesPath, 'utf8');
    const bodies = JSON.parse(bodiesRaw) as Record<string, string>;
    if (typeof bodies[jobId] === 'string') {
      jobBody = bodies[jobId] ?? jobBody;
    }
  } catch {
    // sidecar missing or invalid — fall back to slim body already set above
  }

  // 3. Read brief
  let briefBody: string | null;
  try {
    // readBriefBody reads from BRIEF_PATH relative to cwd by default.
    // We need to read from repoRoot. So read raw and replicate the extraction.
    const existing = await readFile(briefPath, 'utf8');
    const BRIEF_START = '<!-- candidate-brief:start -->';
    const BRIEF_END = '<!-- candidate-brief:end -->';
    const startIdx = existing.indexOf(BRIEF_START);
    const endIdx = existing.indexOf(BRIEF_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      briefBody = existing.trim() || null;
    } else {
      briefBody = existing.slice(startIdx + BRIEF_START.length, endIdx).trim() || null;
    }
  } catch {
    briefBody = null;
  }

  if (!briefBody) {
    return {
      ok: false,
      reason: 'precondition',
      message: 'config/candidate-brief.md is missing or empty — finish onboarding first.',
    };
  }

  // 4. Find CV
  const cv = await findCvPathLocal(cvBasename);
  if (!cv) {
    return {
      ok: false,
      reason: 'precondition',
      message: 'No CV found at config/cv.{pdf,docx,md,txt} — re-upload via the Profile tab.',
    };
  }
  const cvBuf = await readFile(cv.path);
  const cvText = await parseCvBuffer(cvBuf, cv.format);

  // 5. Build prompt
  const prompt = buildAiApplyPrompt({
    brief: briefBody,
    job: { ...job, body: jobBody },
    cvText,
    cvFilename: cv.path,
  });

  // 6. Spawn LLM with cancellation support
  const invocation = await detectLlmCli(provider);
  let spawnResult: SpawnResult;
  try {
    spawnResult = await spawnLlm(invocation.cmd, invocation.argTemplate, prompt, onChunk, signal);
  } catch (err) {
    throw new Error(
      `LLM CLI ${invocation.cmd} spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!spawnResult.aborted && spawnResult.exitCode !== 0) {
    throw new Error(
      `LLM CLI ${invocation.cmd} exited ${spawnResult.exitCode ?? 'null'} signal=${spawnResult.signal ?? 'none'}`,
    );
  }

  const partialOutput = spawnResult.stdout;

  // 8. Cancelled path
  if (spawnResult.aborted || (signal?.aborted ?? false)) {
    if (partialOutput.trim()) {
      await mkdir(applicationsDir, { recursive: true });
      const cancelledPath = path.join(applicationsDir, `${jobId}.cancelled.md`);
      const header = `# CANCELLED — partial output\n\n`;
      await writeFile(cancelledPath, `${header}${partialOutput}`, 'utf8');
      return {
        ok: false,
        reason: 'cancelled',
        partialPath: `data/applications/${jobId}.cancelled.md`,
        partialOutput,
      };
    }
    return {
      ok: false,
      reason: 'cancelled',
      partialPath: null,
      partialOutput: '',
    };
  }

  const cleanedOutput = partialOutput.trim();

  // 7. Empty output check
  if (!cleanedOutput) {
    return {
      ok: false,
      reason: 'empty-output',
      partialOutput,
    };
  }

  // 9. Write application file. Sanitize untrusted scraped fields before
  // embedding to avoid HTML-comment break-out or javascript: scheme links.
  await mkdir(applicationsDir, { recursive: true });
  const applicationPath = path.join(applicationsDir, `${jobId}.md`);
  const safeTitle = job.title.replace(/--+/g, '-').replace(/[<>]/g, '');
  const safeCompany = (job.company ?? 'unknown').replace(/--+/g, '-').replace(/[<>]/g, '');
  const safeUrl = /^https?:\/\//i.test(job.url) ? job.url : '#';
  const header =
    `<!-- Auto-generated by /api/ai-apply for job ${jobId} on ${new Date().toISOString()} -->\n` +
    `# ${safeTitle} — ${safeCompany}\n\n` +
    `[${safeUrl}](${safeUrl})\n\n`;
  await writeFile(applicationPath, `${header}${cleanedOutput}\n`, 'utf8');

  // 10. Upsert applied entry (atomic)
  let entries: AppliedEntry[] = [];
  try {
    const raw = await readFile(appliedPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      entries = parsed as AppliedEntry[];
    }
  } catch {
    // file missing or invalid — start fresh
  }

  const today = new Date().toISOString().slice(0, 10);
  const appliedEntry: AppliedEntry = {
    url: job.url,
    status: 'applied',
    date: today,
    notes: `Application package: data/applications/${jobId}.md`,
  };

  const idx = entries.findIndex((e) => e?.url === job.url);
  const updatedEntries =
    idx >= 0 ? entries.map((e, i) => (i === idx ? appliedEntry : e)) : [...entries, appliedEntry];

  await atomicWriteJson(appliedPath, updatedEntries);

  return {
    ok: true,
    applicationPath: `data/applications/${jobId}.md`,
    appliedEntry,
    cleanedOutput,
  };
}

// Re-export readBriefBody for callers that want to do precondition checks
// without triggering the full flow (e.g. the HTTP endpoint's pre-flight).
export { readBriefBody };
