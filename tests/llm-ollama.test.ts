import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OLLAMA_MODEL, runLlm } from '../src/lib/llm.js';

describe('runLlm — ollama provider', () => {
  const originalPath = process.env.PATH;

  beforeAll(() => {
    // detectLlmCli requires `ollama` on PATH. Drop a no-op stub so CI
    // machines without a real Ollama install still cover the HTTP path.
    const bin = mkdtempSync(join(tmpdir(), 'pupila-ollama-'));
    const stub = join(bin, 'ollama');
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUPILA_LLM_MODEL;
  });

  it('posts to /api/generate with think:false and returns response text', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({
        model: DEFAULT_OLLAMA_MODEL,
        response: 'OK',
        done: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await runLlm('Reply with OK', 'ollama');
    expect(out).toBe('OK');

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(String(url)).toBe('http://127.0.0.1:11434/api/generate');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      prompt: string;
      stream: boolean;
      think: boolean;
    };
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.prompt).toBe('Reply with OK');
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
  });

  it('honours PUPILA_LLM_MODEL', async () => {
    process.env.PUPILA_LLM_MODEL = 'gemma4:latest';
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({ model: 'gemma4:latest', response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('hi', 'ollama');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]?.body)) as { model: string };
    expect(body.model).toBe('gemma4:latest');
  });

  it('honours an explicit model argument over the env default', async () => {
    process.env.PUPILA_LLM_MODEL = 'gemma4:latest';
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({ model: 'qwen3:14b', response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('hi', 'ollama', undefined, 'qwen3:14b');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const body = JSON.parse(String(call![1]?.body)) as { model: string };
    expect(body.model).toBe('qwen3:14b');
  });

  it('streams NDJSON chunks through onChunk', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ response: 'Hel' })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({ response: 'lo', done: true })}\n`));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    const chunks: string[] = [];
    const out = await runLlm('hi', 'ollama', (c) => chunks.push(c));
    expect(out).toBe('Hello');
    expect(chunks).toEqual(['Hel', 'lo']);
  });
});
