import type { Plugin } from 'vite';
import { type LlmProvider, runLlm, SUPPORTED_PROVIDERS } from '../../src/lib/llm.js';
import { readBody } from './_shared.ts';

interface LlmTestPostBody {
  provider?: unknown;
}

// Tiny prompt to confirm the chosen LLM CLI works end-to-end.
export function llmTestApiPlugin(): Plugin {
  return {
    name: 'pupila-llm-test-api',
    configureServer(server) {
      server.middlewares.use('/api/llm-test', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = (await readBody(req)) as LlmTestPostBody;
          const rawProvider = typeof body.provider === 'string' ? body.provider : 'auto';
          const provider =
            rawProvider !== 'auto' && SUPPORTED_PROVIDERS.includes(rawProvider as LlmProvider)
              ? (rawProvider as LlmProvider)
              : undefined;

          const TIMEOUT_MS = 30_000;
          const started = Date.now();
          let timeoutId: NodeJS.Timeout | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`LLM CLI timed out after ${TIMEOUT_MS / 1000}s`)),
              TIMEOUT_MS,
            );
          });
          let raw: string;
          try {
            raw = await Promise.race([
              runLlm('Reply with the single word OK and nothing else.', provider),
              timeout,
            ]);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
          const latencyMs = Date.now() - started;
          const output = raw.trim().slice(0, 200);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: output.length > 0,
              provider: provider ?? 'auto',
              latencyMs,
              output,
            }),
          );
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}
