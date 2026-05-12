import type { IncomingMessage, ServerResponse } from 'node:http';

// Dual-mode HTTP responder for endpoints that can either stream NDJSON
// events or return a single JSON payload. Content negotiation is driven by
// the `Accept` header: `application/x-ndjson` opts into streaming, anything
// else gets buffered JSON.
//
// The same handler code calls `send()` (no-op in JSON mode) and `finish()`
// (emits the `done` event in NDJSON mode, sends the full JSON response in
// JSON mode). This way an endpoint's success path looks identical in both
// modes — only the wire format differs.

const NDJSON_MIME = 'application/x-ndjson';

export interface StreamableResponse {
  isStreaming: boolean;
  /** Emit an intermediate event (start/stage/chunk). No-op in JSON mode. */
  send(event: Record<string, unknown>): void;
  /**
   * Terminate the response with a success payload. In NDJSON mode this is
   * emitted as `{"type":"done", ...payload}`. In JSON mode it becomes
   * `{ok: true, ...payload}` (200 OK).
   */
  finish(payload?: Record<string, unknown>): void;
  /**
   * Terminate the response with an error. In NDJSON mode this emits
   * `{"type":"error","error":message}`. In JSON mode it sends a JSON
   * `{error: message}` body with the given status code (default 500).
   */
  fail(message: string, jsonStatus?: number): void;
}

function wantsNdjson(req: IncomingMessage): boolean {
  return (req.headers.accept ?? '').includes(NDJSON_MIME);
}

export function streamableResponse(req: IncomingMessage, res: ServerResponse): StreamableResponse {
  if (!wantsNdjson(req)) {
    return {
      isStreaming: false,
      send() {
        // intermediate events are dropped in JSON mode
      },
      finish(payload = {}) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, ...payload }));
      },
      fail(message, jsonStatus = 500) {
        res.statusCode = jsonStatus;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: message }));
      },
    };
  }
  res.setHeader('Content-Type', NDJSON_MIME);
  res.setHeader('Cache-Control', 'no-cache');
  // Vite's dev middleware sits behind a proxy in some setups; disable
  // upstream buffering so the browser sees tokens as they're emitted.
  res.setHeader('X-Accel-Buffering', 'no');
  const write = (event: Record<string, unknown>): void => {
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      // client disconnected — silently drop. The LLM run keeps going;
      // nothing is reading the result anymore.
    }
  };
  return {
    isStreaming: true,
    send: write,
    finish(payload = {}) {
      write({ type: 'done', ...payload });
      res.end();
    },
    fail(message) {
      write({ type: 'error', error: message });
      res.end();
    },
  };
}
