import type { Plugin } from 'vite';
import { isValidJobId } from '../../src/lib/apply-queue.js';
import { addFavorite, loadFavorites, removeFavorite } from '../../src/lib/favorites.js';
import { pathnameOf, sendJson } from './_http.ts';
import { FAVORITES_PATH } from './_paths.ts';

export function favoritesApiPlugin(): Plugin {
  return {
    name: 'pupila-favorites-api',
    configureServer(server) {
      server.middlewares.use('/api/favorites', async (req, res) => {
        try {
          const method = req.method ?? 'GET';
          // Connect strips the registered prefix, so req.url is what came
          // after `/api/favorites`: '/' or '/<jobId>'.
          const url = pathnameOf(req.url);

          if (method === 'GET' && (url === '/' || url === '')) {
            const { favorites, damaged } = await loadFavorites(FAVORITES_PATH);
            sendJson(res, 200, {
              favorites: Array.from(new Set(favorites.map((f) => f.jobId))),
              ...(damaged ? { damaged: true } : {}),
            });
            return;
          }

          if (method === 'POST' && url.startsWith('/') && url.length > 1) {
            const jobId = url.slice(1);
            if (!isValidJobId(jobId)) {
              sendJson(res, 400, { error: 'jobId required (expected sha1 hex)' });
              return;
            }
            await addFavorite(jobId, FAVORITES_PATH);
            sendJson(res, 200, { ok: true });
            return;
          }

          if (method === 'DELETE' && url.startsWith('/') && url.length > 1) {
            const jobId = url.slice(1);
            if (!isValidJobId(jobId)) {
              sendJson(res, 400, { error: 'jobId required (expected sha1 hex)' });
              return;
            }
            await removeFavorite(jobId, FAVORITES_PATH);
            sendJson(res, 200, { ok: true });
            return;
          }

          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[favorites api]', err);
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
