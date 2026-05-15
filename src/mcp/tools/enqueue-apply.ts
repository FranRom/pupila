import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { enqueue } from '../../lib/apply-queue.js';
import { hasSwipeSkip } from '../../lib/swipe-skips.js';
import type { Job } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { probeWorker } from '../lib/worker-probe.js';
import {
  APPLY_QUEUE_PATH,
  APPLY_WORKER_PID_PATH,
  JOBS_PATH,
  REPO_ROOT,
  SWIPE_SKIPS_PATH,
} from '../paths.js';
import { type QueueJobIdInput, queueJobIdInputSchema } from '../schemas/queue.js';

export interface EnqueueApplyPaths {
  queuePath: string;
  jobsPath: string;
  workerPidPath: string;
  swipeSkipsPath: string;
  repoRoot: string;
}

const DEFAULT_PATHS: EnqueueApplyPaths = {
  queuePath: APPLY_QUEUE_PATH,
  jobsPath: JOBS_PATH,
  workerPidPath: APPLY_WORKER_PID_PATH,
  swipeSkipsPath: SWIPE_SKIPS_PATH,
  repoRoot: REPO_ROOT,
};

export async function runEnqueueApply(
  input: QueueJobIdInput,
  paths: EnqueueApplyPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  // Defense in depth — the schema validates the regex, but confirm the
  // jobId actually exists in jobs.json before mutating the queue. Mirrors
  // ui/plugins/applyQueue.ts:92-97.
  const jobs = (await readJsonOrNull<Job[]>(paths.jobsPath)) ?? [];
  const job = jobs.find((j) => j.id === input.jobId);
  if (!job) {
    return toolError(`enqueue_apply: job ${input.jobId} not found in jobs.json`);
  }

  // Probe the worker. We don't BLOCK enqueue — the user might be about to
  // start the worker — but we surface a warning in the response so the LLM
  // can pass it along.
  const worker = await probeWorker(paths.workerPidPath, paths.repoRoot);

  // Note swipe-skip overlap (informational; user might be changing their mind).
  const skipped = await hasSwipeSkip(input.jobId, paths.swipeSkipsPath);

  const result = await enqueue(input.jobId, paths.queuePath);
  if (!result.ok) {
    return toolError(
      `enqueue_apply: ${result.reason === 'already-queued' ? 'job is already queued' : 'job is already running'}`,
    );
  }

  return toolJson({
    ok: true,
    row: result.row,
    worker,
    warnings: [
      ...(worker.alive
        ? []
        : ['Apply worker is not running. Start it with: pnpm run apply-worker']),
      ...(skipped ? ['Job is in swipe-skips list — enqueued anyway.'] : []),
    ],
  });
}

export function registerEnqueueApply(server: McpServer): void {
  server.registerTool(
    'enqueue_apply',
    {
      title: 'Enqueue an AI Apply task',
      description:
        'Append a job to data/apply-queue.json for the apply-worker to process. Validates jobId, checks the job exists in jobs.json, and probes worker liveness. Returns a warning (not an error) if the worker is not running — the user can start it after.',
      inputSchema: queueJobIdInputSchema,
    },
    safeHandler<QueueJobIdInput>('enqueue_apply', (input) => runEnqueueApply(input)),
  );
}
