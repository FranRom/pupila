import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { readBriefBody, writeBriefBody } from '../../src/lib/brief-template.js';
import { type CvFormat, parseCvBuffer } from '../../src/lib/cv-parser.js';
import { runLlm } from '../../src/lib/llm.js';
import { stripFences } from '../../src/lib/profile-generator.js';
import { streamableResponse } from '../../src/lib/streamable-response.js';
import { CV_BASENAME } from './_paths.ts';
import { CV_MAX_CHARS, readBody, VALID_CV_FORMATS } from './_shared.ts';

interface BriefGetResponse {
  body: string | null;
}

interface BriefPostBody {
  markdown?: unknown;
}

interface CvPostBody {
  format?: unknown;
  data?: unknown;
}

function buildCvSummaryPrompt(cvText: string): string {
  return `You are summarizing the following CV into a short candidate brief that will be sent to an LLM each time the candidate's job-matching tool evaluates a posting. The brief decides whether the LLM agrees with the rule-based fit score.

Output ONLY three short paragraphs as plain markdown text. No preamble, no markdown fences, no headings, no commentary.

PARAGRAPH 1 — Who they are: role, years of experience, primary location, primary stack/skills. Be concrete (frameworks, languages, tools they ship with regularly).
PARAGRAPH 2 — What they're looking for: target seniority (senior / lead / staff / principal IC), domains/sectors of interest, location preference (remote-worldwide / remote-EMEA / hybrid in <city> / open to relocation).
PARAGRAPH 3 — What to avoid: roles that look like a fit on paper but aren't. Examples: wrong specialty, wrong level, on-site only, US-only positions, support/solutions/devrel/GTM titles.

Aim for 6-10 lines total. Drop anything that doesn't help a job-matching tool decide. Don't editorialize.

CV:
${cvText.slice(0, CV_MAX_CHARS)}`;
}

export function briefApiPlugin(): Plugin {
  return {
    name: 'pupila-brief-api',
    configureServer(server) {
      server.middlewares.use('/api/brief', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const body = await readBriefBody();
            const payload: BriefGetResponse = { body };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
            return;
          }
          if (req.method === 'POST') {
            const body = (await readBody(req)) as BriefPostBody;
            const markdown = typeof body.markdown === 'string' ? body.markdown : '';
            if (!markdown.trim()) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'empty markdown' }));
              return;
            }
            await writeBriefBody(markdown);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, body: markdown.trim() }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          console.error('[brief api]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/cv', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }

        // Phase 1: synchronous input validation. Bad input always gets a
        // normal JSON 4xx regardless of Accept — streaming hasn't started
        // yet so we can still set a status code.
        let format: CvFormat;
        let buf: Buffer;
        try {
          const body = (await readBody(req)) as CvPostBody;
          const rawFormat = typeof body.format === 'string' ? (body.format as CvFormat) : null;
          const data = typeof body.data === 'string' ? body.data : '';
          if (!rawFormat || !VALID_CV_FORMATS.has(rawFormat)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid format (pdf/docx/md/txt)' }));
            return;
          }
          if (!data) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'empty data' }));
            return;
          }
          format = rawFormat;
          // Binary formats arrive base64-encoded; text formats arrive as
          // utf-8 strings sent via JSON. Either way, normalize to a Buffer.
          buf =
            format === 'pdf' || format === 'docx'
              ? Buffer.from(data, 'base64')
              : Buffer.from(data, 'utf-8');
        } catch (err) {
          console.error('[cv api] input parse failed', err);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          return;
        }

        // Phase 2: dual-mode LLM call. `responder.send()` emits NDJSON
        // events when Accept asks for streaming; it's a no-op in JSON mode.
        // `responder.finish()` either emits the terminal `done` event or
        // sends the full JSON response. Either way the success path looks
        // the same to this handler.
        // TODO: handle req.on('close') to abort the in-flight LLM run.
        const responder = streamableResponse(req, res);
        try {
          responder.send({ type: 'start', stage: 'parsing-cv' });
          const cvFilePath = `${CV_BASENAME}.${format}`;
          await writeFile(cvFilePath, buf);
          const cvText = await parseCvBuffer(buf, format);
          if (!cvText.trim()) {
            responder.fail('parsed CV is empty', 400);
            return;
          }
          responder.send({ type: 'stage', stage: 'calling-llm' });
          const raw = await runLlm(
            buildCvSummaryPrompt(cvText),
            undefined,
            responder.isStreaming
              ? (chunk) => responder.send({ type: 'chunk', data: chunk })
              : undefined,
          );
          const cleaned = stripFences(raw);
          if (!cleaned) {
            responder.fail('LLM returned empty output', 502);
            return;
          }
          await writeBriefBody(cleaned);
          responder.finish({ body: cleaned });
        } catch (err) {
          console.error('[cv api]', err);
          responder.fail(err instanceof Error ? err.message : String(err), 500);
        }
      });
    },
  };
}
