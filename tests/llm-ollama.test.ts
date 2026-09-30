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

function stubOllamaOnPath(prefix: string): void {
  const bin = mkdtempSync(join(tmpdir(), prefix));
  const stub = join(bin, 'ollama');
  writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);
  process.env.PATH = `${bin}:${process.env.PATH ?? ''}`;
}

describe('runLlm — ollama provider', () => {
  const originalPath = process.env.PATH;

  beforeAll(() => {
    // detectLlmCli requires `ollama` on PATH. Drop a no-op stub so CI
    // machines without a real Ollama install still cover the HTTP path.
    stubOllamaOnPath('pupila-ollama-');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUPILA_LLM_MODEL;
    delete process.env.PUPILA_OLLAMA_NUM_CTX;
    delete process.env.PUPILA_LLM_TIMEOUT_MS;
    process.env.PATH = originalPath;
    stubOllamaOnPath('pupila-ollama-');
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

  it('clamps num_ctx to 32768 and warns', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    process.env.PUPILA_OLLAMA_NUM_CTX = '999999';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json({ model: DEFAULT_OLLAMA_MODEL, response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('hi', 'ollama');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const body = JSON.parse(String(call?.[1]?.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(32768);
    expect(String(warn.mock.calls[0]?.[0])).toContain('clamping');
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

  it('names ollama + model + PUPILA_LLM_TIMEOUT_MS on timeout', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    process.env.PUPILA_LLM_TIMEOUT_MS = '50';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () =>
              reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
            { once: true },
          );
        });
      }),
    );

    await expect(runOllama('hi', undefined, DEFAULT_OLLAMA_MODEL)).rejects.toThrow(
      /ollama timed out.*qwen3:14b.*PUPILA_LLM_TIMEOUT_MS/,
    );
  });
});

describe('warnIfPromptTruncated', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn for short prompts within tokenizer skew', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Typical ai-review: ~900 eval tokens, estimate ~1000.
    warnIfPromptTruncated(1000, 887);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when eval count lands exactly on a known context-window boundary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfPromptTruncated(6000, 2048);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('truncated');
  });

  it('warns on the maintainer repro shape (model clamp at 4096)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 20KB prompt est≈5715, model capped at 4096 → silent under the old num_ctx guard.
    warnIfPromptTruncated(5715, 4096);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('warns on severe truncation even without an exact power-of-two match', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A model with a non-power-of-two window clamping to well under half the estimate.
    warnIfPromptTruncated(6000, 2500);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not warn on real ai-review chars-per-token variance (regression: pnpm run daily spam)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Exact (estimate, prompt_eval_count) pairs captured from a live `pnpm run
    // ai-review` run against a real Ollama daemon — none of these are
    // truncated, they just have a real chars-per-token ratio (~4.5-4.7) higher
    // than the 3.5 assumed by estimatePromptTokens. A naive ratio check
    // (evalCount < estimate * 0.85) fired on every single one of these.
    warnIfPromptTruncated(1797, 1346);
    warnIfPromptTruncated(1809, 1381);
    warnIfPromptTruncated(1798, 1409);
    warnIfPromptTruncated(1335, 1034);
    warnIfPromptTruncated(1812, 1399);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveOllamaModel', () => {
  const originalPath = process.env.PATH;

  beforeAll(() => {
    stubOllamaOnPath('pupila-ollama-resolve-');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUPILA_LLM_MODEL;
    process.env.PATH = originalPath;
    stubOllamaOnPath('pupila-ollama-resolve-');
  });

  it('throws when neither preferred nor env is set and tags are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ models: [] })),
    );
    await expect(resolveOllamaModel(undefined)).rejects.toThrow(/No Ollama model selected/);
    await expect(resolveOllamaModel('')).rejects.toThrow(/No Ollama model selected/);
  });

  it('throws when multiple tags are pulled and nothing is selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ models: [{ name: 'qwen3:14b' }, { name: 'gemma2:9b' }] })),
    );
    await expect(resolveOllamaModel(undefined)).rejects.toThrow(/No Ollama model selected/);
  });

  it('uses the sole pulled model with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ models: [{ name: 'gemma2:9b' }] })),
    );
    expect(await resolveOllamaModel(undefined)).toBe('gemma2:9b');
    expect(String(warn.mock.calls[0]?.[0])).toContain('gemma2:9b');
  });

  it('returns the preferred model before env', async () => {
    process.env.PUPILA_LLM_MODEL = 'from-env';
    expect(await resolveOllamaModel('from-arg')).toBe('from-arg');
  });
});

describe('listOllamaModels — embed filter', () => {
  const originalPath = process.env.PATH;

  beforeAll(() => {
    stubOllamaOnPath('pupila-ollama-tags-');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.PATH = originalPath;
    stubOllamaOnPath('pupila-ollama-tags-');
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
