export type StreamEvent =
  | { type: 'start'; stage: string }
  | { type: 'stage'; stage: string }
  | { type: 'chunk'; data: string }
  | { type: 'done'; [k: string]: unknown }
  | { type: 'error'; error: string };

interface StreamOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * POST to an NDJSON-streaming endpoint and dispatch each parsed event to
 * `onEvent` as it arrives. Resolves with the terminal `done` event payload;
 * rejects with the `error` event message (or a synthesized error if the
 * stream ends without either).
 *
 * Malformed lines are logged to console and skipped — a corrupt line never
 * kills the whole stream.
 */
export async function streamNdjson<TDone extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  opts: StreamOptions = {},
): Promise<TDone> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (text) message = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    }
    throw new Error(message);
  }
  if (!res.body) {
    throw new Error('stream ended: response had no body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: TDone | null = null;
  let errored: string | null = null;
  try {
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard line-buffer pattern
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(line) as StreamEvent;
        } catch {
          console.warn('[streamNdjson] dropped malformed line:', line.slice(0, 120));
          continue;
        }
        onEvent(event);
        if (event.type === 'done') {
          done = event as unknown as TDone;
        } else if (event.type === 'error') {
          errored = event.error;
        }
      }
      if (streamDone) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (errored !== null) throw new Error(errored);
  if (done) return done;
  throw new Error('stream ended without a done or error event');
}
