import type { Plugin } from 'vite';
import {
  type AppliedEntry,
  readApplied,
  readBody,
  todayIso,
  VALID_STATUSES,
  writeApplied,
} from './_shared.ts';

export function appliedApiPlugin(): Plugin {
  return {
    name: 'job-hunt-applied-api',
    configureServer(server) {
      server.middlewares.use('/api/applied', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const entries = await readApplied();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entries));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as Partial<AppliedEntry>;
            const url = typeof body.url === 'string' ? body.url.trim() : '';
            const status = typeof body.status === 'string' ? body.status : '';
            const date =
              typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
                ? body.date
                : todayIso();
            const notes =
              typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;
            if (!url || !VALID_STATUSES.has(status)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid url or status' }));
              return;
            }
            const entries = await readApplied();
            const idx = entries.findIndex((e) => e?.url === url);
            const next: AppliedEntry = {
              url,
              status,
              date,
              ...(notes ? { notes } : {}),
            };
            if (idx >= 0) entries[idx] = next;
            else entries.push(next);
            await writeApplied(entries);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(next));
            return;
          }
          if (req.method === 'DELETE') {
            const body = (await readBody(req)) as Partial<AppliedEntry>;
            const url = typeof body.url === 'string' ? body.url.trim() : '';
            if (!url) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid url' }));
              return;
            }
            const entries = await readApplied();
            const filtered = entries.filter((e) => e?.url !== url);
            await writeApplied(filtered);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[applied api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}
