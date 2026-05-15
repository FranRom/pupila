// Process runner for the aggregator pipeline. Spawns the orchestrator
// (`tsx src/index.ts`), parses its `[start]/[done]/[error]` lines into a
// structured state object, and enforces a single concurrent run.
//
// Used by the MCP `trigger_fetch` tool. Shapes its state to be compatible
// with the existing `ui/plugins/fetchJobs.ts` middleware — a future commit
// can DRY the UI plugin against this module.
//
// Test override: callers may pass a custom `command`/`args` so tests can
// run a deterministic stub script (e.g. `bash -c 'printf "[start] ashby\n…"'`)
// without actually invoking `pnpm exec tsx`.

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';
export type SourceState = 'pending' | 'running' | 'done' | 'partial' | 'error';

export const KNOWN_SOURCES: readonly string[] = [
  'remoteok',
  'remotive',
  'weworkremotely',
  'cryptojobslist',
  'web3career',
  'aijobsnet',
  'hn-hiring',
  'hn-jobs',
  'greenhouse',
  'ashby',
  'lever',
  'aave',
  'ashby-private',
];

export interface SourceEntry {
  name: string;
  state: SourceState;
  fetched?: number;
  errors?: number;
  message?: string;
}

export interface FetchState {
  runId: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  sources: SourceEntry[];
  exitCode: number | null;
  lastError: string | null;
}

export interface FetchRunnerOptions {
  command?: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  knownSources?: readonly string[];
  /**
   * Test-only mirror toggle. When false, the parent process's stdout/stderr
   * is NOT echoed by the runner. Production defaults to true so the
   * orchestrator's output also lands on the user's terminal.
   */
  mirrorToStdio?: boolean;
}

function emptyState(runId: string, sources: readonly string[]): FetchState {
  return {
    runId,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    sources: sources.map((name) => ({ name, state: 'pending' })),
    exitCode: null,
    lastError: null,
  };
}

function deriveRunId(startedAt: string): string {
  return createHash('sha1').update(startedAt).digest('hex');
}

// Module-level singleton state. The MCP server is a long-lived process, so
// trigger_fetch and get_fetch_status share state through this module.
let currentState: FetchState | null = null;
let currentProcess: ChildProcess | null = null;

export function isFetchInFlight(): boolean {
  return currentState?.status === 'running';
}

export function getCurrentFetch(): FetchState | null {
  return currentState;
}

export function getFetchByRunId(runId: string): FetchState | null {
  return currentState?.runId === runId ? currentState : null;
}

function setSource(state: FetchState, name: string, patch: Partial<SourceEntry>): void {
  const idx = state.sources.findIndex((s) => s.name === name);
  if (idx === -1) return;
  const existing = state.sources[idx];
  if (!existing) return;
  state.sources[idx] = { ...existing, ...patch };
}

function parseLine(state: FetchState, line: string): void {
  const startMatch = line.match(/^\[start\]\s+(\S+)/);
  if (startMatch?.[1]) {
    setSource(state, startMatch[1], { state: 'running' });
    return;
  }
  const doneMatch = line.match(/^\[done\]\s+(\S+)\s+fetched=(\d+)\s+errors=(\d+)/);
  if (doneMatch?.[1]) {
    const fetched = Number(doneMatch[2]);
    const errors = Number(doneMatch[3]);
    // errors=0          → done    (full success)
    // errors>0, items>0 → partial (some slugs broken, others delivered)
    // errors>0, items=0 → error   (nothing came through)
    const next: SourceState = errors === 0 ? 'done' : fetched > 0 ? 'partial' : 'error';
    setSource(state, doneMatch[1], { state: next, fetched, errors });
    return;
  }
  const errMatch = line.match(/^\[error\]\s+(\S+)\s+(.*)/);
  if (errMatch?.[1]) {
    setSource(state, errMatch[1], { state: 'error', message: errMatch[2] });
  }
}

function ingest(state: FetchState, buf: string): void {
  for (const raw of buf.split(/\r?\n/)) {
    const line = raw.trim();
    if (line) parseLine(state, line);
  }
}

export interface StartFetchResult {
  ok: boolean;
  state: FetchState;
  reason?: 'already-running';
}

/**
 * Start a new aggregator run. Returns immediately — the spawned process
 * runs in the background; callers should poll via `getFetchByRunId`.
 * If a run is already in flight, returns `{ ok: false, reason: 'already-running' }`
 * with the existing state.
 */
export function startFetch(options: FetchRunnerOptions = {}): StartFetchResult {
  if (isFetchInFlight()) {
    // Existing state is guaranteed non-null by the in-flight check.
    return { ok: false, reason: 'already-running', state: currentState as FetchState };
  }

  const command = options.command ?? 'pnpm';
  const args = options.args ?? ['exec', 'tsx', 'src/index.ts'];
  const sources = options.knownSources ?? KNOWN_SOURCES;
  const mirror = options.mirrorToStdio ?? true;

  const startedAt = new Date().toISOString();
  const runId = deriveRunId(startedAt);
  const state: FetchState = {
    ...emptyState(runId, sources),
    status: 'running',
    startedAt,
  };
  currentState = state;

  const proc = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'pipe',
  });
  currentProcess = proc;

  let stderrTail = '';
  proc.stdout?.setEncoding('utf8');
  proc.stderr?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    ingest(state, chunk);
    if (mirror) process.stdout.write(chunk);
  });
  proc.stderr?.on('data', (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-4000);
    if (mirror) process.stderr.write(chunk);
  });
  proc.on('error', (err) => {
    state.status = 'error';
    state.finishedAt = new Date().toISOString();
    state.lastError = err.message;
    currentProcess = null;
  });
  proc.on('exit', (code) => {
    state.exitCode = code;
    state.finishedAt = new Date().toISOString();
    if (code === 0) {
      state.status = 'done';
      // Sources still pending after a clean exit -> mark done with 0 fetched.
      for (const s of state.sources) {
        if (s.state === 'pending' || s.state === 'running') {
          s.state = 'done';
          s.fetched = s.fetched ?? 0;
        }
      }
    } else {
      state.status = 'error';
      state.lastError = stderrTail.trim() || `exit code ${code}`;
      for (const s of state.sources) {
        if (s.state === 'running') s.state = 'error';
      }
    }
    currentProcess = null;
  });

  return { ok: true, state };
}

/** Test-only — reset module-level singleton state between test cases. */
export function __resetFetchRunnerForTests(): void {
  if (currentProcess) {
    try {
      currentProcess.kill('SIGKILL');
    } catch {
      // best-effort
    }
  }
  currentProcess = null;
  currentState = null;
}
