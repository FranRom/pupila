import { existsSync } from 'node:fs';
import { loadAppliedMap } from './applied.js';
import { compareJobs, dedupe } from './dedup.js';
import { renderFeed } from './feed.js';
import { fetchAave } from './fetchers/aave.js';
import { fetchAiJobsNet } from './fetchers/aijobsnet.js';
import { fetchAshby } from './fetchers/ashby.js';
import { fetchAshbyPrivate } from './fetchers/ashby-private.js';
import { fetchBluedoor } from './fetchers/bluedoor.js';
import { fetchCryptoJobsList } from './fetchers/cryptojobslist.js';
import { fetchGreenhouse } from './fetchers/greenhouse.js';
import { fetchHimalayas } from './fetchers/himalayas.js';
import { fetchHnHiring } from './fetchers/hn-hiring.js';
import { fetchHnJobs } from './fetchers/hn-jobs.js';
import { fetchJobicy } from './fetchers/jobicy.js';
import { fetchLever } from './fetchers/lever.js';
import { fetchPersonio } from './fetchers/personio.js';
import { fetchRecruitee } from './fetchers/recruitee.js';
import { fetchRemoteOk } from './fetchers/remoteok.js';
import { fetchRemoteYeah } from './fetchers/remoteyeah.js';
import { fetchRemotive } from './fetchers/remotive.js';
import { fetchWeb3Career } from './fetchers/web3career.js';
import { fetchWeWorkRemotely } from './fetchers/weworkremotely.js';
import { BOILERPLATE_HEADERS_RE, createFilters, loadProfile } from './filters.js';
import { detectLegacyEnvVars } from './legacy-env.js';
import { bootstrapProfileIfMissing } from './lib/profile-bootstrap.js';
import {
  normalizeAave,
  normalizeAiJobsNet,
  normalizeAshby,
  normalizeAshbyPrivate,
  normalizeBluedoor,
  normalizeCryptoJobsList,
  normalizeGreenhouse,
  normalizeHimalayas,
  normalizeHnHiring,
  normalizeHnJobs,
  normalizeJobicy,
  normalizeLever,
  normalizePersonio,
  normalizeRecruitee,
  normalizeRemoteOk,
  normalizeRemoteYeah,
  normalizeRemotive,
  normalizeWeb3Career,
  normalizeWeWorkRemotely,
} from './normalize.js';
import { type RenderStats, renderReadme } from './render.js';
import type { Job, Source } from './types.js';
import { isoToday, readJsonOrNull, stripHtml, writeFileEnsured, writeJson } from './utils.js';

const BODY_PREVIEW_MAX_CHARS = 280;

/**
 * Build a short, boilerplate-free preview of the job body for the slim
 * `data/jobs.json`. The slim file drops the full body to keep it small
 * (5–20 KB → <1 KB per job) and the UI uses this preview to give the user
 * a 1–2-sentence read in each row without expanding.
 */
