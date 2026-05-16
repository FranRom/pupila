import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { upsertApplied } from '../../lib/applied-store.js';
import type { AppliedEntry } from '../../types.js';
import { isoToday } from '../../utils.js';
import { safeHandler, type ToolResult, toolError, toolJson } from '../errors.js';
import { APPLIED_PATH, JOBS_PATH } from '../paths.js';
import { type MarkAppliedInput, markAppliedInputSchema } from '../schemas/applied-mutations.js';
import { resolveAppliedUrl } from './_resolve-applied-url.js';

export interface AppliedMutationPaths {
  appliedPath: string;
  jobsPath: string;
}

const DEFAULT_PATHS: AppliedMutationPaths = {
  appliedPath: APPLIED_PATH,
  jobsPath: JOBS_PATH,
};

export async function runMarkApplied(
  input: MarkAppliedInput,
  paths: AppliedMutationPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const resolved = await resolveAppliedUrl(input, paths.jobsPath);
  if (!resolved.url) {
    if (resolved.reason === 'no-identifier') {
      return toolError('mark_applied requires either `url` or `jobId`.');
    }
    if (resolved.reason === 'jobid-not-found') {
      return toolError(`mark_applied: jobId not found in jobs.json: ${input.jobId}`);
    }
    return toolError('mark_applied: invalid URL.');
  }

  const entry: AppliedEntry = {
    url: resolved.url,
    status: input.status,
    date: input.date ?? isoToday(),
    ...(input.notes ? { notes: input.notes } : {}),
  };

  const { created } = await upsertApplied(entry, paths.appliedPath);
  return toolJson({ ok: true, created, entry });
}

export function registerMarkApplied(server: McpServer): void {
  server.registerTool(
    'mark_applied',
    {
      title: 'Mark a job as applied',
      description:
        'Upsert an application entry in config/applied.json. Accepts either url or jobId. Status defaults to "applied". date defaults to today (YYYY-MM-DD). Existing entry with same URL is replaced.',
      inputSchema: markAppliedInputSchema,
    },
    safeHandler<MarkAppliedInput>('mark_applied', (input) => runMarkApplied(input)),
  );
}
