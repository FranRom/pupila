import { stat } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Job } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { JOBS_PATH } from '../paths.js';

export interface RunSummaryPaths {
  jobsPath: string;
}

const DEFAULT_PATHS: RunSummaryPaths = {
  jobsPath: JOBS_PATH,
};

async function safeMtime(p: string): Promise<string | null> {
  try {
    return (await stat(p)).mtime.toISOString();
  } catch {
    return null;
  }
}

export async function runRunSummary(paths: RunSummaryPaths = DEFAULT_PATHS): Promise<ToolResult> {
  const jobs = (await readJsonOrNull<Job[]>(paths.jobsPath)) ?? [];
  // Keyed by category id (a multi-label job counts under each of its ids);
  // jobs matching no category are tallied under "other".
  const byCategory: Record<string, number> = {};
  const sourceMap = new Map<string, number>();
  let maxFetched = 0;
  for (const j of jobs) {
    // `?? []` tolerates legacy jobs.json entries written before `categories`.
    const cats = j.categories ?? [];
    if (cats.length === 0) byCategory.other = (byCategory.other ?? 0) + 1;
    for (const id of cats) byCategory[id] = (byCategory[id] ?? 0) + 1;
    sourceMap.set(j.source, (sourceMap.get(j.source) ?? 0) + 1);
    if (j.fetchedAt) {
      const t = new Date(j.fetchedAt).getTime();
      if (Number.isFinite(t) && t > maxFetched) maxFetched = t;
    }
  }
  let generatedAt: string | null = maxFetched > 0 ? new Date(maxFetched).toISOString() : null;
  if (!generatedAt) generatedAt = await safeMtime(paths.jobsPath);
  const ageHours = generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 3_600_000))
    : null;
  const bySource = [...sourceMap.entries()]
    .map(([name, kept]) => ({ name, kept }))
    .sort((a, b) => b.kept - a.kept);

  return toolJson({
    generatedAt,
    total: jobs.length,
    byCategory,
    bySource,
    ageHours,
  });
}

export function registerRunSummary(server: McpServer): void {
  server.registerTool(
    'run_summary',
    {
      title: 'Aggregate run summary',
      description:
        'Return { generatedAt, total, byCategory, bySource, ageHours } summarizing data/jobs.json. Same shape as the UI Settings panel `[03] LAST RUN`.',
      inputSchema: {},
    },
    safeHandler('run_summary', () => runRunSummary()),
  );
}
