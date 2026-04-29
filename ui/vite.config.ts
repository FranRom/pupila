import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Connect, defineConfig, type Plugin } from 'vite';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPLIED_PATH = path.join(REPO_ROOT, 'config', 'applied.json');

const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'rejected', 'withdrawn']);

interface AppliedEntry {
  url: string;
  status: string;
  date: string;
  notes?: string;
}

async function readApplied(): Promise<AppliedEntry[]> {
  try {
    const raw = await readFile(APPLIED_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AppliedEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeApplied(entries: AppliedEntry[]): Promise<void> {
  await writeFile(APPLIED_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function appliedApiPlugin(): Plugin {
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

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), appliedApiPlugin()],
  server: { port: 5173, open: true, host: '127.0.0.1' },
});
