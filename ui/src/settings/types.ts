// Shared types for the Settings tab. Re-exports + small constants kept in
// one file so each panel component imports from a single place.

export type Provider = 'claude' | 'codex' | 'gemini' | 'opencode';
export type ProviderChoice = Provider | 'auto';
export const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini', 'opencode'];

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
      'Removes data/jobs.json, JOBS.md, feed.xml, raw dumps, archive, and logs. Keeps your candidate brief and applied jobs.',
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
      'Removes everything from "Wipe generated artifacts" PLUS your candidate brief AND your applied job history. This cannot be undone.',
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
