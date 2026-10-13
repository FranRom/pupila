import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OLLAMA_MODEL,
  detectLlmCli,
  estimateOllamaNumCtx,
  isLikelyEmbedModel,
  isLoopbackOllamaHost,
  listOllamaModels,
  ollamaAvailable,
  resolveOllamaModel,
  runLlm,
  runOllama,
  warnIfPromptTruncated,
} from '../src/lib/llm.js';

// detectLlmCli requires `ollama` on PATH. One no-op stub for the whole file
// so CI machines without a real Ollama install still cover the HTTP path;
// PATH is restored and the dir removed once the file is done.
const originalPath = process.env.PATH;
const stubBin = mkdtempSync(join(tmpdir(), 'pupila-ollama-'));
const stubbedPath = `${stubBin}:${originalPath ?? ''}`;

beforeAll(() => {
  const stub = join(stubBin, 'ollama');
  writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);
  process.env.PATH = stubbedPath;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(stubBin, { recursive: true, force: true });
});

describe('runLlm — ollama provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUPILA_LLM_MODEL;
    delete process.env.PUPILA_OLLAMA_NUM_CTX;
    delete process.env.PUPILA_LLM_TIMEOUT_MS;
    process.env.PATH = stubbedPath;
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

  it('clamps an auto-sized num_ctx to 32768 and warns', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json({ model: DEFAULT_OLLAMA_MODEL, response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('x'.repeat(1_000_000), 'ollama');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const body = JSON.parse(String(call?.[1]?.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(32768);
    expect(String(warn.mock.calls[0]?.[0])).toContain('clamping');
  });

  it('honours an explicit PUPILA_OLLAMA_NUM_CTX above the cap, with a warning', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    process.env.PUPILA_OLLAMA_NUM_CTX = '65536';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json({ model: DEFAULT_OLLAMA_MODEL, response: 'hi', done: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await runLlm('hi', 'ollama');
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined] | undefined;
    const body = JSON.parse(String(call?.[1]?.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(65536);
    expect(String(warn.mock.calls[0]?.[0])).toContain('honouring');
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

  it('keeps the final NDJSON line when the stream ends without a newline', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ response: 'Hel' })}\n`));
        controller.enqueue(encoder.encode(JSON.stringify({ response: 'lo', done: true })));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    const out = await runLlm('hi', 'ollama', () => {});
    expect(out).toBe('Hello');
  });

  it('cancels the stream reader when a chunk carries an error', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ error: 'model crashed' })}\n`));
        // left open: a leaked reader would keep this connection half-read
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    await expect(runLlm('hi', 'ollama', () => {})).rejects.toThrow(/ollama error: model crashed/);
    expect(cancelled).toBe(true);
  });

  it('rejects a non-streaming response that reports done=false', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ response: 'partial', done: false })),
    );
    await expect(runLlm('hi', 'ollama')).rejects.toThrow(/incomplete response/);
  });

  it('reports an unreadable non-streaming body with the model name', async () => {
    process.env.PUPILA_LLM_MODEL = DEFAULT_OLLAMA_MODEL;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );
    await expect(runLlm('hi', 'ollama')).rejects.toThrow(/unreadable response.*qwen3:14b/);
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

  // (estimate, prompt_eval_count, num_ctx) triples measured against a real
  // Ollama 0.35.0 daemon. On overflow Ollama keeps ~half the window (W/2 + keep).

  it('warns when the prompt overflows the num_ctx we requested', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // qwen3:0.6b, 16KB prompt, num_ctx 2048 → daemon kept 1026 tokens.
    warnIfPromptTruncated(4580, 1026, 2048);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('truncated');
  });

  it("warns when Ollama clamps to the model's smaller trained window", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // smollm2:135m (trained 8192), num_ctx 16384 requested → kept 4098.
    warnIfPromptTruncated(12937, 4098, 16384);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('warns at a half window even when a dense tokenizer keeps the ratio above 0.5', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Tokenizer ~1.05 real/est: a 8192 window keeps 4098 of an est≈7800 prompt.
    warnIfPromptTruncated(7800, 4098, 8192);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not warn on healthy prompts measured live', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfPromptTruncated(5273, 3675, 8192); // qwen3:0.6b, brief-style prompt
    warnIfPromptTruncated(4580, 4810, 16384); // smollm2:135m, denser tokenizer
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when a healthy prompt lands just above a power of two', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 2050 sits 2 above 4096/2, but the ratio (0.73) is normal estimate noise.
    warnIfPromptTruncated(2800, 2050, 8192);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn on real ai-review chars-per-token variance (regression: pnpm run daily spam)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Exact (estimate, prompt_eval_count) pairs captured from a live `pnpm run
    // ai-review` run against a real Ollama daemon: none are truncated, they
    // just have a real chars-per-token ratio (~4.5-4.7) higher than the 3.5
    // assumed by estimatePromptTokens. A 0.85 ratio check fired on every one.
    warnIfPromptTruncated(1797, 1346, 8192);
    warnIfPromptTruncated(1809, 1381, 8192);
    warnIfPromptTruncated(1798, 1409, 8192);
    warnIfPromptTruncated(1335, 1034, 8192);
    warnIfPromptTruncated(1812, 1399, 8192);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveOllamaModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PUPILA_LLM_MODEL;
    process.env.PATH = stubbedPath;
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.PATH = stubbedPath;
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

describe('remote Ollama daemon (no local binary)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OLLAMA_HOST;
    process.env.PATH = stubbedPath;
  });

  it('counts a daemon answering at OLLAMA_HOST as available', async () => {
    // System dirs only: no `ollama` binary, but `sh` for commandExists.
    process.env.PATH = '/usr/bin:/bin';
    process.env.OLLAMA_HOST = 'http://gpu-box.lan:11434';
    const fetchMock = vi.fn(async (_input: unknown) =>
      Response.json({ models: [{ name: 'qwen3:14b' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await ollamaAvailable()).toBe(true);
    expect((await detectLlmCli('ollama')).provider).toBe('ollama');
    expect(await listOllamaModels()).toEqual(['qwen3:14b']);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gpu-box.lan:11434/api/tags');
  });

  it('is unavailable when neither the binary nor a daemon is there', async () => {
    process.env.PATH = '/usr/bin:/bin';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await ollamaAvailable()).toBe(false);
    await expect(detectLlmCli('ollama')).rejects.toThrow(/nor a daemon answers/);
  });

  it('classifies loopback vs remote hosts', () => {
    expect(isLoopbackOllamaHost('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackOllamaHost('http://localhost:11434')).toBe(true);
    expect(isLoopbackOllamaHost('http://[::1]:11434')).toBe(true);
    expect(isLoopbackOllamaHost('http://192.168.1.20:11434')).toBe(false);
    expect(isLoopbackOllamaHost('https://ollama.example.com')).toBe(false);
  });
});
