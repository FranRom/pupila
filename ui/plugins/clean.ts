import { spawn } from 'node:child_process';
import type { Plugin } from 'vite';
import { REPO_ROOT } from './_paths.ts';
import { readBody } from './_shared.ts';

type CleanMode = 'default' | 'all' | 'onboarding';
const VALID_CLEAN_MODES = new Set<CleanMode>(['default', 'all', 'onboarding']);

interface CleanPostBody {
  mode?: unknown;
}

// Wraps `pnpm exec tsx scripts/clean.ts [--all|--onboarding]`. Single
// concurrent run so a fat-fingered double-click can't race.
export function cleanApiPlugin(): Plugin {
  // Boolean lock claimed sync (the proc reference isn't needed elsewhere).
  let inFlight = false;
  return {
    name: 'pupila-clean-api',
    configureServer(server) {
      server.middlewares.use('/api/clean', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (inFlight) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'a clean run is already in flight' }));
          return;
        }
        // Claim before any await — race-safe.
        inFlight = true;
        try {
          const body = (await readBody(req)) as CleanPostBody;
          const mode =
            typeof body.mode === 'string' && VALID_CLEAN_MODES.has(body.mode as CleanMode)
              ? (body.mode as CleanMode)
              : null;
          if (!mode) {
            inFlight = false;
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `mode must be one of: ${[...VALID_CLEAN_MODES].join(', ')}`,
              }),
            );
            return;
          }
          const args = ['exec', 'tsx', 'scripts/clean.ts'];
          if (mode === 'all') args.push('--all');
          else if (mode === 'onboarding') args.push('--onboarding');

          const proc = spawn('pnpm', args, {
            cwd: REPO_ROOT,
            env: process.env,
            stdio: 'pipe',
          });
          let buf = '';
          proc.stdout?.setEncoding('utf8');
          proc.stderr?.setEncoding('utf8');
          // Cap accumulator inline (matches scheduler / fetch-jobs behavior)
          // so a runaway script can't OOM the dev server.
          proc.stdout?.on('data', (c: string) => {
            buf = (buf + c).slice(-4000);
          });
          proc.stderr?.on('data', (c: string) => {
            buf = (buf + c).slice(-4000);
          });
          await new Promise<void>((resolve) => {
            proc.on('exit', (code) => {
              const ok = code === 0;
              inFlight = false;
              res.statusCode = ok ? 200 : 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok,
                  exitCode: code,
                  output: buf,
                }),
              );
              resolve();
            });
            proc.on('error', (err) => {
              inFlight = false;
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({ ok: false, exitCode: null, error: err.message, output: buf }),
              );
              resolve();
            });
          });
        } catch (err) {
          inFlight = false;
          console.error('[clean api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
