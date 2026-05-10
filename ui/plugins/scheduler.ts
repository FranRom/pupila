import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Plugin } from 'vite';
import { REPO_ROOT } from './_paths.ts';
import { readBody } from './_shared.ts';

// ── Scheduler install/uninstall ────────────────────────────────────────────
//
// Wraps scripts/install-launchd.sh (darwin) / install-cron.sh (linux). Both
// scripts modify user-level system state (LaunchAgents plist or crontab
// entries) so the UI exposes them behind a confirm + a live log dock that
// mirrors FetchProgress visually. Single in-flight op at a time.

type SchedulerOp = 'install' | 'uninstall';
interface SchedulerOpState {
  op: SchedulerOp | null;
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
  lastError: string | null;
}

interface SchedulerInstallBody {
  skipReview?: unknown;
}

function emptySchedulerState(): SchedulerOpState {
  return {
    op: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    output: '',
    exitCode: null,
    lastError: null,
  };
}

export function schedulerOpsApiPlugin(): Plugin {
  let state: SchedulerOpState = emptySchedulerState();
  // Boolean (not the ChildProcess reference) so we can claim the lock
  // synchronously before any await — race-safe gating across concurrent POSTs.
  let inFlight = false;

  function startScript(op: SchedulerOp, args: string[], res: import('node:http').ServerResponse) {
    const platform = process.platform;
    const script =
      platform === 'darwin'
        ? path.join(REPO_ROOT, 'scripts', 'install-launchd.sh')
        : platform === 'linux'
          ? path.join(REPO_ROOT, 'scripts', 'install-cron.sh')
          : null;
    if (!script) {
      inFlight = false;
      res.statusCode = 501;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: `scheduler scripts only support darwin/linux (got ${platform})`,
        }),
      );
      return;
    }
    state = {
      ...emptySchedulerState(),
      op,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const proc = spawn('bash', [script, ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'pipe',
    });
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (c: string) => {
      state.output = (state.output + c).slice(-8000);
      process.stdout.write(c);
    });
    proc.stderr?.on('data', (c: string) => {
      state.output = (state.output + c).slice(-8000);
      process.stderr.write(c);
    });
    proc.on('error', (err) => {
      state.status = 'error';
      state.finishedAt = new Date().toISOString();
      state.lastError = err.message;
      inFlight = false;
    });
    proc.on('exit', (code) => {
      state.exitCode = code;
      state.finishedAt = new Date().toISOString();
      state.status = code === 0 ? 'done' : 'error';
      if (code !== 0) state.lastError = `exit code ${code}`;
      inFlight = false;
    });
    res.statusCode = 202;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(state));
  }

  return {
    name: 'job-hunt-scheduler-ops-api',
    configureServer(server) {
      server.middlewares.use('/api/scheduler-progress', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(state));
      });

      server.middlewares.use('/api/scheduler-install', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (inFlight) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'a scheduler op is already running', state }));
          return;
        }
        // Claim sync, before any await — startScript / proc handlers
        // release on completion; catch + early-return release on failure.
        inFlight = true;
        try {
          const body = (await readBody(req)) as SchedulerInstallBody;
          const args: string[] = [];
          if (body.skipReview === true) args.push('--no-review');
          startScript('install', args, res);
        } catch (err) {
          inFlight = false;
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/scheduler-uninstall', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (inFlight) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'a scheduler op is already running', state }));
          return;
        }
        inFlight = true;
        startScript('uninstall', ['--uninstall'], res);
      });
    },
  };
}
