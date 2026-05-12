import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { JOBS_BODIES_PATH, JOBS_PATH } from './_paths.ts';
import { readJsonOrDefault } from './_shared.ts';

interface JobShape {
  id: string;
  body?: string;
  bodyPreview?: string;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function pathnameOf(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const q = rawUrl.indexOf('?');
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}

export function jobBodyApiPlugin(): Plugin {
  return {
    name: 'job-hunt-job-body-api',
    configureServer(server) {
      server.middlewares.use('/api/job-body', async (req, res) => {
        try {
          if ((req.method ?? 'GET') !== 'GET') {
            res.statusCode = 405;
            res.end();
            return;
          }
          // After Connect strips the prefix, req.url is `/<jobId>` (or `/`).
          const url = pathnameOf(req.url);
          const jobId = url.startsWith('/') ? url.slice(1) : url;
          if (!jobId) {
            sendJson(res, 400, { error: 'jobId required' });
            return;
          }

          // Sidecar: data/jobs-bodies.json is the canonical source of full bodies.
          // Re-read on every request — the file is small and the orchestrator
          // rewrites it on every `pnpm run dev` run, so a long-lived Vite session
          // would otherwise serve stale bodies until restart.
          const sidecar = await readJsonOrDefault<Record<string, string>>(JOBS_BODIES_PATH, {});
          const fromSidecar = sidecar[jobId];
          if (typeof fromSidecar === 'string' && fromSidecar.length > 0) {
            sendJson(res, 200, { jobId, body: fromSidecar, source: 'sidecar' });
            return;
          }

          // Fallback: data/jobs.json strips `body` for size, but in case a
          // newer pipeline keeps it (or `bodyPreview` is all we have), use
          // whichever is present.
          const jobs = await readJsonOrDefault<JobShape[]>(JOBS_PATH, []);
          const job = jobs.find((j) => j.id === jobId);
          if (job) {
            const fallback =
              typeof job.body === 'string' && job.body.length > 0
                ? job.body
                : typeof job.bodyPreview === 'string' && job.bodyPreview.length > 0
                  ? job.bodyPreview
                  : null;
            if (fallback) {
              sendJson(res, 200, { jobId, body: fallback, source: 'jobs.json' });
              return;
            }
          }

          sendJson(res, 404, { error: 'no body for jobId' });
        } catch (err) {
          console.error('[job-body]', err);
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
