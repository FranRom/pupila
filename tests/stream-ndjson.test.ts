import { describe, expect, it, vi } from 'vitest';
import { type StreamEvent, streamNdjson } from '../src/lib/stream-ndjson.js';

function bodyFrom(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });
}

function bodyFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

describe('streamNdjson', () => {
  it('resolves with the final done event when the stream completes cleanly', async () => {
    const lines =
      `${JSON.stringify({ type: 'start', stage: 'parsing-cv' })}\n` +
      `${JSON.stringify({ type: 'chunk', data: 'hello ' })}\n` +
      `${JSON.stringify({ type: 'chunk', data: 'world' })}\n` +
      `${JSON.stringify({ type: 'done', body: 'hello world' })}\n`;
    const events: StreamEvent[] = [];
    const done = await streamNdjson<{ body: string }>(
      '/api/whatever',
      { ok: true },
      (e) => events.push(e),
      { fetchImpl: mockFetch(bodyFrom(lines)) },
    );
    expect(done.body).toBe('hello world');
    expect(events.map((e) => e.type)).toEqual(['start', 'chunk', 'chunk', 'done']);
  });

  it('rejects with the error message when an error event arrives', async () => {
    const lines =
      `${JSON.stringify({ type: 'chunk', data: 'partial' })}\n` +
      `${JSON.stringify({ type: 'error', error: 'LLM CLI killed by SIGTERM' })}\n`;
    const events: StreamEvent[] = [];
    await expect(
      streamNdjson('/api/whatever', {}, (e) => events.push(e), {
        fetchImpl: mockFetch(bodyFrom(lines)),
      }),
    ).rejects.toThrow(/SIGTERM/);
    expect(events.find((e) => e.type === 'chunk')).toBeDefined();
  });

  it('skips malformed lines and continues parsing the rest', async () => {
    const lines =
      `${JSON.stringify({ type: 'chunk', data: 'a' })}\n` +
      `not-json-at-all\n` +
      `${JSON.stringify({ type: 'chunk', data: 'b' })}\n` +
      `${JSON.stringify({ type: 'done', body: 'ab' })}\n`;
    const events: StreamEvent[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const done = await streamNdjson<{ body: string }>('/api/whatever', {}, (e) => events.push(e), {
      fetchImpl: mockFetch(bodyFrom(lines)),
    });
    expect(done.body).toBe('ab');
    expect(events.filter((e) => e.type === 'chunk')).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('buffers a JSON object split across multiple network chunks', async () => {
    // Single event split across 3 reads — the line buffer must reassemble it.
    const event = JSON.stringify({ type: 'done', body: 'whole-event' });
    const events: StreamEvent[] = [];
    const done = await streamNdjson<{ body: string }>('/api/whatever', {}, (e) => events.push(e), {
      fetchImpl: mockFetch(
        bodyFromChunks([event.slice(0, 5), event.slice(5, 20), `${event.slice(20)}\n`]),
      ),
    });
    expect(done.body).toBe('whole-event');
    expect(events).toHaveLength(1);
  });

  it('rejects with a synthesized error when the stream ends without done or error', async () => {
    const lines = `${JSON.stringify({ type: 'chunk', data: 'orphan' })}\n`;
    await expect(
      streamNdjson('/api/whatever', {}, () => {}, {
        fetchImpl: mockFetch(bodyFrom(lines)),
      }),
    ).rejects.toThrow(/stream ended/i);
  });

  it('rejects when the response is non-OK before streaming begins', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: 'bad input' }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(streamNdjson('/api/whatever', {}, () => {}, { fetchImpl })).rejects.toThrow(
      /bad input|400/,
    );
  });
});
