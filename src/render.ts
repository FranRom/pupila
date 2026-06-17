import { STATUS_EMOJI, summarizeApplied } from './applied.js';
import type { CategoryDef, Job, Source } from './types.js';
import { formatDateTimeUTC, relativeTime } from './utils.js';

export interface RenderStats {
  generatedAt: string;
  fetchedTotal: number;
  keptTotal: number;
  newCount: number;
  removedCount: number;
  bySource: Record<Source, { fetched: number; kept: number; errors: number }>;
  // Kept-job counts keyed by category id (a multi-label job counts under each
  // of its ids). Jobs matching no category are uncategorized — not counted here.
  byCategory: Record<string, number>;
  droppedHard: number;
  droppedByRule: Record<string, number>;
  droppedScore: number;
  removedById: number;
  removedByTitle: number;
}

// Display order for the by-source counts in JOBS.md (best-quality first) — its
// own ordering, but `as const satisfies` + the exhaustiveness check below make
// it a compile error to omit (or misspell) any Source from `src/types.ts`.
const SOURCES = [
  'aave',
  'ashby-private',
  'ashby',
  'lever',
  'greenhouse',
  'recruitee',
  'personio',
  'cryptojobslist',
  'web3career',
  'aijobsnet',
  'hn-hiring',
  'hn-jobs',
  'remotive',
  'weworkremotely',
  'remoteok',
  'remoteyeah',
  'jobicy',
  'himalayas',
  'bluedoor',
] as const satisfies readonly Source[];

// Fails to compile if any Source is missing from the display list above.
type _RenderSourcesExhaustive =
  Exclude<Source, (typeof SOURCES)[number]> extends never
    ? true
    : ['render SOURCES missing a Source value', Exclude<Source, (typeof SOURCES)[number]>];
const _renderSourcesExhaustive: _RenderSourcesExhaustive = true;
void _renderSourcesExhaustive;

// Rows shown under the synthetic "Other" section (jobs matching no category).
const OTHER_SECTION_LIMIT = 10;
// Rows per configured category section when its `limit` is unset.
const DEFAULT_CATEGORY_LIMIT = 20;

interface CategoryGrouping {
  /** Configured-category id → its jobs (multi-label: a job can be in several). */
  groups: Map<string, Job[]>;
  /** Jobs matching no configured category (empty `categories`, or only stale ids). */
  other: Job[];
}

// Bucket jobs by configured category id (multi-label) and collect the rest under
// "Other". A job carrying an id no longer present in the config falls to Other.
function groupByCategory(jobs: Job[], categories: readonly CategoryDef[]): CategoryGrouping {
  const groups = new Map<string, Job[]>(categories.map((c) => [c.id, []]));
  const other: Job[] = [];
  for (const j of jobs) {
    let placed = false;
    for (const id of j.categories) {
      const bucket = groups.get(id);
      if (bucket) {
        bucket.push(j);
        placed = true;
      }
    }
    if (!placed) other.push(j);
  }
  return { groups, other };
}

function escapeMd(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 120);
}

function escapeMdUrl(url: string): string {
  return url.replace(/\)/g, '%29').replace(/\(/g, '%28');
}

function row(job: Job): string {
  const prefix = job.applied ? `${STATUS_EMOJI[job.applied.status]} ` : '';
  const titleText = escapeMd(job.title);
  const salarySuffix = job.salary ? ` · ${escapeMd(job.salary)}` : '';
  const title = `${prefix}${titleText}${salarySuffix}`;
  const company = escapeMd(job.company ?? '—');
  const posted = job.postedAt ? relativeTime(job.postedAt) : '—';
  const link = `[apply](${escapeMdUrl(job.url)})`;
  return `| ${job.fitScore} | ${title} | ${company} | ${job.source} | ${posted} | ${link} |`;
}

function renderTable(jobs: Job[], limit: number): string {
  if (jobs.length === 0) return '_No jobs in this category right now._\n';
  const header = '| Score | Title | Company | Source | Posted | Link |';
  const sep = '|------:|-------|---------|--------|--------|------|';
  const body = jobs.slice(0, limit).map(row).join('\n');
  return `${header}\n${sep}\n${body}\n`;
}

function renderHardDropBreakdown(byRule: Record<string, number>): string {
  const entries = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '';
  const parts = entries.map(([name, count]) => `${name}=${count}`);
  return ` (${parts.join(', ')})`;
}

function bySource(stats: RenderStats): string {
  const lines: string[] = [];
  for (const s of SOURCES) {
    const v = stats.bySource[s];
    if (!v) continue;
    const errSuffix = v.errors > 0 ? ` (${v.errors} errors)` : '';
    const unhealthy = v.fetched === 0 || v.errors > 0;
    const prefix = unhealthy ? '🚨 ' : '';
    lines.push(`- ${prefix}**${s}**: ${v.fetched} fetched → ${v.kept} kept${errSuffix}`);
  }
  return lines.join('\n');
}

