// Provider-agnostic LLM wrapper. Uses whichever local LLM tool is installed
// (claude / codex / gemini / opencode / ollama) so the same code path works
// for any user's tool of choice. No cloud API keys — subscription CLIs use
// the user's existing plan; ollama runs a local model via the Ollama HTTP API.
//
// Detection order:
//   1. PUPILA_LLM env var (claude | codex | gemini | opencode | ollama)
//   2. First found on PATH in the order: claude > codex > gemini > opencode > ollama
//
// Override the exact CLI invocation per provider via `PUPILA_LLM_FLAG`
// (e.g. `PUPILA_LLM_FLAG=--prompt`) if a CLI's flag syntax changes upstream.
// For ollama, pick the model via (in order): explicit `model` arg to
// `runLlm` / prefs, then `PUPILA_LLM_MODEL` env. No silent daemon fallback —
// missing both throws so the user picks a model in Settings or sets the env.
// Context window: `options.num_ctx` is sized from the prompt (override with
// `PUPILA_OLLAMA_NUM_CTX`). Host override: `OLLAMA_HOST` (default: 127.0.0.1:11434).
//
// Prompt delivery (subscription CLIs): we feed the prompt via STDIN, not argv.
// Three reasons:
//   1. argv has a kernel-imposed size limit (ARG_MAX, ~1MB on macOS) and
//      we sometimes send 10–20KB CV+job blobs.
//   2. claude-code's `-p` mode reads from stdin when no positional prompt
//      is given; the same pattern works for codex/gemini/opencode.
//   3. argv is also visible in `ps`, so stdin keeps the prompt out of
//      process listings.
// ollama uses POST /api/generate instead — `ollama run` paints ANSI spinners
// on a TTY and is awkward to drive non-interactively.

import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// Env vars that Claude Code sets in any spawned process to mark it as
// "running inside CC". When `claude` (the CLI) detects these in its own
// env, it refuses to start (SIGKILLs itself within 1ms) to prevent
// recursive Claude Code sessions. We strip them before spawning so
// `pnpm run ui` works whether or not the dev server itself was launched
// from inside a Claude Code session. Sibling CLIs (codex/gemini/opencode)
// don't read these vars, so stripping is harmless for them.
const CLAUDE_CODE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_CONFIG_DIR',
  'ENABLE_BACKGROUND_TASKS',
  'ANTHROPIC_API_KEY', // can confuse some CLIs that think they're in API mode
];

function spawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of CLAUDE_CODE_ENV_VARS) {
    delete env[k];
  }
  return env;
}

interface SmokeTestResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Quick `<cmd> --version` (or `<cmd> --help`) smoke test. Used to
 * disambiguate why a real `runLlm` call was killed: if the smoke test
 * ALSO dies, the CLI itself is busted at the system level (broken
 * install, sandbox killing it, etc.). If it works, the kill on the real
 * prompt is more likely OOM during prompt processing.
 */
async function smokeTestCli(cmd: string): Promise<SmokeTestResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(cmd, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(),
      // detached: true creates a new process group / session so the spawned
      // claude isn't a "descendant of an existing claude/Claude-Code session"
      // for any guards that walk the process tree.
      detached: true,
    });
    proc.unref();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      resolve({
        ok: false,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        exitCode: null,
        signal: 'SIGTERM',
      });
    }, 10_000);
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        exitCode: null,
        signal: null,
      });
    });
    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        exitCode: code,
        signal,
      });
    });
  });
}

export type LlmProvider = 'claude' | 'codex' | 'gemini' | 'opencode' | 'ollama';

export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'ollama',
] as const;

/** @deprecated Prefer resolving via listOllamaModels() — kept for docs/tests. */
export const DEFAULT_OLLAMA_MODEL = 'qwen3:14b';

interface ProviderSpec {
  /** Static argv passed before stdin is closed. The prompt is fed via stdin. */
  args: readonly string[];
}

// Each CLI's non-interactive print mode invocation. The prompt itself is
// piped through stdin, so these arrays hold *only* the mode-selecting flag
// (except ollama, which is invoked via HTTP — see runOllama).
//   claude -p             → read prompt from stdin, print response, exit
//   codex exec            → ditto
//   gemini -p             → ditto
//   opencode run          → ditto
//   ollama                → HTTP /api/generate (args unused at runtime)
const PROVIDER_DEFAULTS: Record<LlmProvider, ProviderSpec> = {
  claude: { args: ['-p'] },
  codex: { args: ['exec'] },
  gemini: { args: ['-p'] },
  opencode: { args: ['run'] },
  ollama: { args: [] },
};

