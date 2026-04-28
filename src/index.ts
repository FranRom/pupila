import { dedupe } from './dedup.js';
import { fetchAiJobsNet } from './fetchers/aijobsnet.js';
import { fetchAshby } from './fetchers/ashby.js';
import { fetchCryptoJobsList } from './fetchers/cryptojobslist.js';
import { fetchGreenhouse } from './fetchers/greenhouse.js';
import { fetchHnHiring } from './fetchers/hn-hiring.js';
import { fetchHnJobs } from './fetchers/hn-jobs.js';
import { fetchRemoteOk } from './fetchers/remoteok.js';
import { fetchRemotive } from './fetchers/remotive.js';
import { fetchWeb3Career } from './fetchers/web3career.js';
import { fetchWeWorkRemotely } from './fetchers/weworkremotely.js';
import { applyFilters } from './filters.js';
import {
  normalizeAiJobsNet,
  normalizeAshby,
  normalizeCryptoJobsList,
  normalizeGreenhouse,
  normalizeHnHiring,
  normalizeHnJobs,
  normalizeRemoteOk,
  normalizeRemotive,
  normalizeWeb3Career,
  normalizeWeWorkRemotely,
} from './normalize.js';
import { type RenderStats, renderReadme } from './render.js';
import type { Category, Job, Source } from './types.js';
import { isoToday, writeFileEnsured, writeJson } from './utils.js';

interface FetcherTaskResult<T> {
  source: Source;
  fetched: number;
  jobs: Job[];
  raw: T[];
}

async function processFetcher<T>(
  source: Source,
  fetcher: () => Promise<T[]>,
  normalizer: (items: T[], fetchedAt: string) => Job[],
  fetchedAt: string,
  today: string,
): Promise<FetcherTaskResult<T>> {
  const items = await fetcher();
  const jobs = normalizer(items, fetchedAt);
  await writeJson(`data/raw/${source}-${today}.json`, items);
  return { source, fetched: items.length, jobs, raw: items };
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
  ]);

  const allJobs = tasks.flatMap((t) => t.jobs);
  const fetchedTotal = tasks.reduce((s, t) => s + t.fetched, 0);

  const filterResult = applyFilters(allJobs);
  const dedupResult = dedupe(filterResult.kept);

  dedupResult.kept.sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
    const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    return tb - ta;
  });

  const bySource = {} as RenderStats['bySource'];
  for (const t of tasks) {
    const keptCount = dedupResult.kept.filter((j) => j.source === t.source).length;
    bySource[t.source] = { fetched: t.fetched, kept: keptCount };
  }

  const byCategory: Record<Category, number> = {
    'web3+ai': 0,
    web3: 0,
    ai: 0,
    general: 0,
  };
  for (const j of dedupResult.kept) byCategory[j.category]++;

  const stats: RenderStats = {
    generatedAt: fetchedAt,
    fetchedTotal,
    keptTotal: dedupResult.kept.length,
    bySource,
    byCategory,
    droppedHard: filterResult.droppedHard,
    droppedScore: filterResult.droppedScore,
    removedById: dedupResult.removedById,
    removedByTitle: dedupResult.removedByTitle,
  };

  await writeJson('data/jobs.json', dedupResult.kept);
  await writeFileEnsured('JOBS.md', renderReadme(dedupResult.kept, stats));

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
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
