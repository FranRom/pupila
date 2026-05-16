import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateAppliedStatus } from '../../lib/applied-store.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { APPLIED_PATH, JOBS_PATH } from '../paths.js';
import { type UpdateStatusInput, updateStatusInputSchema } from '../schemas/applied-mutations.js';
import { resolveAppliedUrl } from './_resolve-applied-url.js';
import type { AppliedMutationPaths } from './mark-applied.js';

const DEFAULT_PATHS: AppliedMutationPaths = {
  appliedPath: APPLIED_PATH,
  jobsPath: JOBS_PATH,
};

export async function runUpdateStatus(
  input: UpdateStatusInput,
  paths: AppliedMutationPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const resolved = await resolveAppliedUrl(input, paths.jobsPath);
  if (!resolved.url) {
    if (resolved.reason === 'no-identifier') {
      return toolError('update_status requires either `url` or `jobId`.');
    }
    if (resolved.reason === 'jobid-not-found') {
      return toolError(`update_status: jobId not found in jobs.json: ${input.jobId}`);
    }
    return toolError('update_status: invalid URL.');
  }

  const updated = await updateAppliedStatus(
    resolved.url,
    {
      status: input.status,
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    paths.appliedPath,
  );

  if (!updated) {
    return toolError(
      'update_status: no applied entry exists for that URL. Use mark_applied to create one first.',
    );
  }
  return toolJson({ ok: true, entry: updated });
}

export function registerUpdateStatus(server: McpServer): void {
  server.registerTool(
    'update_status',
    {
      title: 'Update application status',
      description:
        'Update the status (and optionally date/notes) of an existing application entry. Returns a precondition error if no entry with that URL exists — use mark_applied for the first-time case. Accepts either url or jobId.',
      inputSchema: updateStatusInputSchema,
    },
    safeHandler<UpdateStatusInput>('update_status', (input) => runUpdateStatus(input)),
  );
}
