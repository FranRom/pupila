import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { readBriefBody } from '../../src/lib/brief-template.js';
import { type LlmProvider, SUPPORTED_PROVIDERS } from '../../src/lib/llm.js';
import { bootstrapProfileIfMissing } from '../../src/lib/profile-bootstrap.js';
import {
  generateProfileFromBrief,
  mergeProfile,
  type ProfileShape,
  sanitizeRoles,
} from '../../src/lib/profile-generator.js';
import { streamableResponse } from '../../src/lib/streamable-response.js';
import { PROFILE_DEFAULT_PATH, PROFILE_PATH } from './_paths.ts';
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
    name: 'pupila-profile-api',
    async configureServer(server) {
      // Bootstrap config/profile.json from config/profile.default.json the
      // first time `pnpm run ui` runs against a fresh clone (or after the
      // user has deleted the file). COPYFILE_EXCL means this is a no-op if
      // a personalized profile already exists.
      try {
        const result = await bootstrapProfileIfMissing({
          defaultPath: PROFILE_DEFAULT_PATH,
          profilePath: PROFILE_PATH,
        });
        if (result.bootstrapped) {
          console.log(
            `[profile] bootstrapped ${result.profilePath} from ${result.defaultPath} — open Settings → Scoring profile → Regenerate to personalize.`,
          );
        }
      } catch (err) {
        console.error('[profile] bootstrap failed:', err);
      }

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

      // GET  /api/profile-roles → { roles } from config/profile.json
      // PUT  /api/profile-roles → persist a user-edited roles[] (validated)
      // Read-modify-write so all other profile fields are preserved.
      server.middlewares.use('/api/profile-roles', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            const profile = await readJsonOrDefault<ProfileShape | null>(PROFILE_PATH, null);
            res.end(JSON.stringify({ roles: profile?.roles ?? [] }));
            return;
          }
          if (req.method === 'PUT') {
            const body = (await readBody(req)) as { roles?: unknown };
            const roles = sanitizeRoles(body.roles);
            const base = await readJsonOrDefault<ProfileShape | null>(PROFILE_PATH, null);
            if (!base || typeof base !== 'object') {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'config/profile.json is missing or unparseable.' }));
              return;
            }
            const next: ProfileShape = { ...base, roles };
            await writeFile(PROFILE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            res.end(JSON.stringify({ ok: true, roles }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[profile-roles api]', err);
          res.statusCode = 500;
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

        // Phase 1: synchronous JSON validation for everything we can check
        // before the LLM runs. 412/500 stay JSON because they fire before
        // any streaming headers are committed.
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

          // Defense-in-depth: if profile.json was removed after server
          // startup (rare — typically the configureServer hook above already
          // bootstrapped it), re-seed it from the default before reading.
          await bootstrapProfileIfMissing({
            defaultPath: PROFILE_DEFAULT_PATH,
            profilePath: PROFILE_PATH,
          });
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

        // Phase 2: dual-mode LLM call via the streamable-response helper.
        // Streaming mode emits start/chunk/done NDJSON events; JSON mode
        // buffers everything and emits a single 200 at the end.
        // TODO: handle req.on('close') to abort the in-flight LLM.
        const responder = streamableResponse(req, res);
        try {
          responder.send({ type: 'start', stage: 'calling-llm' });
          let delta: Awaited<ReturnType<typeof generateProfileFromBrief>>;
          try {
            delta = await generateProfileFromBrief(
              briefBody,
              provider,
              responder.isStreaming
                ? (chunk) => responder.send({ type: 'chunk', data: chunk })
                : undefined,
            );
          } catch (err) {
            responder.fail(
              `LLM CLI failed: ${err instanceof Error ? err.message : String(err)}`,
              502,
            );
            return;
          }
          const { profile, weightsChanged, keywordsChanged, rolesChanged } = mergeProfile(
            base,
            delta,
          );
          await writeFile(PROFILE_PATH, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
          responder.finish({
            weightsChanged,
            keywordsChanged,
            rolesChanged,
            provider: provider ?? 'auto',
          });
        } catch (err) {
          console.error('[profile-generate api]', err);
          responder.fail(err instanceof Error ? err.message : String(err), 500);
        } finally {
          inFlight = false;
        }
      });
    },
  };
}
