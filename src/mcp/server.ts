import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCancelApply } from './tools/cancel-apply.js';
import { registerClearApplied } from './tools/clear-applied.js';
import { registerEnqueueApply } from './tools/enqueue-apply.js';
import { registerGetAiReview } from './tools/get-ai-review.js';
import { registerGetBrief } from './tools/get-brief.js';
import { registerGetFetchStatus } from './tools/get-fetch-status.js';
import { registerGetJobDetail } from './tools/get-job-detail.js';
import { registerListAiReviews } from './tools/list-ai-reviews.js';
import { registerListJobs } from './tools/list-jobs.js';
import { registerMarkApplied } from './tools/mark-applied.js';
import { registerQueueStatus } from './tools/queue-status.js';
import { registerRegenerateProfile } from './tools/regenerate-profile.js';
import { registerRunSummary } from './tools/run-summary.js';
import { registerSkipJob } from './tools/skip-job.js';
import { registerTriggerFetch } from './tools/trigger-fetch.js';
import { registerUpdateStatus } from './tools/update-status.js';
import { registerWorkerStatus } from './tools/worker-status.js';

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

  // Read tools
  registerListJobs(server);
  registerGetJobDetail(server);
  registerGetBrief(server);
  // Write tools (applied-table mutators)
  registerMarkApplied(server);
  registerUpdateStatus(server);
  registerClearApplied(server);
  // Queue tools
  registerEnqueueApply(server);
  registerCancelApply(server);
  registerSkipJob(server);
  registerQueueStatus(server);
  registerWorkerStatus(server);
  // Aggregate + AI-review tools
  registerRunSummary(server);
  registerGetAiReview(server);
  registerListAiReviews(server);
  // Long-running tools (subprocess + LLM)
  registerTriggerFetch(server);
  registerGetFetchStatus(server);
  registerRegenerateProfile(server);

  return server;
}
