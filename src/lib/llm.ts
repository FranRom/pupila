// Provider-agnostic LLM CLI wrapper. Shells out to whichever local LLM CLI is
// installed (claude / codex / gemini / opencode) so the same code path works
// for any user's tool of choice. No API keys, no per-token billing — uses the
// user's existing CLI subscription.
//
// Detection order:
//   1. JOB_HUNT_LLM env var (claude | codex | gemini | opencode)
//   2. First found on PATH in the order: claude > codex > gemini > opencode
//
// Override the exact CLI invocation per provider via `JOB_HUNT_LLM_FLAG`
// (e.g. `JOB_HUNT_LLM_FLAG=--prompt`) if a CLI's flag syntax changes upstream.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LlmProvider = 'claude' | 'codex' | 'gemini' | 'opencode';

export const SUPPORTED_PROVIDERS: readonly LlmProvider[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
] as const;

interface ProviderSpec {
  /** Argument template — `__PROMPT__` is replaced with the actual prompt at call time. */
  args: readonly string[];
}

// Default flag conventions. Override the prompt-flag for any provider via
// JOB_HUNT_LLM_FLAG if a CLI changes upstream.
const PROVIDER_DEFAULTS: Record<LlmProvider, ProviderSpec> = {
  claude: { args: ['-p', '__PROMPT__'] },
  codex: { args: ['exec', '__PROMPT__'] },
  gemini: { args: ['-p', '__PROMPT__'] },
  opencode: { args: ['run', '__PROMPT__'] },
};

export interface LlmInvocation {
  provider: LlmProvider;
  cmd: string;
  argTemplate: readonly string[];
}

function isSupportedProvider(value: string): value is LlmProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    // `command -v` is POSIX-portable; works on bash and zsh. On Windows, this
    // would need `where`, but the rest of the project is POSIX-only anyway.
    await execFileAsync('sh', ['-c', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

function buildSpec(provider: LlmProvider): ProviderSpec {
  const flagOverride = process.env.JOB_HUNT_LLM_FLAG;
  if (flagOverride) {
    return { args: [flagOverride, '__PROMPT__'] };
  }
  return PROVIDER_DEFAULTS[provider];
}

/**
 * Resolve the LLM CLI to use, either from `JOB_HUNT_LLM` env var or by
 * detecting which one is installed. Throws with a helpful message if none
 * are available.
 */
export async function detectLlmCli(override?: LlmProvider): Promise<LlmInvocation> {
  const requested = override ?? process.env.JOB_HUNT_LLM;
  if (requested) {
    if (!isSupportedProvider(requested)) {
      throw new Error(
        `JOB_HUNT_LLM="${requested}" is not supported. Use one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
    }
    if (!(await commandExists(requested))) {
      throw new Error(
        `JOB_HUNT_LLM="${requested}" was requested but the \`${requested}\` CLI is not on PATH.`,
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

/**
 * Run a prompt through the detected LLM CLI and return its stdout. Rejects
 * with a clear error if the CLI exits non-zero.
 */
export async function runLlm(prompt: string, override?: LlmProvider): Promise<string> {
  const invocation = await detectLlmCli(override);
  const args = invocation.argTemplate.map((a) => (a === '__PROMPT__' ? prompt : a));
  return new Promise((resolve, reject) => {
    const proc = spawn(invocation.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${invocation.cmd} exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