function unhealthySources(stats: RenderStats): string[] {
  const out: string[] = [];
  for (const s of SOURCES) {
    const v = stats.bySource[s];
    if (!v) continue;
    if (v.fetched === 0 || v.errors > 0) out.push(s);
  }
  return out;
}

function renderSourceHealthBanner(stats: RenderStats): string {
  const sick = unhealthySources(stats);
  if (sick.length === 0) return '';
  return `> 🚨 **Source health:** ${sick.join(', ')} ${sick.length === 1 ? 'is' : 'are'} returning zero items or errors. If this persists for several days, eyeball the upstream HTML/API for changes.\n\n`;
}

// Stat lines for the "By category" block: one per configured category (by
// label), plus a trailing "Other" for the uncategorized count. Driven by the
// same grouping as the sections so the numbers always agree.
function byCategory(categories: readonly CategoryDef[], grouping: CategoryGrouping): string {
  const lines = categories.map(
    (c) => `- **${c.label}**: ${grouping.groups.get(c.id)?.length ?? 0}`,
  );
  lines.push(`- **Other**: ${grouping.other.length}`);
  return lines.join('\n');
}

function renderNewSection(newJobs: Job[]): string {
  if (newJobs.length === 0) return '';
  const sorted = [...newJobs].sort((a, b) => b.fitScore - a.fitScore);
  return `## ✨ New since last run (${newJobs.length})

${renderTable(sorted, 20)}
`;
}

function renderRemovedSection(removedJobs: Job[]): string {
  if (removedJobs.length === 0) return '';
  const sorted = [...removedJobs].sort((a, b) => b.fitScore - a.fitScore);
  return `## 🗑 Removed since last run (${removedJobs.length})

_Postings present in the previous run that are gone today (filled, withdrawn, or upstream pulled them). Showing top ${Math.min(10, sorted.length)} by previous fit score._

${renderTable(sorted, 10)}
`;
}

function renderAppliedSection(jobs: Job[]): string {
  const applied = jobs.filter((j) => j.applied !== undefined);
  if (applied.length === 0) return '';
  const entries = applied.map((j) => j.applied).filter((e): e is NonNullable<typeof e> => !!e);
  const summary = summarizeApplied(entries);
  const sorted = [...applied].sort((a, b) => {
    const ad = a.applied?.date ?? '';
    const bd = b.applied?.date ?? '';
    return bd.localeCompare(ad);
  });
  return `## 📋 Application status

${summary}

${renderTable(sorted, 50)}
`;
}

export function renderReadme(
  jobs: Job[],
  stats: RenderStats,
  newJobs: Job[],
  removedJobs: Job[] = [],
  categories: readonly CategoryDef[] = [],
): string {
  const grouping = groupByCategory(jobs, categories);

  // One "## <label>" section per configured category (in config order), capped
  // by its `limit`, followed by the synthetic "Other" bucket. Replaces the old
  // hardcoded Web3/AI/Other sections so any taxonomy renders without code edits.
  const categorySections = categories
    .map(
      (c) =>
        `## ${c.label}\n\n${renderTable(grouping.groups.get(c.id) ?? [], c.limit ?? DEFAULT_CATEGORY_LIMIT)}`,
    )
    .join('\n\n');

  return `# Daily job matches

Auto-generated by the [pupila](./README.md) pipeline. Do not edit by hand — this file is overwritten on every run.

> **Tip:** GitHub strips \`target="_blank"\` when rendering markdown, so apply links open in the same tab. Use **⌘+click** (Mac) / **Ctrl+click** (Win/Linux) / **middle-click** to open in a new tab.

**Last updated:** ${formatDateTimeUTC(stats.generatedAt)}

${renderSourceHealthBanner(stats)}## Stats

- **Total fetched (raw):** ${stats.fetchedTotal}
- **Total kept (after filters + dedup):** ${stats.keptTotal}
- **New since last run:** ${stats.newCount}
- **Removed since last run:** ${stats.removedCount}
- **Dropped — hard filters:** ${stats.droppedHard}${renderHardDropBreakdown(stats.droppedByRule)}
- **Dropped — fit score below 30:** ${stats.droppedScore}
- **Removed duplicates by URL:** ${stats.removedById}
- **Removed duplicates by company+title:** ${stats.removedByTitle}

### By source

${bySource(stats)}

### By category

${byCategory(categories, grouping)}

${renderAppliedSection(jobs)}
${renderNewSection(newJobs)}
${renderRemovedSection(removedJobs)}${categorySections ? `${categorySections}\n\n` : ''}## Other

${renderTable(grouping.other, OTHER_SECTION_LIMIT)}
`;
}
