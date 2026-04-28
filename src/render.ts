import { STATUS_EMOJI, summarizeApplied } from './applied.js';
import type { Category, Job, Source } from './types.js';
import { formatDateTimeUTC, relativeTime } from './utils.js';

export interface RenderStats {
  generatedAt: string;
  fetchedTotal: number;
  keptTotal: number;
  newCount: number;
  removedCount: number;
  bySource: Record<Source, { fetched: number; kept: number; errors: number }>;
  byCategory: Record<Category, number>;
  droppedHard: number;
  droppedByRule: Record<string, number>;
  droppedScore: number;
  removedById: number;
  removedByTitle: number;
}

const SOURCES: Source[] = [
  'aave',
  'ashby-private',
  'ashby',
  'lever',
  'greenhouse',
  'cryptojobslist',
  'web3career',
  'aijobsnet',
  'hn-hiring',
  'hn-jobs',
  'remotive',
  'weworkremotely',
  'remoteok',
];

const CATEGORIES: Category[] = ['web3+ai', 'web3', 'ai', 'general'];

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

function byCategory(stats: RenderStats): string {
  return CATEGORIES.map((c) => `- **${c}**: ${stats.byCategory[c]}`).join('\n');
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
): string {
  const grouped: Record<Category, Job[]> = {
    'web3+ai': [],
    web3: [],
    ai: [],
    general: [],
  };
  for (const j of jobs) grouped[j.category].push(j);

  return `# Daily job matches

Auto-generated by the [job-hunt](./README.md) pipeline. Do not edit by hand — this file is overwritten on every run.

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

${byCategory(stats)}

${renderAppliedSection(jobs)}
${renderNewSection(newJobs)}
${renderRemovedSection(removedJobs)}
## Top Web3 + AI

${renderTable(grouped['web3+ai'], 10)}

## Top Web3

${renderTable(grouped.web3, 20)}

## Top AI

${renderTable(grouped.ai, 20)}

## Other

${renderTable(grouped.general, 10)}
`;
}
