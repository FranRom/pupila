import type { Plugin } from 'vite';
import { JOBS_PATH } from './_paths.ts';
import { readJsonOrDefault, safeMtime } from './_shared.ts';

interface RunSummaryJob {
  source: string;
  category: string;
  fetchedAt?: string;
}

interface RunSummary {
  generatedAt: string | null;
  total: number;
  byCategory: Record<string, number>;
  bySource: Array<{ name: string; kept: number }>;
  ageHours: number | null;
}

// Aggregate stats over the slim jobs.json so the Settings tab can show
// "last run X hours ago, kept N jobs across M sources" without re-running
// the pipeline.
export function runSummaryApiPlugin(): Plugin {
  return {
    name: 'pupila-run-summary-api',
    configureServer(server) {
      server.middlewares.use('/api/run-summary', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const jobs = await readJsonOrDefault<RunSummaryJob[]>(JOBS_PATH, []);
          const byCategory: Record<string, number> = {
            'web3+ai': 0,
            web3: 0,
            ai: 0,
            general: 0,
          };
          const sourceMap = new Map<string, number>();
          let maxFetched = 0;
          for (const j of jobs) {
            byCategory[j.category] = (byCategory[j.category] ?? 0) + 1;
            sourceMap.set(j.source, (sourceMap.get(j.source) ?? 0) + 1);
            if (j.fetchedAt) {
              const t = new Date(j.fetchedAt).getTime();
              if (Number.isFinite(t) && t > maxFetched) maxFetched = t;
            }
          }
          let generatedAt: string | null =
            maxFetched > 0 ? new Date(maxFetched).toISOString() : null;
          if (!generatedAt) {
            generatedAt = await safeMtime(JOBS_PATH);
          }
          const ageHours = generatedAt
            ? Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 3_600_000))
            : null;
          const bySource = [...sourceMap.entries()]
            .map(([name, kept]) => ({ name, kept }))
            .sort((a, b) => b.kept - a.kept);
          const summary: RunSummary = {
            generatedAt,
            total: jobs.length,
            byCategory,
            bySource,
            ageHours,
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(summary));
        } catch (err) {
          console.error('[run-summary api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
