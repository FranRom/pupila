import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { probeWorker } from '../lib/worker-probe.js';
import { APPLY_WORKER_PID_PATH, REPO_ROOT } from '../paths.js';

export interface WorkerStatusPaths {
  workerPidPath: string;
  repoRoot: string;
}

const DEFAULT_PATHS: WorkerStatusPaths = {
  workerPidPath: APPLY_WORKER_PID_PATH,
  repoRoot: REPO_ROOT,
};

export async function runWorkerStatus(
  paths: WorkerStatusPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const worker = await probeWorker(paths.workerPidPath, paths.repoRoot);
  return toolJson(worker);
}

export function registerWorkerStatus(server: McpServer): void {
  server.registerTool(
    'worker_status',
    {
      title: 'Get apply-worker status',
      description:
        'Cheaper than queue_status — returns just { alive, pid, pidPath } for the apply worker. Use as a precondition check before enqueue_apply.',
      inputSchema: {},
    },
    safeHandler('worker_status', () => runWorkerStatus()),
  );
}
