import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OLLAMA_MODEL,
  estimateOllamaNumCtx,
  isLikelyEmbedModel,
  listOllamaModels,
  resolveOllamaModel,
  runLlm,
  runOllama,
  warnIfPromptTruncated,
} from '../src/lib/llm.js';

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
    delete process.env.PUPILA_OLLAMA_NUM_CTX;
  });

  it('posts to /api/generate with think:false, num_ctx, and returns response text', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({
        model: DEFAULT_OLLAMA_MODEL,
        response: 'OK',
        done: true,
        prompt_eval_count: 10,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const prompt = 'Reply with OK';
    const out = await runLlm(prompt, 'ollama');
    expect(out).toBe('OK');

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    expect(call).toBeDefined();
    if (!call) throw new Error('expected fetch call');
    const [url, init] = call;
    expect(String(url)).toBe('http://127.0.0.1:11434/api/generate');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      prompt: string;
      stream: boolean;
      think: boolean;
      options: { num_ctx: number };
    };
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.prompt).toBe(prompt);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options.num_ctx).toBe(estimateOllamaNumCtx(prompt));
  });

  it('honours PUPILA_OLLAMA_NUM_CTX over the estimate', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    process.env.PUPILA_OLLAMA_NUM_CTX = '16384';
    const fetchMock = vi.fn(async () =>
      Response.json({ model: DEFAULT_OLLAMA_MODEL, response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('hi', 'ollama');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const body = JSON.parse(String(call?.[1]?.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(16384);
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
    const body = JSON.parse(String(call?.[1]?.body)) as { model: string };
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
    const body = JSON.parse(String(call?.[1]?.body)) as { model: string };
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

  it('aborts when the caller signal fires', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );

    const pending = runOllama('hi', undefined, DEFAULT_OLLAMA_MODEL, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('warnIfPromptTruncated', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn when the prompt fits in num_ctx (short review prompts)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Typical ai-review: ~900 eval tokens, estimate ~1000, window floor 8192.
    warnIfPromptTruncated(1000, 887, 8192);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when estimate exceeds num_ctx and eval count is far below', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfPromptTruncated(6000, 2048, 4096);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('truncated');
  });
});

describe('resolveOllamaModel', () => {
  afterEach(() => {
    delete process.env.PUPILA_LLM_MODEL;
  });

  it('throws when neither preferred nor env is set (no alphabetical fallback)', async () => {
    await expect(resolveOllamaModel(undefined)).rejects.toThrow(/No Ollama model selected/);
    await expect(resolveOllamaModel('')).rejects.toThrow(/No Ollama model selected/);
  });

  it('returns the preferred model before env', async () => {
    process.env.PUPILA_LLM_MODEL = 'from-env';
    expect(await resolveOllamaModel('from-arg')).toBe('from-arg');
  });
});

describe('listOllamaModels — embed filter', () => {
  const originalPath = process.env.PATH;

  beforeAll(() => {
    const bin = mkdtempSync(join(tmpdir(), 'pupila-ollama-tags-'));
    const stub = join(bin, 'ollama');
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('omits embedding-only model names', async () => {
    expect(isLikelyEmbedModel('all-minilm')).toBe(true);
    expect(isLikelyEmbedModel('nomic-embed-text')).toBe(true);
    expect(isLikelyEmbedModel('qwen3:14b')).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          models: [
            { name: 'all-minilm:latest' },
            { name: 'qwen3:14b' },
            { name: 'nomic-embed-text' },
            { name: 'gemma2:9b' },
          ],
        }),
      ),
    );

    const names = await listOllamaModels();
    expect(names).toEqual(['gemma2:9b', 'qwen3:14b']);
  });
});
