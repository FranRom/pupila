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
        inFlight = true;
        try {
          const body = (await readBody(req)) as ProfileGenerateBody;
          const rawProvider = typeof body.provider === 'string' ? body.provider : null;
          const provider =
            rawProvider && SUPPORTED_PROVIDERS.includes(rawProvider as LlmProvider)
              ? (rawProvider as LlmProvider)
              : undefined;

          const briefBody = await readBriefBody();
          if (!briefBody?.trim()) {
            res.statusCode = 412;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'config/candidate-brief.md is missing or empty — finish onboarding first.',
              }),
            );
            return;
          }

          const base = await readJsonOrDefault<ProfileShape | null>(PROFILE_PATH, null);
          if (!base || typeof base !== 'object') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'config/profile.json is missing or unparseable.' }));
            return;
          }

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
