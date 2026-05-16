import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadQueue } from '../../lib/apply-queue.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { probeWorker } from '../lib/worker-probe.js';
import { APPLY_QUEUE_PATH, APPLY_WORKER_PID_PATH, REPO_ROOT } from '../paths.js';

export interface QueueStatusPaths {
  queuePath: string;
  workerPidPath: string;
  repoRoot: string;
}

const DEFAULT_PATHS: QueueStatusPaths = {
  queuePath: APPLY_QUEUE_PATH,
  workerPidPath: APPLY_WORKER_PID_PATH,
  repoRoot: REPO_ROOT,
};

export async function runQueueStatus(paths: QueueStatusPaths = DEFAULT_PATHS): Promise<ToolResult> {
  const [queue, worker] = await Promise.all([
    loadQueue(paths.queuePath),
    probeWorker(paths.workerPidPath, paths.repoRoot),
  ]);
  return toolJson({ rows: queue.rows, worker });
}

export function registerQueueStatus(server: McpServer): void {
  server.registerTool(
    'queue_status',
    {
      title: 'Get apply queue status',
      description:
        'Return all rows in data/apply-queue.json plus the apply-worker liveness ({ alive, pid, pidPath }). Use to surface queue depth, in-flight runs, and worker health.',
      inputSchema: {},
    },
    safeHandler('queue_status', () => runQueueStatus()),
  );
}
