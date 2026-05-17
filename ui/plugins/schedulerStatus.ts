import { exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';
import { DATA_DIR, REPO_ROOT } from './_paths.ts';
import { maxMtime, safeMtime } from './_shared.ts';

const execAsync = promisify(exec);

interface SchedulerStatus {
  platform: 'darwin' | 'linux' | 'other';
  installed: { aggregate: boolean; review: boolean };
  lastRun: { aggregate: string | null; review: string | null };
  installCmd: string;
  uninstallCmd: string;
}

// Detect launchd/cron registration without modifying any system state.
export function schedulerStatusApiPlugin(): Plugin {
  return {
    name: 'pupila-scheduler-status-api',
    configureServer(server) {
      server.middlewares.use('/api/scheduler-status', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const platform = process.platform;
          const user = os.userInfo().username;
          const status: SchedulerStatus = {
            platform: platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : 'other',
            installed: { aggregate: false, review: false },
            lastRun: { aggregate: null, review: null },
            installCmd:
              platform === 'darwin' ? 'scripts/install-launchd.sh' : 'scripts/install-cron.sh',
            uninstallCmd:
              platform === 'darwin'
                ? 'scripts/install-launchd.sh --uninstall'
                : 'scripts/install-cron.sh --uninstall',
          };

          if (platform === 'darwin') {
            const aggLabel = `dev.${user}.pupila.aggregate`;
            const revLabel = `dev.${user}.pupila.review`;
            try {
              const { stdout } = await execAsync('launchctl list', { timeout: 4000 });
              status.installed.aggregate = stdout.includes(aggLabel);
              status.installed.review = stdout.includes(revLabel);
            } catch {
              // launchctl not available — leave installed as false
            }
            status.lastRun.aggregate = await maxMtime([
              path.join(DATA_DIR, 'launchd-aggregate.out.log'),
              path.join(DATA_DIR, 'launchd-aggregate.err.log'),
            ]);
            status.lastRun.review = await maxMtime([
              path.join(DATA_DIR, 'launchd-review.out.log'),
              path.join(DATA_DIR, 'launchd-review.err.log'),
            ]);
          } else if (platform === 'linux') {
            try {
              const { stdout } = await execAsync('crontab -l', { timeout: 4000 });
              status.installed.aggregate = stdout.includes(`# pupila:aggregate:${REPO_ROOT}`);
              status.installed.review = stdout.includes(`# pupila:review:${REPO_ROOT}`);
            } catch {
              // no crontab → installed remains false
            }
            status.lastRun.aggregate = await safeMtime(path.join(DATA_DIR, 'cron-aggregate.log'));
            status.lastRun.review = await safeMtime(path.join(DATA_DIR, 'cron-review.log'));
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(status));
        } catch (err) {
          console.error('[scheduler-status api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
