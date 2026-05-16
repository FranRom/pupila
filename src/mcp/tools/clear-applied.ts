import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeApplied } from '../../lib/applied-store.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { APPLIED_PATH, JOBS_PATH } from '../paths.js';
import { type ClearAppliedInput, clearAppliedInputSchema } from '../schemas/applied-mutations.js';
import { resolveAppliedUrl } from './_resolve-applied-url.js';
import type { AppliedMutationPaths } from './mark-applied.js';

const DEFAULT_PATHS: AppliedMutationPaths = {
  appliedPath: APPLIED_PATH,
  jobsPath: JOBS_PATH,
};

export async function runClearApplied(
  input: ClearAppliedInput,
  paths: AppliedMutationPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const resolved = await resolveAppliedUrl(input, paths.jobsPath);
  if (!resolved.url) {
    if (resolved.reason === 'no-identifier') {
      return toolError('clear_applied requires either `url` or `jobId`.');
    }
    if (resolved.reason === 'jobid-not-found') {
      return toolError(`clear_applied: jobId not found in jobs.json: ${input.jobId}`);
    }
    return toolError('clear_applied: invalid URL.');
  }

  const removed = await removeApplied(resolved.url, paths.appliedPath);
  // Idempotent — `removed: 0` is not an error.
  return toolJson({ ok: true, removed, url: resolved.url });
}

export function registerClearApplied(server: McpServer): void {
  server.registerTool(
    'clear_applied',
    {
      title: 'Clear an applied entry',
      description:
        'Remove the application entry for a URL or jobId. Idempotent — `removed: 0` is returned (not an error) when there was no matching entry.',
      inputSchema: clearAppliedInputSchema,
    },
    safeHandler<ClearAppliedInput>('clear_applied', (input) => runClearApplied(input)),
  );
}
