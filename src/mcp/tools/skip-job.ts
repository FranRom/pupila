import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addSwipeSkip } from '../../lib/swipe-skips.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { SWIPE_SKIPS_PATH } from '../paths.js';
import { type QueueJobIdInput, queueJobIdInputSchema } from '../schemas/queue.js';

export interface SkipJobPaths {
  swipeSkipsPath: string;
}

const DEFAULT_PATHS: SkipJobPaths = {
  swipeSkipsPath: SWIPE_SKIPS_PATH,
};

export async function runSkipJob(
  input: QueueJobIdInput,
  paths: SkipJobPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  await addSwipeSkip(input.jobId, paths.swipeSkipsPath);
  return toolJson({ ok: true, jobId: input.jobId });
}

export function registerSkipJob(server: McpServer): void {
  server.registerTool(
    'skip_job',
    {
      title: 'Skip a job in the Jinder swipe interface',
      description:
        'Persist a left-swipe — adds jobId to data/swipe-skips.json so the card does not reappear in the Jinder tab. Idempotent.',
      inputSchema: queueJobIdInputSchema,
    },
    safeHandler<QueueJobIdInput>('skip_job', (input) => runSkipJob(input)),
  );
}
