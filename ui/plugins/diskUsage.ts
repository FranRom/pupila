import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { APPLICATIONS_DIR, DATA_DIR } from './_paths.ts';

interface DiskBucket {
  bytes: number;
  files: number;
}

interface DiskUsage {
  raw: DiskBucket;
  applications: DiskBucket;
  archive: DiskBucket;
  total: DiskBucket;
}

const MAX_WALK_DEPTH = 4;

async function walkBucket(absDir: string): Promise<DiskBucket> {
  const result: DiskBucket = { bytes: 0, files: 0 };
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const s = await stat(full);
          result.bytes += s.size;
          result.files += 1;
        } catch {
          // missing/permission — skip
        }
      }
    }
  }
  await walk(absDir, 0);
  return result;
}

export function diskUsageApiPlugin(): Plugin {
  return {
    name: 'pupila-disk-usage-api',
    configureServer(server) {
      server.middlewares.use('/api/disk-usage', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const [raw, applications, archive] = await Promise.all([
            walkBucket(path.join(DATA_DIR, 'raw')),
            walkBucket(APPLICATIONS_DIR),
            walkBucket(path.join(DATA_DIR, 'archive')),
          ]);
          const total: DiskBucket = {
            bytes: raw.bytes + applications.bytes + archive.bytes,
            files: raw.files + applications.files + archive.files,
          };
          const out: DiskUsage = { raw, applications, archive, total };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(out));
        } catch (err) {
          console.error('[disk-usage api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
