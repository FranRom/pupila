import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getFetchByRunId } from '../../lib/fetch-runner.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { type GetFetchStatusInput, getFetchStatusInputSchema } from '../schemas/fetch.js';

export async function runGetFetchStatus(input: GetFetchStatusInput): Promise<ToolResult> {
  const state = getFetchByRunId(input.runId);
  if (!state) {
    return toolError(
      `get_fetch_status: no run found for runId ${input.runId}. The MCP server only retains state for the most recent run — older runIds are not queryable.`,
    );
  }
  return toolJson({ state });
}

export function registerGetFetchStatus(server: McpServer): void {
  server.registerTool(
    'get_fetch_status',
    {
      title: 'Get aggregator run status',
      description:
        'Return the live state of an aggregator run started via trigger_fetch. Includes per-source progress, exitCode, and lastError. Only the most recent run is queryable — older runIds are forgotten.',
      inputSchema: getFetchStatusInputSchema,
    },
    safeHandler<GetFetchStatusInput>('get_fetch_status', (input) => runGetFetchStatus(input)),
  );
}
