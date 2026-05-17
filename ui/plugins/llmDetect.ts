import type { Plugin } from 'vite';
import { availableProviders } from '../../src/lib/llm.js';

// `/api/llm-detect` — probes which CLIs are on PATH. Used by the
// onboarding wizard to ✓/✗ each provider option.
export function llmDetectApiPlugin(): Plugin {
  return {
    name: 'pupila-llm-detect-api',
    configureServer(server) {
      server.middlewares.use('/api/llm-detect', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const available = await availableProviders();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available }));
        } catch (err) {
          console.error('[llm-detect api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