function deriveBodyPreview(rawBody: string): string {
  if (!rawBody) return '';
  // Strip any leftover HTML, then drop the EEO/privacy/About-us boilerplate
  // tail, then collapse whitespace so the preview reads as a paragraph.
  const cleaned = stripHtml(rawBody)
    .replace(BOILERPLATE_HEADERS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= BODY_PREVIEW_MAX_CHARS) return cleaned;
  // Truncate at a word boundary to avoid mid-word cuts, then append ellipsis.
  // lastSpace === -1 means no space in the slice (URL-dense or CJK body).
  // Fall through to the hard cut — better than returning nothing.
  const slice = cleaned.slice(0, BODY_PREVIEW_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > BODY_PREVIEW_MAX_CHARS - 40 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

interface FetcherTaskResult<T> {
  source: Source;
  fetched: number;
  jobs: Job[];
  raw: T[];
  errors: string[];
}

async function processFetcher<T>(
  source: Source,
  fetcher: () => Promise<{ items: T[]; errors: string[] }>,
  normalizer: (items: T[], fetchedAt: string) => Job[],
  fetchedAt: string,
  today: string,
): Promise<FetcherTaskResult<T>> {
  // The `[start]` / `[done]` / `[error]` lines are parsed by the UI's
  // /api/fetch-jobs middleware to drive the live worker panel. Don't
  // change the format without updating the parser in ui/vite.config.ts.
  console.log(`[start] ${source}`);
  try {
    const { items, errors } = await fetcher();
    const jobs = normalizer(items, fetchedAt);
    await writeJson(`data/raw/${source}-${today}.json`, items);
    console.log(`[done] ${source} fetched=${items.length} errors=${errors.length}`);
    return { source, fetched: items.length, jobs, raw: items, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[error] ${source} ${msg}`);
    throw err;
  }
}

const BRIEF_PATH = 'config/candidate-brief.md';
const PROFILE_PATH = 'config/profile.json';

function ensureCandidateBrief(): void {
  if (existsSync(BRIEF_PATH)) return;
  if (process.env.PUPILA_NO_BRIEF_CHECK === '1') return;
  if (process.argv.includes('--no-brief-check')) return;
  console.error(`
✗ ${BRIEF_PATH} not found.

The aggregator expects you to set up your candidate profile first:

  pnpm run setup-brief --file ~/path/to/cv.pdf
  # or, drop your CV into the UI's Profile tab:
  pnpm run ui

To skip this check (raw aggregation only, no AI review):
  PUPILA_NO_BRIEF_CHECK=1 pnpm run dev
`);
  process.exit(1);
}

async function ensureProfile(): Promise<void> {
  const result = await bootstrapProfileIfMissing();
  if (result.bootstrapped) {
    console.log(
      `✓ Bootstrapped ${result.profilePath} from ${result.defaultPath} (personal weights neutral — open the UI's Settings → Scoring profile → Regenerate from brief to personalize).`,
    );
  }
}

async function main(): Promise<void> {
  const legacy = detectLegacyEnvVars(process.env);
  if (legacy.length > 0) {
    console.error('❌ Legacy JOB_HUNT_* environment variables detected:');
    for (const { old, replacement } of legacy) {
      console.error(`   ${old} → rename to ${replacement}`);
    }
    console.error('\nThe project was renamed from job-hunt to pupila.');
    console.error(
      'Update your shell config (e.g. ~/.zshrc) and re-source it, or unset the old names.',
    );
    process.exit(1);
  }
  ensureCandidateBrief();
  await ensureProfile();

  const profile = await loadProfile(PROFILE_PATH);
  const { applyFilters } = createFilters(profile);

  const fetchedAt = new Date().toISOString();
  const today = isoToday();

  const tasks = await Promise.all([
    processFetcher('remoteok', fetchRemoteOk, normalizeRemoteOk, fetchedAt, today),
    processFetcher('remotive', fetchRemotive, normalizeRemotive, fetchedAt, today),
    processFetcher('jobicy', fetchJobicy, normalizeJobicy, fetchedAt, today),
    processFetcher('himalayas', fetchHimalayas, normalizeHimalayas, fetchedAt, today),
    processFetcher(
      'weworkremotely',
      fetchWeWorkRemotely,
      normalizeWeWorkRemotely,
      fetchedAt,
      today,
    ),
    processFetcher('remoteyeah', fetchRemoteYeah, normalizeRemoteYeah, fetchedAt, today),
    processFetcher(
      'cryptojobslist',
      fetchCryptoJobsList,
      normalizeCryptoJobsList,
      fetchedAt,
      today,
    ),
    processFetcher('web3career', fetchWeb3Career, normalizeWeb3Career, fetchedAt, today),
    processFetcher('aijobsnet', fetchAiJobsNet, normalizeAiJobsNet, fetchedAt, today),
    processFetcher('hn-hiring', fetchHnHiring, normalizeHnHiring, fetchedAt, today),
    processFetcher('hn-jobs', fetchHnJobs, normalizeHnJobs, fetchedAt, today),
    processFetcher('greenhouse', fetchGreenhouse, normalizeGreenhouse, fetchedAt, today),
    processFetcher('ashby', fetchAshby, normalizeAshby, fetchedAt, today),
    processFetcher('lever', fetchLever, normalizeLever, fetchedAt, today),
    processFetcher('recruitee', fetchRecruitee, normalizeRecruitee, fetchedAt, today),
    processFetcher('personio', fetchPersonio, normalizePersonio, fetchedAt, today),
    processFetcher('aave', fetchAave, normalizeAave, fetchedAt, today),
    processFetcher('ashby-private', fetchAshbyPrivate, normalizeAshbyPrivate, fetchedAt, today),
    processFetcher(
      'bluedoor',
      () => fetchBluedoor(profile.location),
      normalizeBluedoor,
      fetchedAt,
      today,
    ),
  ]);

  const allJobs = tasks.flatMap((t) => t.jobs);
  const fetchedTotal = tasks.reduce((s, t) => s + t.fetched, 0);

  const filterResult = applyFilters(allJobs);
  const dedupResult = dedupe(filterResult.kept);

  dedupResult.kept.sort(compareJobs);

  const bySource = {} as RenderStats['bySource'];
  for (const t of tasks) {
    const keptCount = dedupResult.kept.filter((j) => j.source === t.source).length;
    bySource[t.source] = { fetched: t.fetched, kept: keptCount, errors: t.errors.length };
  }

  // Counts keyed by category id; a multi-label job increments each of its ids.
  // Jobs matching no category are uncategorized (rendered under "Other").
  const byCategory: Record<string, number> = {};
  for (const j of dedupResult.kept) {
    for (const id of j.categories) byCategory[id] = (byCategory[id] ?? 0) + 1;
  }

  const previous = await readJsonOrNull<Job[]>('data/jobs.json');
  const previousIds = new Set((previous ?? []).map((j) => j.id));
  const currentIds = new Set(dedupResult.kept.map((j) => j.id));
  const newJobs = previous === null ? [] : dedupResult.kept.filter((j) => !previousIds.has(j.id));
  const removedJobs =
    previous === null ? [] : (previous ?? []).filter((j) => !currentIds.has(j.id));

  const appliedMap = await loadAppliedMap();
  for (const job of dedupResult.kept) {
    const entry = appliedMap.get(job.id);
    if (entry) job.applied = entry;
  }

  // Compute a short JD preview from the full body BEFORE stripping it from
  // the slim payload. The UI renders this under each row title so the user
  // can scan jobs without expanding every one.
  const slimJobs = dedupResult.kept.map(({ body, ...rest }) => ({
    ...rest,
    bodyPreview: deriveBodyPreview(body),
  }));
  const month = today.slice(0, 7);
  const isFirstOfMonth = today.endsWith('-01');

  const stats: RenderStats = {
    generatedAt: fetchedAt,
    fetchedTotal,
    keptTotal: dedupResult.kept.length,
    newCount: newJobs.length,
    removedCount: removedJobs.length,
    bySource,
    byCategory,
    droppedHard: filterResult.droppedHard,
    droppedByRule: filterResult.droppedByRule,
    droppedScore: filterResult.droppedScore,
    removedById: dedupResult.removedById,
    removedByTitle: dedupResult.removedByTitle,
  };

  await writeJson('data/jobs.json', slimJobs);
  // Sidecar with bodies for the optional `pnpm run ai-review` step. Gitignored
  // — local-only, regenerated on every pipeline run, never committed.
  await writeJson(
    'data/jobs-bodies.json',
    Object.fromEntries(dedupResult.kept.map((j) => [j.id, j.body])),
  );
  if (isFirstOfMonth) {
    await writeJson(`data/archive/${month}.json`, slimJobs);
  }
  await writeFileEnsured(
    'JOBS.md',
    renderReadme(dedupResult.kept, stats, newJobs, removedJobs, profile.categories ?? []),
  );
  await writeFileEnsured('data/feed.xml', renderFeed(newJobs, fetchedAt));

  console.log('--- Run summary ---');
  for (const t of tasks) {
    const kept = bySource[t.source].kept;
    console.log(`  ${t.source.padEnd(15)} fetched=${t.fetched} kept=${kept}`);
  }
  console.log(`  ${'TOTAL'.padEnd(15)} fetched=${fetchedTotal} kept=${dedupResult.kept.length}`);
  console.log(
    `  drops:        hard=${filterResult.droppedHard} score=${filterResult.droppedScore}`,
  );
  console.log(
    `  dedupe:       by-id=${dedupResult.removedById} by-title=${dedupResult.removedByTitle}`,
  );
  console.log(`  by category:  ${JSON.stringify(byCategory)}`);
  console.log(`  new vs prev:  ${newJobs.length}`);
  console.log(`  removed:      ${removedJobs.length}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
