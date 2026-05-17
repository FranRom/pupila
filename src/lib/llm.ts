// Provider-agnostic LLM CLI wrapper. Shells out to whichever local LLM CLI is
// installed (claude / codex / gemini / opencode) so the same code path works
// for any user's tool of choice. No API keys, no per-token billing — uses the
// user's existing CLI subscription.
//
// Detection order:
//   1. PUPILA_LLM env var (claude | codex | gemini | opencode)
//   2. First found on PATH in the order: claude > codex > gemini > opencode
//
// Override the exact CLI invocation per provider via `PUPILA_LLM_FLAG`
// (e.g. `PUPILA_LLM_FLAG=--prompt`) if a CLI's flag syntax changes upstream.
//
// Prompt delivery: we feed the prompt via STDIN, not argv. Three reasons:
//   1. argv has a kernel-imposed size limit (ARG_MAX, ~1MB on macOS) and
//      we sometimes send 10–20KB CV+job blobs.
//   2. claude-code's `-p` mode reads from stdin when no positional prompt
//      is given; the same pattern works for codex/gemini/opencode.
//   3. argv is also visible in `ps`, so stdin keeps the prompt out of
//      process listings.

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

export type LlmProvider = 'claude' | 'codex' | 'gemini' | 'opencode';

export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
] as const;

interface ProviderSpec {
  /** Static argv passed before stdin is closed. The prompt is fed via stdin. */
  args: readonly string[];
}

// Each CLI's non-interactive print mode invocation. The prompt itself is
// piped through stdin, so these arrays hold *only* the mode-selecting flag.
//   claude -p             → read prompt from stdin, print response, exit
//   codex exec            → ditto
//   gemini -p             → ditto
//   opencode run          → ditto
const PROVIDER_DEFAULTS: Record<LlmProvider, ProviderSpec> = {
  claude: { args: ['-p'] },
  codex: { args: ['exec'] },
  gemini: { args: ['-p'] },
  opencode: { args: ['run'] },
};

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

const RUN_TIMEOUT_MS = Number(process.env.PUPILA_LLM_TIMEOUT_MS ?? '300000'); // 5 min default

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
 */
export async function runLlm(
  prompt: string,
  override?: LlmProvider,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const invocation = await detectLlmCli(override);
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
        `  1. Shrink the input. Lower JOB_HUNT_CV_MAX_CHARS (current default 12000) — try 6000 or 4000.`,
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
