// Shared types for the Settings tab. Re-exports + small constants kept in
// one file so each panel component imports from a single place.

export type Provider = 'claude' | 'codex' | 'gemini' | 'opencode';
export type ProviderChoice = Provider | 'auto';
export const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini', 'opencode'];

/**
 * Per-provider display metadata for the LLM-CLI picker.
 *
 * `label` is the human-facing name and `installUrl` points at the official
 * install/quickstart page where the copy-paste install command lives. These
 * exist so the onboarding picker can show a friendly name + a Download link:
 * non-technical users (e.g. recruiters) routinely confuse "Claude Code" (the
 * terminal CLI this app shells out to) with the Claude desktop app, and end up
 * installing the wrong thing. Aiming the Download button at the CLI docs fixes
 * that at the source.
 */
export interface ProviderMeta {
  label: string;
  installUrl: string;
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  claude: {
    label: 'Claude Code',
    installUrl: 'https://code.claude.com/docs/en/quickstart',
  },
  codex: {
    label: 'Codex CLI',
    installUrl: 'https://github.com/openai/codex',
  },
  gemini: {
    label: 'Gemini CLI',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  opencode: {
    label: 'opencode',
    installUrl: 'https://opencode.ai/docs/',
  },
};

export interface PreferencesResponse {
  provider: ProviderChoice | null;
  onboardedAt: string | null;
}

export interface SchedulerStatus {
  platform: 'darwin' | 'linux' | 'other';
  installed: { aggregate: boolean; review: boolean };
  lastRun: { aggregate: string | null; review: string | null };
  installCmd: string;
  uninstallCmd: string;
}

export interface RunSummary {
  generatedAt: string | null;
  total: number;
  byCategory: Record<string, number>;
  bySource: Array<{ name: string; kept: number }>;
  ageHours: number | null;
}

export interface DiskBucket {
  bytes: number;
  files: number;
}

export interface DiskUsage {
  raw: DiskBucket;
  applications: DiskBucket;
  archive: DiskBucket;
  total: DiskBucket;
}

export interface EnvInfo {
  node: string;
  platform: string;
  repoRoot: string;
  briefPresent: boolean;
  cvPresent: boolean;
  providers: Record<Provider, boolean>;
  preferredProvider: ProviderChoice | null;
}

export interface LlmTestResult {
  ok: boolean;
  provider: string;
  latencyMs: number;
  output: string;
  error?: string;
}

export interface CleanResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  error?: string;
}

export interface ScoringProfile {
  weights?: Record<string, number>;
  keywords?: Record<string, string[] | undefined>;
  [key: string]: unknown;
}

// MED-7 — server now returns { profile, generating } instead of just the
// raw profile, so the UI can show a "generating…" pill while the LLM is
// working in the background.
export interface ProfileGetResponse {
  profile: ScoringProfile | null;
  generating: boolean;
}

export interface ProfileGenerateResult {
  ok: boolean;
  weightsChanged: string[];
  keywordsChanged: string[];
  provider: string;
  error?: string;
}

export type CleanMode = 'default' | 'all' | 'onboarding';

export interface CleanModeMeta {
  command: string;
  shortDesc: string;
  longDesc: string;
  destructive: boolean;
}

export const CLEAN_MODES: Record<CleanMode, CleanModeMeta> = {
  default: {
    command: 'pnpm run clean',
    shortDesc: 'Wipe generated artifacts',
    longDesc:
      'Removes data/jobs.json, JOBS.md, feed.xml, raw dumps, archive, logs, and the apply-queue state. Keeps your candidate brief, applied jobs, swipe-skips, and generated application packages.',
    destructive: false,
  },
  onboarding: {
    command: 'pnpm run clean:onboarding',
    shortDesc: 'Reset onboarding only',
    longDesc:
      'Removes config/preferences.json, candidate-brief.md, and the raw CV file. Keeps jobs.json and applied.json. The first-run wizard will trigger again.',
    destructive: false,
  },
  all: {
    command: 'pnpm run clean -- --all',
    shortDesc: 'Full reset (destructive)',
    longDesc:
      'Fresh-clone reset. Removes everything from "Wipe generated artifacts" PLUS your candidate brief, applied job history, swipe-skips, generated application packages, preferences, and uploaded CV. The first-run wizard will re-trigger. This cannot be undone.',
    destructive: true,
  },
};

export interface ConfirmDialog {
  title: string;
  body: string;
  destructive: boolean;
  confirmLabel: string;
  onConfirm: () => void;
}
