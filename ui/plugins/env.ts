import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import type { Plugin } from 'vite';
import { availableProviders, type LlmProvider } from '../../src/lib/llm.js';
import { BRIEF_PATH, REPO_ROOT } from './_paths.ts';
import { findCvPath, readPreferences } from './_shared.ts';

interface EnvInfo {
  node: string;
  platform: string;
  repoRoot: string;
  briefPresent: boolean;
  cvPresent: boolean;
  providers: Record<LlmProvider, boolean>;
  preferredProvider: LlmProvider | 'auto' | null;
}

export function envApiPlugin(): Plugin {
  return {
    name: 'pupila-env-api',
    configureServer(server) {
      server.middlewares.use('/api/env', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const [providers, prefs, cv] = await Promise.all([
            availableProviders(),
            readPreferences(),
            findCvPath(),
          ]);
          const info: EnvInfo = {
            node: process.version,
            platform: process.platform,
            // LOW-3: strip $HOME prefix to avoid leaking the user's username on shared screenshots.
            repoRoot: REPO_ROOT.startsWith(os.homedir())
              ? `~${REPO_ROOT.slice(os.homedir().length)}`
              : REPO_ROOT,
            briefPresent: existsSync(BRIEF_PATH) && statSync(BRIEF_PATH).size > 0,
            cvPresent: cv !== null,
            providers,
            preferredProvider: prefs.provider,
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(info));
        } catch (err) {
          console.error('[env api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
