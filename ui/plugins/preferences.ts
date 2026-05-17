import type { Plugin } from 'vite';
import {
  type Preferences,
  readBody,
  readPreferences,
  VALID_PROVIDER_OR_AUTO,
  writePreferences,
} from './_shared.ts';

// `/api/preferences` — first-run wizard target. GET returns the stored
// preferences (or empty defaults). POST validates `provider` against the
// supported list (plus `auto`) and stamps `onboardedAt` if not already set.
export function preferencesApiPlugin(): Plugin {
  return {
    name: 'pupila-preferences-api',
    configureServer(server) {
      server.middlewares.use('/api/preferences', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const prefs = await readPreferences();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(prefs));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as Partial<Preferences>;
            const provider =
              typeof body.provider === 'string' && VALID_PROVIDER_OR_AUTO.has(body.provider)
                ? (body.provider as Preferences['provider'])
                : null;
            if (!provider) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: `provider must be one of: ${[...VALID_PROVIDER_OR_AUTO].join(', ')}`,
                }),
              );
              return;
            }
            const existing = await readPreferences();
            const next: Preferences = {
              provider,
              onboardedAt: existing.onboardedAt ?? new Date().toISOString().slice(0, 10),
            };
            await writePreferences(next);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(next));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[preferences api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
