import { loadAppliedMap } from './applied.js';
import { dedupe } from './dedup.js';
import { renderFeed } from './feed.js';
import { fetchAave } from './fetchers/aave.js';
import { fetchAiJobsNet } from './fetchers/aijobsnet.js';
import { fetchAshby } from './fetchers/ashby.js';
import { fetchAshbyPrivate } from './fetchers/ashby-private.js';
import { fetchCryptoJobsList } from './fetchers/cryptojobslist.js';
import { fetchGreenhouse } from './fetchers/greenhouse.js';
import { fetchHnHiring } from './fetchers/hn-hiring.js';
import { fetchHnJobs } from './fetchers/hn-jobs.js';
import { fetchLever } from './fetchers/lever.js';
import { fetchRemoteOk } from './fetchers/remoteok.js';
import { fetchRemotive } from './fetchers/remotive.js';
import { fetchWeb3Career } from './fetchers/web3career.js';
import { fetchWeWorkRemotely } from './fetchers/weworkremotely.js';
import { applyFilters } from './filters.js';
import {
  normalizeAave,
  normalizeAiJobsNet,
  normalizeAshby,
  normalizeAshbyPrivate,
  normalizeCryptoJobsList,
  normalizeGreenhouse,
  normalizeHnHiring,
  normalizeHnJobs,
  normalizeLever,
  normalizeRemoteOk,
  normalizeRemotive,
  normalizeWeb3Career,
  normalizeWeWorkRemotely,
} from './normalize.js';
import { type RenderStats, renderReadme } from './render.js';
import type { Category, Job, Source } from './types.js';
import { isoToday, readJsonOrNull, writeFileEnsured, writeJson } from './utils.js';

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
  const { items, errors } = await fetcher();
  const jobs = normalizer(items, fetchedAt);
  await writeJson(`data/raw/${source}-${today}.json`, items);
  return { source, fetched: items.length, jobs, raw: items, errors };
}

async function main(): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const today = isoToday();

  const tasks = await Promise.all([
    processFetcher('remoteok', fetchRemoteOk, normalizeRemoteOk, fetchedAt, today),
    processFetcher('remotive', fetchRemotive, normalizeRemotive, fetchedAt, today),
    processFetcher(
      'weworkremotely',
      fetchWeWorkRemotely,
      normalizeWeWorkRemotely,
      fetchedAt,
      today,
    ),
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
    processFetcher('aave', fetchAave, normalizeAave, fetchedAt, today),
    processFetcher('ashby-private', fetchAshbyPrivate, normalizeAshbyPrivate, fetchedAt, today),
  ]);

  const allJobs = tasks.flatMap((t) => t.jobs);
  const fetchedTotal = tasks.reduce((s, t) => s + t.fetched, 0);

  const filterResult = applyFilters(allJobs);
  const dedupResult = dedupe(filterResult.kept);

  dedupResult.kept.sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
    const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const bySource = {} as RenderStats['bySource'];
  for (const t of tasks) {
    const keptCount = dedupResult.kept.filter((j) => j.source === t.source).length;
    bySource[t.source] = { fetched: t.fetched, kept: keptCount, errors: t.errors.length };
  }

  const byCategory: Record<Category, number> = {
    'web3+ai': 0,
    web3: 0,
    ai: 0,
    general: 0,
  };
  for (const j of dedupResult.kept) byCategory[j.category]++;

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

  const slimJobs = dedupResult.kept.map(({ body: _body, ...rest }) => rest);
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
  if (isFirstOfMonth) {
    await writeJson(`data/archive/${month}.json`, slimJobs);
  }
  await writeFileEnsured('JOBS.md', renderReadme(dedupResult.kept, stats, newJobs, removedJobs));
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
