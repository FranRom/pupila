import { spawn } from 'node:child_process';
import type { Plugin } from 'vite';
import { REPO_ROOT } from './_paths.ts';

// `/api/fetch-jobs` — manual trigger for the aggregator pipeline. Spawns
// `tsx src/index.ts` and parses the orchestrator's `[start] <source>` /
// `[done] <source> fetched=N errors=N` / `[error] <source> ...` lines into
// a single in-memory state object the UI polls every ~1s.
//
// Single concurrent run only. POST returns 409 if a run is already in flight.
type RunStatus = 'idle' | 'running' | 'done' | 'error';
// 'partial' = the fetcher returned items AND surfaced one or more errors —
// typically a tier-S slug that 404'd while the rest of the source delivered
// jobs. Treated as a terminal state distinct from 'error' so the UI can show
// the actual fetched count instead of a misleading red "✗". Stale slugs are
// intentional per CLAUDE.md (kept as a watchlist for upstream restoration),
// so the surfacing here matters.
type SourceState = 'pending' | 'running' | 'done' | 'partial' | 'error';
const KNOWN_SOURCES: readonly string[] = [
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

interface SourceEntry {
  name: string;
  state: SourceState;
  fetched?: number;
  errors?: number;
  message?: string;
}

interface FetchJobsState {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  sources: SourceEntry[];
  exitCode: number | null;
  lastError: string | null;
}

function emptyState(): FetchJobsState {
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    sources: KNOWN_SOURCES.map((name) => ({ name, state: 'pending' })),
    exitCode: null,
    lastError: null,
  };
}

export function fetchJobsApiPlugin(): Plugin {
  let state: FetchJobsState = emptyState();

  function setSource(name: string, patch: Partial<SourceEntry>): void {
    const idx = state.sources.findIndex((s) => s.name === name);
    if (idx === -1) return;
    const existing = state.sources[idx];
    if (!existing) return;
    state.sources[idx] = { ...existing, ...patch };
  }

  function parseLine(line: string): void {
    const startMatch = line.match(/^\[start\]\s+(\S+)/);
    if (startMatch?.[1]) {
      setSource(startMatch[1], { state: 'running' });
      return;
    }
    const doneMatch = line.match(/^\[done\]\s+(\S+)\s+fetched=(\d+)\s+errors=(\d+)/);
    if (doneMatch?.[1]) {
      const fetched = Number(doneMatch[2]);
      const errors = Number(doneMatch[3]);
      // errors=0          → done    (full success)
      // errors>0, items>0 → partial (some slugs broken, others delivered)
      // errors>0, items=0 → error   (nothing came through)
      const state: SourceState = errors === 0 ? 'done' : fetched > 0 ? 'partial' : 'error';
      setSource(doneMatch[1], { state, fetched, errors });
      return;
    }
    const errMatch = line.match(/^\[error\]\s+(\S+)\s+(.*)/);
    if (errMatch?.[1]) {
      setSource(errMatch[1], { state: 'error', message: errMatch[2] });
    }
  }

  function ingest(buf: string): void {
    for (const raw of buf.split(/\r?\n/)) {
      const line = raw.trim();
      if (line) parseLine(line);
    }
  }

  return {
    name: 'pupila-fetch-jobs-api',
    configureServer(server) {
      server.middlewares.use('/api/fetch-jobs', async (req, res) => {
        try {
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(state));
            return;
          }
          if (req.method === 'POST') {
            if (state.status === 'running') {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'a fetch run is already in flight', state }));
              return;
            }
            // Reset state for a new run.
            state = emptyState();
            state.status = 'running';
            state.startedAt = new Date().toISOString();

            // tsx is in node_modules/.bin and resolved via pnpm exec. Inherit
            // env so JOB_HUNT_* / PATH propagate to the fetchers.
            const proc = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
              cwd: REPO_ROOT,
              env: process.env,
              stdio: 'pipe',
            });

            let stderrTail = '';
            proc.stdout?.setEncoding('utf8');
            proc.stderr?.setEncoding('utf8');
            proc.stdout?.on('data', (chunk: string) => {
              ingest(chunk);
              // mirror to dev-server stdout so the user sees it in the
              // terminal too (helps debug without opening DevTools).
              process.stdout.write(chunk);
            });
            proc.stderr?.on('data', (chunk: string) => {
              stderrTail = `${stderrTail}${chunk}`.slice(-4000);
              process.stderr.write(chunk);
            });
            proc.on('error', (err) => {
              state.status = 'error';
              state.finishedAt = new Date().toISOString();
              state.lastError = err.message;
            });
            proc.on('exit', (code) => {
              state.exitCode = code;
              state.finishedAt = new Date().toISOString();
              if (code === 0) {
                state.status = 'done';
                // any source still 'pending' or 'running' but the process
                // exited cleanly — mark them done with 0 fetched.
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
            });

            res.statusCode = 202;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(state));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[fetch-jobs api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
