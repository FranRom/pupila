import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadAppliedMap } from '../../applied.js';
import type { Job } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { APPLIED_PATH, JOBS_PATH } from '../paths.js';
import { type ListJobsInput, listJobsInputSchema } from '../schemas/list-jobs.js';

// Comparator for the four supported sort keys. Mirrors `compareJobs` in
// src/dedup.ts conceptually but is parameterized by a single key here
// because list_jobs only needs the active sort, not a full chain.
function compareBy(a: Job, b: Job, sort: ListJobsInput['sort']): number {
  switch (sort) {
    case 'fitScore':
      return b.fitScore - a.fitScore;
    case 'salaryMax':
      // null → 0 so unstated comp sinks below stated, same as compareJobs.
      return (b.salaryMax ?? 0) - (a.salaryMax ?? 0);
    case 'postedAt': {
      const at = a.postedAt ? new Date(a.postedAt).getTime() : 0;
      const bt = b.postedAt ? new Date(b.postedAt).getTime() : 0;
      return bt - at;
    }
    case 'id':
      return a.id.localeCompare(b.id);
  }
}

function matchesQuery(job: Job, q: string): boolean {
  const needle = q.toLowerCase();
  if (job.title.toLowerCase().includes(needle)) return true;
  if (job.company?.toLowerCase().includes(needle)) return true;
  if (job.location?.toLowerCase().includes(needle)) return true;
  for (const tag of job.tags) {
    if (tag.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export interface ListJobsPaths {
  jobsPath: string;
  appliedPath: string;
}

const DEFAULT_LIST_JOBS_PATHS: ListJobsPaths = {
  jobsPath: JOBS_PATH,
  appliedPath: APPLIED_PATH,
};

export async function runListJobs(
  input: ListJobsInput,
  paths: ListJobsPaths = DEFAULT_LIST_JOBS_PATHS,
): Promise<ToolResult> {
  const jobs = (await readJsonOrNull<Job[]>(paths.jobsPath)) ?? [];

  // Only load applied.json when the filter is active — avoids unnecessary
  // disk read on the hot path.
  const appliedMap = input.applied !== undefined ? await loadAppliedMap(paths.appliedPath) : null;

  let filtered = jobs;

  if (input.category) filtered = filtered.filter((j) => j.category === input.category);
  if (input.source) filtered = filtered.filter((j) => j.source === input.source);
  if (input.minScore !== undefined) {
    // Capture in a local so the closure sees a narrowed `number`, not
    // `number | undefined`. Avoids a `!` non-null assertion.
    const minScore = input.minScore;
    filtered = filtered.filter((j) => j.fitScore >= minScore);
  }
  if (input.q) {
    const q = input.q;
    filtered = filtered.filter((j) => matchesQuery(j, q));
  }
  if (appliedMap !== null) {
    filtered = filtered.filter((j) => appliedMap.has(j.id) === input.applied);
  }

  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareBy(a, b, input.sort);
    return input.dir === 'asc' ? -cmp : cmp;
  });
  const limited = sorted.slice(0, input.limit);

  // Attach applied entry inline when present, so the LLM sees status without
  // a second call. Conditional spread — never set `applied: undefined`,
  // which would inject a misleading key for jobs with no application record.
  const enriched =
    appliedMap !== null
      ? limited.map((j) => {
          const entry = appliedMap.get(j.id);
          return entry ? { ...j, applied: entry } : j;
        })
      : limited;

  return toolJson({
    total: jobs.length,
    matched: filtered.length,
    returned: enriched.length,
    jobs: enriched,
  });
}

export function registerListJobs(server: McpServer): void {
  server.registerTool(
    'list_jobs',
    {
      title: 'List jobs',
      description:
        'List aggregated jobs from data/jobs.json with optional filters (category, source, applied?, q, minScore), sort (fitScore/salaryMax/postedAt/id), and limit (1-500, default 50). Returns slim job records including _signals; use get_job_detail for full body + AI review.',
      inputSchema: listJobsInputSchema,
    },
    safeHandler<ListJobsInput>('list_jobs', (input) => runListJobs(input)),
  );
}
