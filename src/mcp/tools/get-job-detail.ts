import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadAppliedMap } from '../../applied.js';
import type { AiReviews, Job } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, toolError, toolJson } from '../errors.js';
import { APPLIED_PATH, JOBS_BODIES_PATH, JOBS_PATH, REVIEWS_PATH } from '../paths.js';
import { type GetJobDetailInput, getJobDetailInputSchema } from '../schemas/get-job-detail.js';

interface BodyResult {
  body: string | null;
  bodySource: 'sidecar' | 'jobs.json' | 'preview' | null;
}

export interface GetJobDetailPaths {
  jobsPath: string;
  jobsBodiesPath: string;
  reviewsPath: string;
  appliedPath: string;
}

const DEFAULT_DETAIL_PATHS: GetJobDetailPaths = {
  jobsPath: JOBS_PATH,
  jobsBodiesPath: JOBS_BODIES_PATH,
  reviewsPath: REVIEWS_PATH,
  appliedPath: APPLIED_PATH,
};

// Mirrors the precedence in `ui/plugins/jobBody.ts`: sidecar first (canonical,
// rewritten on every aggregator run), jobs.json `body` second (rare — the
// pipeline strips body but a custom run may keep it), `bodyPreview` last.
async function resolveBody(
  jobId: string,
  job: Job | undefined,
  jobsBodiesPath: string,
): Promise<BodyResult> {
  const sidecar = (await readJsonOrNull<Record<string, string>>(jobsBodiesPath)) ?? {};
  const fromSidecar = sidecar[jobId];
  if (typeof fromSidecar === 'string' && fromSidecar.length > 0) {
    return { body: fromSidecar, bodySource: 'sidecar' };
  }
  if (job?.body && job.body.length > 0) {
    return { body: job.body, bodySource: 'jobs.json' };
  }
  if (job?.bodyPreview && job.bodyPreview.length > 0) {
    return { body: job.bodyPreview, bodySource: 'preview' };
  }
  return { body: null, bodySource: null };
}

export async function runGetJobDetail(
  input: GetJobDetailInput,
  paths: GetJobDetailPaths = DEFAULT_DETAIL_PATHS,
) {
  const jobs = (await readJsonOrNull<Job[]>(paths.jobsPath)) ?? [];
  const job = jobs.find((j) => j.id === input.jobId);
  if (!job) {
    return toolError(`Job not found: ${input.jobId}`);
  }

  const [{ body, bodySource }, reviews, appliedMap] = await Promise.all([
    resolveBody(input.jobId, job, paths.jobsBodiesPath),
    readJsonOrNull<AiReviews>(paths.reviewsPath),
    loadAppliedMap(paths.appliedPath),
  ]);

  return toolJson({
    job,
    body,
    bodySource,
    aiReview: reviews?.[input.jobId] ?? null,
    applied: appliedMap.get(input.jobId) ?? null,
  });
}

export function registerGetJobDetail(server: McpServer): void {
  server.registerTool(
    'get_job_detail',
    {
      title: 'Get job detail',
      description:
        'Return the full record for a single job: the slim row from data/jobs.json, the full body from the sidecar (or jobs.json/bodyPreview fallback), the AI review if one exists, and the applied entry if one exists. jobId is a 40-char sha1 hex string.',
      inputSchema: getJobDetailInputSchema,
    },
    safeHandler('get_job_detail', async (args) => runGetJobDetail(args as GetJobDetailInput)),
  );
}
