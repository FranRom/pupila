import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import {
  enqueue,
  isValidJobId,
  loadQueue,
  type MarkCancelledResult,
  markCancelled,
  type QueueRow,
} from '../../src/lib/apply-queue.js';
import { addSwipeSkip, listSwipeSkipIds, loadSwipeSkips } from '../../src/lib/swipe-skips.js';
import {
  APPLY_QUEUE_PATH,
  APPLY_WORKER_PID_PATH,
  JOBS_PATH,
  REPO_ROOT,
  SWIPE_SKIPS_PATH,
} from './_paths.ts';
import { readBody, readJsonOrDefault } from './_shared.ts';

interface EnqueueBody {
  jobId?: unknown;
}

interface JobShape {
  id: string;
}

interface WorkerLiveness {
  alive: boolean;
  pid: number | null;
  pidPath: string;
}

// Check if the apply worker is running. The PID file is written by the worker
// on startup and removed on graceful shutdown — but a crash or `kill -9` will
// leave a stale file. We do NOT delete stale PID files from the UI; the worker
// rewrites it on next startup. We just report `alive: false` to the caller.
async function probeWorker(): Promise<WorkerLiveness> {
  const pidPath = path.relative(REPO_ROOT, APPLY_WORKER_PID_PATH);
  let raw: string;
  try {
    raw = await readFile(APPLY_WORKER_PID_PATH, 'utf8');
  } catch {
    return { alive: false, pid: null, pidPath };
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { alive: false, pid: null, pidPath };
  }
  try {
    process.kill(pid, 0);
    return { alive: true, pid, pidPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      // Process exists but we lack permission to signal — treat as alive.
      return { alive: true, pid, pidPath };
    }
    // ESRCH or anything else: process gone. Report stale.
    return { alive: false, pid: null, pidPath };
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function handleList(res: ServerResponse): Promise<void> {
  const { rows } = await loadQueue(APPLY_QUEUE_PATH);
  const worker = await probeWorker();
  sendJson(res, 200, { rows, worker });
}

async function handleEnqueue(req: Connect.IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as EnqueueBody;
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: 'jobId required (expected sha1 hex)' });
    return;
  }

  const jobs = await readJsonOrDefault<JobShape[]>(JOBS_PATH, []);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    sendJson(res, 404, { error: `job ${jobId} not found in data/jobs.json` });
    return;
  }

  // Surface swipe-skip overlap. User can change their mind, so this is
  // informational only — we don't block the enqueue.
  try {
    const { skips } = await loadSwipeSkips(SWIPE_SKIPS_PATH);
    if (skips.some((s) => s.jobId === jobId)) {
      console.log(`[apply-queue] enqueue ${jobId} — note: jobId is in swipe-skips (not blocked)`);
    }
  } catch (err) {
    console.error('[apply-queue] swipe-skips lookup failed', err);
  }

  const result = await enqueue(jobId, APPLY_QUEUE_PATH);
  if (result.ok) {
    const row: QueueRow = result.row;
    sendJson(res, 200, { ok: true, row });
    return;
  }
  sendJson(res, 409, { ok: false, reason: result.reason });
}

async function handleCancel(jobId: string, res: ServerResponse): Promise<void> {
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: 'jobId required (expected sha1 hex)' });
    return;
  }
  const result: MarkCancelledResult = await markCancelled(jobId, APPLY_QUEUE_PATH);
  if (result.ok) {
    sendJson(res, 200, { ok: true });
    return;
  }
  const status = result.reason === 'not-found' ? 404 : 409;
  sendJson(res, status, { ok: false, reason: result.reason });
}

async function handleSkip(jobId: string, res: ServerResponse): Promise<void> {
  if (!isValidJobId(jobId)) {
    sendJson(res, 400, { error: 'jobId required (expected sha1 hex)' });
    return;
  }
  await addSwipeSkip(jobId, SWIPE_SKIPS_PATH);
  sendJson(res, 200, { ok: true });
}

// Strip the registration prefix off `req.url` (which already has it removed
// by Connect) into just the leading slash + path. Drops any query string.
function pathnameOf(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const q = rawUrl.indexOf('?');
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}

export function applyQueueApiPlugin(): Plugin {
  return {
    name: 'job-hunt-apply-queue-api',
    configureServer(server) {
      server.middlewares.use('/api/apply-queue', async (req, res) => {
        try {
          const method = req.method ?? 'GET';
          // Connect strips the registered prefix, so req.url is what came
          // after `/api/apply-queue`: '/', '/enqueue', '/<jobId>', '/<jobId>/skip'.
          const url = pathnameOf(req.url);

          if (method === 'GET' && (url === '/' || url === '')) {
            await handleList(res);
            return;
          }

          if (method === 'POST' && url === '/enqueue') {
            await handleEnqueue(req, res);
            return;
          }

          if (method === 'GET' && url === '/skips') {
            const ids = await listSwipeSkipIds(SWIPE_SKIPS_PATH);
            sendJson(res, 200, { skips: Array.from(ids) });
            return;
          }

          if (method === 'POST' && url.endsWith('/skip')) {
            // /<jobId>/skip → strip leading `/` + trailing `/skip`
            const jobId = url.slice(1, url.length - '/skip'.length);
            await handleSkip(jobId, res);
            return;
          }

          if (method === 'DELETE' && url.startsWith('/')) {
            const jobId = url.slice(1);
            await handleCancel(jobId, res);
            return;
          }

          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[apply-queue]', err);
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