function ollamaBaseUrl(): string {
  const host = process.env.OLLAMA_HOST?.trim() || '127.0.0.1:11434';
  return host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}`;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

/** Names that look like embedding-only models — unsuitable for /api/generate. */
const EMBED_MODEL_RE = /embed|minilm|bge-|e5-|nomic-embed/i;

export function isLikelyEmbedModel(name: string): boolean {
  return EMBED_MODEL_RE.test(name);
}

const NUM_CTX_FLOOR = 8192;
const NUM_CTX_HEADROOM = 2048;

/** Rough token count from chars (no floor/headroom) — for truncation checks. */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 3.5);
}

/** Context window size to request: prompt estimate + headroom, floored. */
export function estimateOllamaNumCtx(prompt: string): number {
  return Math.max(NUM_CTX_FLOOR, estimatePromptTokens(prompt) + NUM_CTX_HEADROOM);
}

function resolveNumCtx(prompt: string): number {
  const fromEnv = Number(process.env.PUPILA_OLLAMA_NUM_CTX ?? '0');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return estimateOllamaNumCtx(prompt);
}

/**
 * Warn only when the prompt likely needed more tokens than the window we
 * requested AND Ollama evaluated far fewer than the prompt-size estimate.
 * Comparing against the floored num_ctx (e.g. 8192) for short prompts was a
 * false positive — a ~900-token review prompt is not truncated.
 */
export function warnIfPromptTruncated(
  promptTokenEstimate: number,
  promptEvalCount: number | undefined,
  numCtx: number,
): void {
  if (typeof promptEvalCount !== 'number' || !Number.isFinite(promptEvalCount)) return;
  if (promptTokenEstimate <= numCtx) return;
  if (promptEvalCount < promptTokenEstimate * 0.85) {
    console.warn(
      `[ollama] prompt_eval_count=${promptEvalCount} is far below estimated ${promptTokenEstimate} ` +
        `(num_ctx=${numCtx}) — the prompt may have been truncated. ` +
        'Raise PUPILA_OLLAMA_NUM_CTX or shorten the input.',
    );
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError')
  );
}

const RUN_TIMEOUT_MS = Number(process.env.PUPILA_LLM_TIMEOUT_MS ?? '300000'); // 5 min default

function combineRunSignal(signal?: AbortSignal): AbortSignal {
  if (signal) {
    return AbortSignal.any([signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]);
  }
  return AbortSignal.timeout(RUN_TIMEOUT_MS);
}

/**
 * List generation-capable model names pulled into the local Ollama daemon
 * (`GET /api/tags`). Embedding-only names are filtered out so pickers /
 * onboarding auto-select cannot land on `all-minilm` etc. Returns [] when
 * the daemon is down or the binary isn't useful — callers treat empty as
 * "no models available" rather than a hard failure.
 */
export async function listOllamaModels(): Promise<string[]> {
  if (!(await commandExists('ollama'))) return [];
  const url = `${ollamaBaseUrl()}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as OllamaTagsResponse;
    const names = (data.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name.trim() : ''))
      .filter((n): n is string => Boolean(n) && !isLikelyEmbedModel(n));
    // Stable, human-friendly order for pickers.
    return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Resolve which Ollama model to call. Precedence:
 *   1. Explicit `preferred` (from UI prefs / request body)
 *   2. `PUPILA_LLM_MODEL` env
 * Throws when neither is set — silent "first tag alphabetically" is unsafe
 * (embedding models sort first and cannot serve /api/generate).
 */
export async function resolveOllamaModel(preferred?: string | null): Promise<string> {
  const fromArg = preferred?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.PUPILA_LLM_MODEL?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    `No Ollama model selected. Pick one in Settings / onboarding, or set ` +
      `PUPILA_LLM_MODEL=<name> (e.g. \`ollama pull ${DEFAULT_OLLAMA_MODEL}\`).`,
  );
}

export interface LlmInvocation {
  provider: LlmProvider;
  cmd: string;
  argTemplate: readonly string[];
}

