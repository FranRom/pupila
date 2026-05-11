import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { readBriefBody } from '../../src/lib/brief-template.js';
import { type LlmProvider, SUPPORTED_PROVIDERS } from '../../src/lib/llm.js';
import {
  generateProfileFromBrief,
  mergeProfile,
  type ProfileShape,
} from '../../src/lib/profile-generator.js';
import { PROFILE_PATH } from './_paths.ts';
import { readBody, readJsonOrDefault } from './_shared.ts';

// ── Profile generator API ──────────────────────────────────────────────────
//
// POST /api/profile-generate — runs the LLM CLI on the candidate brief and
// merges the resulting personalization delta into config/profile.json.
// Universal fields (junior excludes, seniorReq, US-only filter, etc.) are
// preserved; only personal weight/keyword slices are touched.
// GET /api/profile — returns the live profile.json (used by the Settings
// "Scoring profile" panel to show what's active and detect "neutral" state).

interface ProfileGenerateBody {
  provider?: unknown;
}

export function profileApiPlugin(): Plugin {
  let inFlight = false;
  return {
    name: 'job-hunt-profile-api',
    configureServer(server) {
      server.middlewares.use('/api/profile', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const profile = await readJsonOrDefault<ProfileShape | null>(PROFILE_PATH, null);
          res.setHeader('Content-Type', 'application/json');
          // MED-7: Worker C's Scoring Profile panel reads `generating` to surface
          // "background generation in flight" state. Response shape changed from
          // ScoringProfile|null to { profile, generating }. Keep both sides in sync.
          res.end(JSON.stringify({ profile, generating: inFlight }));
        } catch (err) {
          console.error('[profile api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/profile-generate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (inFlight) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'profile generation is already running' }));
          return;
        }
        // Clients pass `Accept: application/x-ndjson` to opt into streaming.
        // Settings keeps the old JSON shape; onboarding asks for NDJSON.
        const wantsStream = (req.headers.accept ?? '').includes('application/x-ndjson');
        inFlight = true;

        // Phase 1: synchronous JSON validation for everything we can check
        // before the LLM runs. 412/500 stay JSON in both branches because
        // they happen before any streaming headers are committed.
        let provider: LlmProvider | undefined;
        let briefBody: string;
        let base: ProfileShape;
        try {
          const body = (await readBody(req)) as ProfileGenerateBody;
          const rawProvider = typeof body.provider === 'string' ? body.provider : null;
          provider =
            rawProvider && SUPPORTED_PROVIDERS.includes(rawProvider as LlmProvider)
              ? (rawProvider as LlmProvider)
              : undefined;

          const maybeBrief = await readBriefBody();
          if (!maybeBrief?.trim()) {
            inFlight = false;
            res.statusCode = 412;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'config/candidate-brief.md is missing or empty — finish onboarding first.',
              }),
            );
            return;
          }
          briefBody = maybeBrief;

          const maybeBase = await readJsonOrDefault<ProfileShape | null>(PROFILE_PATH, null);
          if (!maybeBase || typeof maybeBase !== 'object') {
            inFlight = false;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'config/profile.json is missing or unparseable.' }));
            return;
          }
          base = maybeBase;
        } catch (err) {
          inFlight = false;
          console.error('[profile-generate api] input parse failed', err);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          return;
        }

        // Phase 2 — common LLM path. Streaming branch (NDJSON) and default
        // branch (JSON) share the same logic; only the progress reporting
        // differs.
        if (wantsStream) {
          // TODO: wire up `req.on('close')` to abort the in-flight LLM.
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('X-Accel-Buffering', 'no');
          const send = (event: Record<string, unknown>): void => {
            try {
              res.write(`${JSON.stringify(event)}\n`);
            } catch {
              // client disconnected — silently drop
            }
          };

          try {
            send({ type: 'start', stage: 'calling-llm' });
            let delta: Awaited<ReturnType<typeof generateProfileFromBrief>>;
            try {
              delta = await generateProfileFromBrief(briefBody, provider, (chunk) => {
                send({ type: 'chunk', data: chunk });
              });
            } catch (err) {
              send({
                type: 'error',
                error: `LLM CLI failed: ${err instanceof Error ? err.message : String(err)}`,
              });
              res.end();
              return;
            }

            const { profile, weightsChanged, keywordsChanged } = mergeProfile(base, delta);
            await writeFile(PROFILE_PATH, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

            send({
              type: 'done',
              weightsChanged,
              keywordsChanged,
              provider: provider ?? 'auto',
            });
            res.end();
          } catch (err) {
            console.error('[profile-generate api]', err);
            send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
            res.end();
          } finally {
            inFlight = false;
          }
          return;
        }

        // Default JSON path (Settings → Regenerate). Same logic, single
        // response at the end. Behavior identical to the pre-streaming
        // version.
        try {
          let delta: Awaited<ReturnType<typeof generateProfileFromBrief>>;
          try {
            delta = await generateProfileFromBrief(briefBody, provider);
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `LLM CLI failed: ${err instanceof Error ? err.message : String(err)}`,
              }),
            );
            return;
          }
          const { profile, weightsChanged, keywordsChanged } = mergeProfile(base, delta);
          await writeFile(PROFILE_PATH, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              weightsChanged,
              keywordsChanged,
              provider: provider ?? 'auto',
            }),
          );
        } catch (err) {
          console.error('[profile-generate api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        } finally {
          inFlight = false;
        }
      });
    },
  };
}
