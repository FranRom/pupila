import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type FetchRunnerOptions, startFetch } from '../../lib/fetch-runner.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { REPO_ROOT } from '../paths.js';
import { triggerFetchInputSchema } from '../schemas/fetch.js';

const DEFAULT_OPTIONS: FetchRunnerOptions = {
  cwd: REPO_ROOT,
  // MCP server's stdio is the JSON-RPC channel. Spawned process output MUST
  // NOT mirror to the parent's stdout — the stdout-guard handles console.*
  // but a child's raw stdout passthrough would still corrupt framing.
  mirrorToStdio: false,
};

export async function runTriggerFetch(
  options: FetchRunnerOptions = DEFAULT_OPTIONS,
): Promise<ToolResult> {
  const result = startFetch(options);
  if (!result.ok) {
    // Not an error envelope — the existing in-flight state is a useful
    // response shape ("here's the runId of the run that's already going").
    return toolJson({
      ok: false,
      reason: result.reason,
      runId: result.state.runId,
      state: result.state,
    });
  }
  return toolJson({
    ok: true,
    runId: result.state.runId,
    startedAt: result.state.startedAt,
    state: result.state,
  });
}

export function registerTriggerFetch(server: McpServer): void {
  server.registerTool(
    'trigger_fetch',
    {
      title: 'Trigger aggregator run',
      description:
        'Spawn the daily aggregator pipeline (`tsx src/index.ts`). Returns immediately with `runId` — poll get_fetch_status to monitor progress. Single concurrent run only: if a run is already in flight, returns the existing runId.',
      inputSchema: triggerFetchInputSchema,
    },
    safeHandler('trigger_fetch', () => runTriggerFetch()),
  );
}