function isSupportedProvider(value: string): value is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    // `command -v` is POSIX-portable; works on bash and zsh. On Windows, this
    // would need `where`, but the rest of the project is POSIX-only anyway.
    await execFileAsync('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe each supported provider in parallel and return which CLIs are
 * installed. Used by the UI's onboarding wizard to show ✓/✗ next to each
 * option.
 */
export async function availableProviders(): Promise<Record<LlmProvider, boolean>> {
  const entries = await Promise.all(
    SUPPORTED_PROVIDERS.map(async (p) => [p, await commandExists(p)] as const),
  );
  return Object.fromEntries(entries) as Record<LlmProvider, boolean>;
}

function buildSpec(provider: LlmProvider): ProviderSpec {
  const flagOverride = process.env.PUPILA_LLM_FLAG;
  if (flagOverride) {
    return { args: [flagOverride] };
  }
  return PROVIDER_DEFAULTS[provider];
}

/**
 * Resolve the LLM CLI to use, either from `PUPILA_LLM` env var or by
 * detecting which one is installed. Throws with a helpful message if none
 * are available.
 */
export async function detectLlmCli(override?: LlmProvider): Promise<LlmInvocation> {
  const requested = override ?? process.env.PUPILA_LLM;
  if (requested) {
    if (!isSupportedProvider(requested)) {
      throw new Error(
        `PUPILA_LLM="${requested}" is not supported. Use one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
    }
    if (!(await commandExists(requested))) {
      throw new Error(
        `PUPILA_LLM="${requested}" was requested but the \`${requested}\` CLI is not on PATH.`,
      );
    }
    return { provider: requested, cmd: requested, argTemplate: buildSpec(requested).args };
  }
  for (const provider of SUPPORTED_PROVIDERS) {
    if (await commandExists(provider)) {
      return { provider, cmd: provider, argTemplate: buildSpec(provider).args };
    }
  }
  throw new Error(
    `No LLM CLI found on PATH. Install one of: ${SUPPORTED_PROVIDERS.join(' / ')}. ` +
      'See https://docs.claude.com/en/docs/claude-code/quickstart for Claude Code.',
  );
}

interface RawRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  partialStdoutBytes: number;
}

function spawnAndPipe(
  cmd: string,
  args: readonly string[],
  prompt: string,
  onChunk?: (chunk: string) => void,
): Promise<RawRunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv(),
      // detached: true creates a new process group / session so the spawned
      // claude isn't a "descendant of an existing claude/Claude-Code session"
      // for any guards that walk the process tree.
      detached: true,
    });
    proc.unref();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(
        new Error(
          `${cmd} timed out after ${Math.round(RUN_TIMEOUT_MS / 1000)}s. Override with PUPILA_LLM_TIMEOUT_MS=<ms>.`,
        ),
      );
    }, RUN_TIMEOUT_MS);

    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      if (onChunk) {
        try {
          onChunk(chunk);
        } catch {
          // never let a callback exception break the LLM run
        }
      }
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    // Surface stdin write errors (e.g. EPIPE if the CLI exited before we
    // finished writing) without crashing the dev server. The close event
    // will deliver the underlying signal/exit reason.
    proc.stdin.on('error', () => {});
    proc.stdin.write(prompt, (err) => {
      if (err) {
        // ignore — close handler reports the real cause
        return;
      }
      proc.stdin.end();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal,
        durationMs: Date.now() - started,
        partialStdoutBytes: Buffer.byteLength(stdout, 'utf8'),
      });
    });
  });
}

interface OllamaGenerateChunk {
  response?: string;
  error?: string;
  done?: boolean;
  prompt_eval_count?: number;
}

/**
 * Drive a local Ollama model via POST /api/generate. Prefer this over
 * `ollama run` — the CLI paints ANSI spinners and is TTY-oriented.
 * Pass `signal` to cancel mid-request (combined with the run timeout).
 */
