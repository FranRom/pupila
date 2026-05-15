import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetBrief } from './tools/get-brief.js';
import { registerGetJobDetail } from './tools/get-job-detail.js';
import { registerListJobs } from './tools/list-jobs.js';

// MCP server name + version. The name is what the user sees in their MCP
// client's tool listing; the version is purely informational.
export const SERVER_NAME = 'pupila';
export const SERVER_VERSION = '0.1.0';

/**
 * Build the Pupila MCP server with all tools registered. Exposed as a
 * factory (not a singleton) so tests can spin up isolated instances over
 * `InMemoryTransport` without polluting global state.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerListJobs(server);
  registerGetJobDetail(server);
  registerGetBrief(server);

  return server;
}
