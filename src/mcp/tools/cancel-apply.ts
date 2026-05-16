import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { markCancelled } from '../../lib/apply-queue.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { APPLY_QUEUE_PATH } from '../paths.js';
import { type QueueJobIdInput, queueJobIdInputSchema } from '../schemas/queue.js';

export interface CancelApplyPaths {
  queuePath: string;
}

const DEFAULT_PATHS: CancelApplyPaths = {
  queuePath: APPLY_QUEUE_PATH,
};

export async function runCancelApply(
  input: QueueJobIdInput,
  paths: CancelApplyPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const result = await markCancelled(input.jobId, paths.queuePath);
  if (!result.ok) {
    if (result.reason === 'not-found') {
      return toolError(`cancel_apply: no queue row for jobId ${input.jobId}`);
    }
    if (result.reason === 'terminal') {
      return toolError(
        `cancel_apply: queue row for ${input.jobId} is already in a terminal state (done/failed/cancelled)`,
      );
    }
  }
  return toolJson({ ok: true });
}

export function registerCancelApply(server: McpServer): void {
  server.registerTool(
    'cancel_apply',
    {
      title: 'Cancel a queued or running AI Apply task',
      description:
        'Cancel a job in the apply queue. Queued rows are removed entirely; running rows are flipped to "cancelled" so partial output stays auditable. Returns precondition errors for not-found and already-terminal cases.',
      inputSchema: queueJobIdInputSchema,
    },
    safeHandler<QueueJobIdInput>('cancel_apply', (input) => runCancelApply(input)),
  );
}
