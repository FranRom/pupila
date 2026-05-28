import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { type BriefSource, buildBriefPrompt } from '../../src/lib/brief-prompt.js';
import { readBriefBody, writeBriefBody } from '../../src/lib/brief-template.js';
import { type CvFormat, parseCvBuffer } from '../../src/lib/cv-parser.js';
import { runLlm } from '../../src/lib/llm.js';
import { stripFences } from '../../src/lib/profile-generator.js';
import { streamableResponse } from '../../src/lib/streamable-response.js';
import { CV_BASENAME } from './_paths.ts';
import { CV_MAX_CHARS, readBody, VALID_CV_FORMATS, VALID_CV_SOURCES } from './_shared.ts';

interface BriefGetResponse {
  body: string | null;
}

interface BriefPostBody {
  markdown?: unknown;
}

interface CvPostBody {
  format?: unknown;
  data?: unknown;
  // 'cv' (default) or 'linkedin'. LinkedIn = a profile exported via
  // "Save to PDF"; only changes the LLM prompt framing (see brief-prompt.ts).
  source?: unknown;
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
        let source: BriefSource;
        let buf: Buffer;
        try {
          const body = (await readBody(req)) as CvPostBody;
          const rawFormat = typeof body.format === 'string' ? (body.format as CvFormat) : null;
          const data = typeof body.data === 'string' ? body.data : '';
          // Default to 'cv' when omitted so existing callers keep working.
          const rawSource = typeof body.source === 'string' ? body.source : 'cv';
          if (!rawFormat || !VALID_CV_FORMATS.has(rawFormat)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid format (pdf/docx/md/txt)' }));
            return;
          }
          if (!VALID_CV_SOURCES.has(rawSource)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid source (cv/linkedin)' }));
            return;
          }
          if (!data) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'empty data' }));
            return;
          }
          format = rawFormat;
          source = rawSource as BriefSource;
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
            buildBriefPrompt(cvText, source, CV_MAX_CHARS),
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