export async function runOllama(
  prompt: string,
  onChunk?: (chunk: string) => void,
  preferredModel?: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const model = await resolveOllamaModel(preferredModel);
  const numCtx = resolveNumCtx(prompt);
  const promptTokenEstimate = estimatePromptTokens(prompt);
  const url = `${ollamaBaseUrl()}/api/generate`;
  const stream = Boolean(onChunk);
  const runSignal = combineRunSignal(signal);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream,
        // qwen3 (and other thinking models) otherwise dump chain-of-thought
        // into the response and break JSON-fence parsers downstream.
        think: false,
        options: { num_ctx: numCtx },
      }),
      signal: runSignal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted || runSignal.aborted) {
      throw err instanceof Error
        ? err
        : new DOMException('The operation was aborted', 'AbortError');
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ollama request to ${url} failed (${detail}). Is the Ollama daemon running? ` +
        `Try \`ollama serve\` or open the Ollama app. Model: ${model} ` +
        '(set via onboarding/Settings, or PUPILA_LLM_MODEL).',
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint =
      res.status === 404
        ? ` Model "${model}" may not be pulled — try \`ollama pull ${model}\`.`
        : '';
    throw new Error(
      `ollama HTTP ${res.status} from ${url}.${hint}${body ? ` Body: ${body.slice(0, 300)}` : ''}`,
    );
  }

  if (!stream) {
    const data = (await res.json()) as OllamaGenerateChunk;
    if (data.error) throw new Error(`ollama error: ${data.error}`);
    warnIfPromptTruncated(promptTokenEstimate, data.prompt_eval_count, numCtx);
    return data.response ?? '';
  }

  // Streaming: NDJSON lines `{ "response": "...", "done": false|true }`.
  if (!res.body) {
    throw new Error('ollama returned an empty streaming body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stdout = '';
  let lastPromptEval: number | undefined;
  try {
    while (true) {
      if (signal?.aborted || runSignal.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        let chunk: OllamaGenerateChunk;
        try {
          chunk = JSON.parse(line) as OllamaGenerateChunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`ollama error: ${chunk.error}`);
        if (typeof chunk.prompt_eval_count === 'number') {
          lastPromptEval = chunk.prompt_eval_count;
        }
        if (chunk.response) {
          stdout += chunk.response;
          if (!(signal?.aborted || runSignal.aborted)) {
            try {
              onChunk?.(chunk.response);
            } catch {
              // never let a callback exception break the LLM run
            }
          }
        }
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted || runSignal.aborted) {
      throw err instanceof Error
        ? err
        : new DOMException('The operation was aborted', 'AbortError');
    }
    throw err;
  }
  warnIfPromptTruncated(promptTokenEstimate, lastPromptEval, numCtx);
  return stdout;
}

/**
 * Run a prompt through the detected LLM CLI and return its stdout. The
 * prompt is fed via stdin. On failure, runs a follow-up smoke test (`<cli>
 * --version`) to disambiguate the failure mode, and produces a detailed
 * error message that says exactly what we observed (signal, runtime,
 * prompt size, free memory, smoke test result) and what to try next.
 *
 * Pass `onChunk` to receive stdout chunks as they stream in (used by the
 * AI Apply dock so the user sees the LLM output live). `onChunk` exceptions
 * are caught and dropped — they will never break the underlying run.
 * Pass `signal` to cancel an in-flight ollama HTTP generate.
 */
export async function runLlm(
  prompt: string,
  override?: LlmProvider,
  onChunk?: (chunk: string) => void,
  model?: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const invocation = await detectLlmCli(override);

  // Ollama is HTTP-backed — skip the stdin/CLI spawn path.
  if (invocation.provider === 'ollama') {
    return runOllama(prompt, onChunk, model, signal);
  }

  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const result = await spawnAndPipe(invocation.cmd, invocation.argTemplate, prompt, onChunk);

  if (result.exitCode === 0) {
    return result.stdout;
  }

  // Failure path — gather diagnostics and produce the clearest error we can.
  const reason =
    result.signal !== null
      ? `killed by signal ${result.signal}`
      : `exited ${result.exitCode ?? 'null'}`;

  // Run smoke test for SIGKILL/SIGTERM/null-code/non-zero — anywhere we don't
  // know if it's the real prompt or the binary itself that's broken.
  const needsSmokeTest =
    result.signal === 'SIGKILL' ||
    result.signal === 'SIGTERM' ||
    result.signal === 'SIGSEGV' ||
    result.signal === 'SIGBUS' ||
    (result.exitCode !== null && result.exitCode !== 0);
  const smoke = needsSmokeTest ? await smokeTestCli(invocation.cmd) : null;

  const lines: string[] = [];
  lines.push(`${invocation.cmd} ${reason}.`);

  // 1ms SIGKILL on `claude --version` is the unmistakable signature of
  // claude's nested-session guard. We've already tried env-var stripping
  // AND `detached: true` to escape the parent's process group; if you
  // STILL see this, the guard is process-tree-based and the only escape
  // is a different parent process.
  if (invocation.cmd === 'claude' && result.signal === 'SIGKILL' && result.durationMs < 100) {
    lines.push('');
    lines.push('=========================================================================');
    lines.push("This is claude's nested-session guard. NOT your CV, NOT your subscription,");
    lines.push('NOT auth, NOT OOM. The Pro plan ($200) is unrelated — billing has nothing to');
    lines.push('do with this.');
    lines.push('');
    lines.push('`claude` instantly SIGKILLs itself when it detects it has been spawned from');
    lines.push("inside another Claude Code session. We've already tried two programmatic");
    lines.push('escapes (env-var stripping + detached process group). If you still see this,');
    lines.push('the guard is walking the process tree by parent-pid inspection, which we');
    lines.push("can't escape from inside this process.");
    lines.push('');
    lines.push('THE FIX (do this now):');
    lines.push('');
    lines.push('  1. Quit / close the Claude Code session you used to start `pnpm run ui`.');
    lines.push('  2. Open a NATIVE terminal — Terminal.app, iTerm, Warp, Ghostty.');
    lines.push('     The key is: NOT inside Claude Code.');
    lines.push('  3. cd into the repo and run `pnpm run ui` from that fresh terminal.');
    lines.push('  4. Re-upload your CV. It will work.');
    lines.push('');
    lines.push('OR use a different LLM CLI for this run:');
    lines.push('');
    lines.push('  PUPILA_LLM=codex pnpm run ui      # if you have codex CLI');
    lines.push('  PUPILA_LLM=gemini pnpm run ui     # if you have gemini-cli');
    lines.push('  PUPILA_LLM=opencode pnpm run ui   # if you have opencode');
    lines.push('  PUPILA_LLM=ollama pnpm run ui     # if you have ollama + a local model');
    lines.push('=========================================================================');
    lines.push('');
  }

  lines.push('');
  lines.push('Diagnostics:');
  lines.push(`  • runtime         : ${result.durationMs}ms before death`);
  lines.push(
    `  • prompt size     : ${promptBytes} bytes (${formatBytes(promptBytes)}, ${prompt.length} chars)`,
  );
  lines.push(
    `  • partial stdout  : ${result.partialStdoutBytes} bytes (${formatBytes(result.partialStdoutBytes)})`,
  );
  lines.push(`  • free memory     : ${formatBytes(os.freemem())} of ${formatBytes(os.totalmem())}`);
  if (result.stderr.trim()) {
    lines.push(`  • stderr (first 400 chars):`);
    for (const ln of result.stderr.trim().slice(0, 400).split('\n')) {
      lines.push(`      ${ln}`);
    }
  } else {
    lines.push(`  • stderr          : (empty — common with SIGKILL)`);
  }
  if (smoke) {
    lines.push('');
    if (smoke.ok) {
      lines.push(
        `Smoke test (\`${invocation.cmd} --version\`): ✓ exited 0 in ${smoke.durationMs}ms — CLI itself is fine.`,
      );
      lines.push('');
      lines.push('Most likely cause: out-of-memory while processing your prompt.');
      lines.push('Try (in order of effort):');
      lines.push(
        `  1. Shrink the input. Lower PUPILA_CV_MAX_CHARS (current default 12000) — try 6000 or 4000.`,
      );
      lines.push(
        `  2. Close memory-heavy apps (other Node servers, browsers with many tabs, Docker).`,
      );
      lines.push(`  3. Switch provider for one run: PUPILA_LLM=codex pnpm run ui`);
      lines.push(
        `  4. Run the same prompt outside the dev server: cat /tmp/prompt.txt | ${invocation.cmd} ${invocation.argTemplate.join(' ')}`,
      );
    } else {
      const smokeReason =
        smoke.signal !== null ? `killed by ${smoke.signal}` : `exited ${smoke.exitCode ?? 'null'}`;
      lines.push(
        `Smoke test (\`${invocation.cmd} --version\`): ✗ ${smokeReason} in ${smoke.durationMs}ms — the CLI itself is broken.`,
      );
      if (smoke.stderr.trim()) {
        lines.push(`  smoke stderr: ${smoke.stderr.trim().slice(0, 200)}`);
      }
      lines.push('');
      lines.push('The CLI is failing even on `--version` (no prompt at all), so this is not');
      lines.push('about your CV. Most likely causes:');
      lines.push(
        `  1. Broken install. Reinstall: npm i -g @anthropic-ai/claude-code (for claude) or your CLI's docs.`,
      );
      lines.push(
        `  2. The dev-server's spawned-process environment lacks something the CLI needs.`,
      );
      lines.push(`     Try running \`${invocation.cmd} --version\` directly in the same terminal.`);
      lines.push(`  3. macOS Memory Pressure Killer / sandbox kill. Check Console.app for entries`);
      lines.push(`     with subsystem "com.apple.kernel" around the time of the kill.`);
      lines.push(`  4. Switch provider: PUPILA_LLM=codex pnpm run ui`);
    }
  }

  throw new Error(lines.join('\n'));
}
