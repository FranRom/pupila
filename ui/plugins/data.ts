import type { Plugin } from 'vite';
import { JOBS_PATH, REVIEWS_PATH } from './_paths.ts';
import { readJsonOrDefault } from './_shared.ts';

// `data/jobs.json` and `data/ai-reviews.json` are gitignored personal /
// AI-generated artifacts, so we serve them at runtime via these endpoints
// instead of statically importing them. A fresh clone with no data files
// gets `[]` / `{}` and renders the empty state cleanly.
export function dataApiPlugin(): Plugin {
  return {
    name: 'pupila-data-api',
    configureServer(server) {
      server.middlewares.use('/api/jobs', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const jobs = await readJsonOrDefault<unknown[]>(JOBS_PATH, []);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(jobs));
        } catch (err) {
          console.error('[jobs api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/reviews', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const reviews = await readJsonOrDefault<Record<string, unknown>>(REVIEWS_PATH, {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reviews));
        } catch (err) {
          console.error('[reviews api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
