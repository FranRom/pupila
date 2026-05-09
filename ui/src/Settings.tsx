import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, relativeTime } from './format.ts';
import { SchedulerProgress } from './SchedulerProgress.tsx';

// Settings tab. Seven numbered panels — terminal-grade dashboard aesthetic
// matching the rest of the app.
//
//   [01] LLM CLI         — switch + test the configured provider
//   [02] Scheduler       — read state + install/uninstall daily agents
//   [03] Scoring profile — view + regenerate config/profile.json from the brief
//   [04] Last run        — stats parsed from data/jobs.json
//   [05] Disk usage      — bytes/files for data/raw, data/applications, data/archive
//   [06] Maintenance     — clean / clean:onboarding / clean:all
//   [07] Environment     — node, repo path, brief/cv presence, providers
//
// Long-running ops (scheduler install/uninstall) reuse the FetchProgress
// docked-card pattern via SchedulerProgress so the live-feedback affordance
// is consistent across the app.

type Provider = 'claude' | 'codex' | 'gemini' | 'opencode';
type ProviderChoice = Provider | 'auto';
const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini', 'opencode'];

interface PreferencesResponse {
  provider: ProviderChoice | null;
  onboardedAt: string | null;
}

interface SchedulerStatus {
  platform: 'darwin' | 'linux' | 'other';
  installed: { aggregate: boolean; review: boolean };
  lastRun: { aggregate: string | null; review: string | null };
  installCmd: string;
  uninstallCmd: string;
}

interface RunSummary {
  generatedAt: string | null;
  total: number;
  byCategory: Record<string, number>;
  bySource: Array<{ name: string; kept: number }>;
  ageHours: number | null;
}

interface DiskBucket {
  bytes: number;
  files: number;
}

interface DiskUsage {
  raw: DiskBucket;
  applications: DiskBucket;
  archive: DiskBucket;
  total: DiskBucket;
}

interface EnvInfo {
  node: string;
  platform: string;
  repoRoot: string;
  briefPresent: boolean;
  cvPresent: boolean;
  providers: Record<Provider, boolean>;
  preferredProvider: ProviderChoice | null;
}

interface LlmTestResult {
  ok: boolean;
  provider: string;
  latencyMs: number;
  output: string;
  error?: string;
}

interface CleanResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  error?: string;
}

interface ScoringProfile {
  weights?: Record<string, number>;
  keywords?: Record<string, string[] | undefined>;
  [key: string]: unknown;
}

interface ProfileGenerateResult {
  ok: boolean;
  weightsChanged: string[];
  keywordsChanged: string[];
  provider: string;
  error?: string;
}

const PERSONAL_WEIGHT_KEYS = [
  'web3TitleBody',
  'web3Stack',
  'aiTitleBody',
  'aiStack',
  'stackPrimary',
  'stackRn',
  'stackOther',
  'frontendTitle',
  'frontendBody',
] as const;

const PERSONAL_KEYWORD_KEYS = [
  'stackPrimary',
  'stackRn',
  'stackOther',
  'titleFrontend',
  'bodyFrontend',
  'w3TitleBody',
  'w3Stack',
  'aiTitleBody',
  'aiStack',
  'titleExcludedSpecialties',
] as const;

type CleanMode = 'default' | 'all' | 'onboarding';

interface CleanModeMeta {
  command: string;
  shortDesc: string;
  longDesc: string;
  destructive: boolean;
}

const CLEAN_MODES: Record<CleanMode, CleanModeMeta> = {
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

interface ConfirmDialog {
  title: string;
  body: string;
  destructive: boolean;
  confirmLabel: string;
  onConfirm: () => void;
}

export function Settings() {
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>('auto');
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerSavedAt, setProviderSavedAt] = useState<number | null>(null);
  const [llmTest, setLlmTest] = useState<{ busy: boolean; result: LlmTestResult | null }>({
    busy: false,
    result: null,
  });
  const [cleaning, setCleaning] = useState<CleanMode | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [profile, setProfile] = useState<ScoringProfile | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState<ProfileGenerateResult | null>(null);
  const [showRawProfile, setShowRawProfile] = useState(false);
  const [skipReview, setSkipReview] = useState(false);
  const [schedulerOp, setSchedulerOp] = useState<'install' | 'uninstall' | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const grab = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return (await r.json()) as T;
      } catch {
        return null;
      }
    };
    const [p, s, rs, d, e, prof] = await Promise.all([
      grab<PreferencesResponse>('/api/preferences'),
      grab<SchedulerStatus>('/api/scheduler-status'),
      grab<RunSummary>('/api/run-summary'),
      grab<DiskUsage>('/api/disk-usage'),
      grab<EnvInfo>('/api/env'),
      grab<ScoringProfile>('/api/profile'),
    ]);
    if (p) {
      setPrefs(p);
      setProvider(p.provider ?? 'auto');
    }
    setScheduler(s);
    setRunSummary(rs);
    setDisk(d);
    setEnvInfo(e);
    setProfile(prof);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Close the confirm modal on Esc.
  useEffect(() => {
    if (!confirmDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDialog(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDialog]);

  const saveProvider = useCallback(async () => {
    setSavingProvider(true);
    setError(null);
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const next = (await res.json()) as PreferencesResponse;
      setPrefs(next);
      setProviderSavedAt(Date.now());
      setLlmTest({ busy: false, result: null });
    } catch (err) {
      setError(`Could not save provider: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingProvider(false);
    }
  }, [provider]);

  const testLlm = useCallback(async () => {
    setLlmTest({ busy: true, result: null });
    setError(null);
    try {
      const res = await fetch('/api/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json()) as LlmTestResult;
      setLlmTest({ busy: false, result: body });
    } catch (err) {
      setLlmTest({
        busy: false,
        result: {
          ok: false,
          provider,
          latencyMs: 0,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }, [provider]);

  const runClean = useCallback(
    async (mode: CleanMode) => {
      setCleaning(mode);
      setCleanResult(null);
      setError(null);
      try {
        const res = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const body = (await res.json()) as CleanResult;
        setCleanResult(body);
        await loadAll();
      } catch (err) {
        setError(`Clean failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setCleaning(null);
      }
    },
    [loadAll],
  );

  const regenerateProfile = useCallback(async () => {
    setRegenBusy(true);
    setRegenResult(null);
    setError(null);
    try {
      const res = await fetch('/api/profile-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider === 'auto' ? null : provider }),
      });
      const body = (await res.json()) as ProfileGenerateResult;
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRegenResult(body);
      // Reload the profile so the UI reflects the new state.
      const r = await fetch('/api/profile');
      if (r.ok) setProfile((await r.json()) as ScoringProfile);
    } catch (err) {
      setError(`Profile regeneration failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegenBusy(false);
    }
  }, [provider]);

  const installScheduler = useCallback(async () => {
    setError(null);
    setSchedulerOp('install');
    try {
      const res = await fetch('/api/scheduler-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipReview }),
      });
      if (!res.ok && res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      setSchedulerOp(null);
    }
  }, [skipReview]);

  const uninstallScheduler = useCallback(async () => {
    setError(null);
    setSchedulerOp('uninstall');
    try {
      const res = await fetch('/api/scheduler-uninstall', { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      setSchedulerOp(null);
    }
  }, []);

  const onSchedulerComplete = useCallback(async () => {
    setSchedulerOp(null);
    // Re-fetch scheduler status so the pills + last-run flip to the new state.
    try {
      const res = await fetch('/api/scheduler-status');
      if (res.ok) setScheduler((await res.json()) as SchedulerStatus);
    } catch {
      // ignore
    }
  }, []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedSnippet(text);
    window.setTimeout(() => {
      setCopiedSnippet((current) => (current === text ? null : current));
    }, 1500);
  }, []);

  const askToClean = (mode: CleanMode) => {
    const meta = CLEAN_MODES[mode];
    setConfirmDialog({
      title: meta.command,
      body: meta.longDesc,
      destructive: meta.destructive,
      confirmLabel: meta.destructive ? 'Yes, delete everything' : 'Run',
      onConfirm: () => {
        setConfirmDialog(null);
        void runClean(mode);
      },
    });
  };

  const askToRegenerateProfile = () => {
    setConfirmDialog({
      title: 'Regenerate scoring profile',
      body: 'This re-runs the local LLM CLI on your candidate brief and overwrites the personal weights + keyword arrays in config/profile.json (stackPrimary, titleFrontend, w3*, ai*, titleExcludedSpecialties, etc.). Universal rules (junior excludes, US-only filter, scoring config) are preserved. Takes 10–20 seconds.',
      destructive: false,
      confirmLabel: 'Regenerate',
      onConfirm: () => {
        setConfirmDialog(null);
        void regenerateProfile();
      },
    });
  };

  const askToInstall = () => {
    if (!scheduler) return;
    const cmdSummary = skipReview ? `${scheduler.installCmd} --no-review` : scheduler.installCmd;
    setConfirmDialog({
      title: 'Install scheduler',
      body: `This will run \`${cmdSummary}\` from the repo root. It writes ${
        scheduler.platform === 'darwin'
          ? 'launchd plists in ~/Library/LaunchAgents/'
          : 'entries to your crontab'
      } so the aggregator${skipReview ? '' : ' and AI review'} run daily. You can uninstall at any time.`,
      destructive: false,
      confirmLabel: 'Install',
      onConfirm: () => {
        setConfirmDialog(null);
        void installScheduler();
      },
    });
  };

  const askToUninstall = () => {
    if (!scheduler) return;
    setConfirmDialog({
      title: 'Uninstall scheduler',
      body: `This will run \`${scheduler.uninstallCmd}\` from the repo root and remove the daily ${
        scheduler.platform === 'darwin' ? 'launchd agents' : 'crontab entries'
      }. Your jobs.json and applied.json are not touched.`,
      destructive: true,
      confirmLabel: 'Uninstall',
      onConfirm: () => {
        setConfirmDialog(null);
        void uninstallScheduler();
      },
    });
  };

  const showSavedToast = providerSavedAt && Date.now() - providerSavedAt < 3000;
  const detectedAny = envInfo ? PROVIDERS.some((p) => envInfo.providers[p]) : false;
  const schedulerBusy = schedulerOp !== null;

  const totalDisk = disk?.total.bytes ?? 0;
  const diskBuckets = useMemo(() => {
    if (!disk) return null;
    const items = [
      { key: 'raw', label: 'data/raw', bucket: disk.raw, note: 'per-source raw dumps' },
      {
        key: 'applications',
        label: 'data/applications',
        bucket: disk.applications,
        note: 'AI Apply markdown packages',
      },
      {
        key: 'archive',
        label: 'data/archive',
        bucket: disk.archive,
        note: 'month-end snapshots',
      },
    ];
    return items;
  }, [disk]);

  return (
    <div className="settings">
      {error && (
        <div className="api-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* ── [01] LLM CLI ─────────────────────────────────────────── */}
      <Section
        index="01"
        title="LLM CLI"
        subtitle="Local CLI used for the CV summary, AI review, and AI Apply."
        meta={
          prefs?.provider ? (
            <ProviderChip provider={prefs.provider} />
          ) : (
            <span className="settings-meta-pill settings-meta-pill-warn">not set</span>
          )
        }
      >
        {!envInfo ? (
          <SkeletonRows count={5} />
        ) : (
          <ul className="provider-list">
            <li>
              <label>
                <input
                  type="radio"
                  name="settings-provider"
                  value="auto"
                  checked={provider === 'auto'}
                  onChange={() => setProvider('auto')}
                />
                <strong>Auto-detect</strong>
                <span className="muted">
                  — first installed in claude → codex → gemini → opencode
                </span>
              </label>
            </li>
            {PROVIDERS.map((p) => (
              <li key={p}>
                <label>
                  <input
                    type="radio"
                    name="settings-provider"
                    value={p}
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                    disabled={!envInfo.providers[p]}
                  />
                  <strong>{p}</strong>
                  <span className={envInfo.providers[p] ? 'available' : 'unavailable'}>
                    {envInfo.providers[p] ? '✓ installed' : '✗ not on PATH'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {!detectedAny && envInfo && (
          <p className="warn">
            No supported LLM CLI on PATH. Install one (e.g.{' '}
            <a
              href="https://docs.claude.com/en/docs/claude-code/quickstart"
              target="_blank"
              rel="noopener noreferrer"
            >
              Claude Code
            </a>
            ) to enable AI features.
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="settings-button settings-button-primary"
            disabled={savingProvider || !envInfo}
            onClick={() => void saveProvider()}
          >
            {savingProvider ? 'Saving…' : 'Save provider'}
          </button>
          <button
            type="button"
            className="settings-button settings-button-secondary"
            disabled={llmTest.busy || !detectedAny}
            onClick={() => void testLlm()}
          >
            {llmTest.busy ? 'Testing…' : 'Test connection'}
          </button>
          {showSavedToast && <span className="settings-toast">✓ saved</span>}
        </div>
        {llmTest.result && <LlmTestResultPanel result={llmTest.result} />}
      </Section>

      {/* ── [02] Scheduler ───────────────────────────────────────── */}
      <Section
        index="02"
        title="Scheduler"
        subtitle="Run the daily aggregator and AI review without opening this UI."
        meta={
          scheduler ? <span className="settings-meta-pill mono">{scheduler.platform}</span> : null
        }
      >
        {!scheduler ? (
          <SkeletonRows count={2} />
        ) : (
          <>
            <div className="scheduler-grid">
              <SchedulerRow
                label="Aggregator"
                cmd="pnpm run dev"
                installed={scheduler.installed.aggregate}
                lastRun={scheduler.lastRun.aggregate}
              />
              <SchedulerRow
                label="AI review"
                cmd="pnpm run ai-review"
                installed={scheduler.installed.review}
                lastRun={scheduler.lastRun.review}
              />
            </div>

            {scheduler.platform === 'other' ? (
              <p className="warn">
                Unknown platform — only macOS and Linux scheduler scripts are bundled.
              </p>
            ) : (
              <>
                <TerminalBlock
                  command={
                    skipReview ? `${scheduler.installCmd} --no-review` : scheduler.installCmd
                  }
                  busy={schedulerOp === 'install'}
                  disabled={schedulerBusy}
                  onRun={askToInstall}
                  onCopy={copy}
                  copied={
                    copiedSnippet ===
                    (skipReview ? `${scheduler.installCmd} --no-review` : scheduler.installCmd)
                  }
                  runLabel={
                    scheduler.installed.aggregate || scheduler.installed.review
                      ? 'Reinstall'
                      : 'Install'
                  }
                />
                <label className="checkbox checkbox-inline">
                  <input
                    type="checkbox"
                    checked={skipReview}
                    onChange={(e) => setSkipReview(e.target.checked)}
                    disabled={schedulerBusy}
                  />
                  Skip the AI review agent (<code>--no-review</code>) — useful if you don't have an
                  LLM CLI installed.
                </label>

                {(scheduler.installed.aggregate || scheduler.installed.review) && (
                  <TerminalBlock
                    command={scheduler.uninstallCmd}
                    busy={schedulerOp === 'uninstall'}
                    disabled={schedulerBusy}
                    onRun={askToUninstall}
                    onCopy={copy}
                    copied={copiedSnippet === scheduler.uninstallCmd}
                    runLabel="Uninstall"
                    danger
                  />
                )}
              </>
            )}
          </>
        )}
      </Section>

      {/* ── [03] Scoring profile ─────────────────────────────────── */}
      <Section
        index="03"
        title="Scoring profile"
        subtitle="config/profile.json — auto-generated from your brief. Drives which roles surface."
        meta={<ProfileStatusChip profile={profile} />}
      >
        {!profile ? <SkeletonRows count={4} /> : <ProfileSummary profile={profile} />}
        <div className="settings-actions">
          <button
            type="button"
            className="settings-button settings-button-primary"
            disabled={regenBusy || !envInfo}
            onClick={askToRegenerateProfile}
          >
            {regenBusy ? 'Regenerating…' : 'Regenerate from brief'}
          </button>
          <button
            type="button"
            className="settings-button settings-button-secondary"
            onClick={() => setShowRawProfile((v) => !v)}
          >
            {showRawProfile ? 'Hide raw JSON' : 'View raw JSON'}
          </button>
        </div>
        {regenResult && (
          <div className="settings-snippet">
            <p className="muted">
              ✓ Updated {regenResult.weightsChanged.length} weight
              {regenResult.weightsChanged.length === 1 ? '' : 's'} (
              {regenResult.weightsChanged.join(', ') || 'none'}) and{' '}
              {regenResult.keywordsChanged.length} keyword group
              {regenResult.keywordsChanged.length === 1 ? '' : 's'} (
              {regenResult.keywordsChanged.join(', ') || 'none'}).
            </p>
          </div>
        )}
        {showRawProfile && profile && (
          <pre className="settings-clean-output">{JSON.stringify(profile, null, 2)}</pre>
        )}
      </Section>

      {/* ── [04] Last run ────────────────────────────────────────── */}
      <Section
        index="04"
        title="Last run"
        subtitle="Snapshot of the most recent aggregator output."
        meta={
          runSummary?.generatedAt ? (
            <span
              className={`settings-meta-pill ${
                runSummary.ageHours !== null && runSummary.ageHours >= 24
                  ? 'settings-meta-pill-warn'
                  : 'settings-meta-pill-ok'
              }`}
            >
              {relativeTime(runSummary.generatedAt)}
              {runSummary.ageHours !== null && runSummary.ageHours >= 24 ? ' · stale' : ''}
            </span>
          ) : null
        }
      >
        {!runSummary ? (
          <SkeletonRows count={3} />
        ) : runSummary.total > 0 ? (
          <>
            <div className="run-summary-totals">
              <Stat label="Kept" value={runSummary.total.toLocaleString()} accent />
              {(['web3+ai', 'web3', 'ai', 'general'] as const).map((c) => (
                <Stat key={c} label={c} value={(runSummary.byCategory[c] ?? 0).toLocaleString()} />
              ))}
            </div>
            <ul className="source-list">
              {runSummary.bySource.map((s) => (
                <li
                  key={s.name}
                  className={s.kept === 0 ? 'source-row source-row-empty' : 'source-row'}
                >
                  <span className="source-name">{s.name}</span>
                  <span className="source-kept">{s.kept === 0 ? '🚨 0' : s.kept}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            title="No data yet"
            body="Run the aggregator from the Jobs tab to populate this panel."
          />
        )}
      </Section>

      {/* ── [05] Disk usage ──────────────────────────────────────── */}
      <Section
        index="05"
        title="Disk usage"
        subtitle="Local artifacts under data/."
        meta={
          disk ? (
            <span className="settings-meta-pill mono">
              {formatBytes(disk.total.bytes)} · {disk.total.files} files
            </span>
          ) : null
        }
      >
        {!disk ? (
          <SkeletonRows count={3} />
        ) : (
          <ul className="disk-list">
            {diskBuckets?.map((b) => (
              <DiskRow
                key={b.key}
                label={b.label}
                bucket={b.bucket}
                note={b.note}
                totalBytes={totalDisk}
              />
            ))}
          </ul>
        )}
      </Section>

      {/* ── [06] Maintenance ─────────────────────────────────────── */}
      <Section
        index="06"
        title="Maintenance"
        subtitle="Reset local state. Each action shows a confirmation before it runs."
      >
        <div className="maintenance-list">
          {(Object.keys(CLEAN_MODES) as CleanMode[]).map((mode) => {
            const meta = CLEAN_MODES[mode];
            return (
              <MaintenanceRow
                key={mode}
                meta={meta}
                busy={cleaning === mode}
                disabled={cleaning !== null}
                onClick={() => askToClean(mode)}
              />
            );
          })}
        </div>
        {cleanResult && (
          <pre className="settings-clean-output">
            {cleanResult.output ||
              (cleanResult.ok ? 'done.' : `(no output, exit ${cleanResult.exitCode})`)}
          </pre>
        )}
      </Section>

      {/* ── [07] Environment ─────────────────────────────────────── */}
      <Section
        index="07"
        title="Environment"
        subtitle="Runtime + filesystem state for debugging."
        action={
          <button
            type="button"
            className="settings-button settings-button-secondary settings-button-small"
            onClick={() => void loadAll()}
          >
            Refresh all
          </button>
        }
      >
        {!envInfo ? (
          <SkeletonRows count={5} />
        ) : (
          <dl className="env-grid">
            <dt>Node</dt>
            <dd className="mono">{envInfo.node}</dd>
            <dt>Platform</dt>
            <dd className="mono">{envInfo.platform}</dd>
            <dt>Repo</dt>
            <dd className="mono">{envInfo.repoRoot}</dd>
            <dt>Brief</dt>
            <dd>
              {envInfo.briefPresent ? (
                <span className="env-badge env-badge-ok">✓ present</span>
              ) : (
                <span className="env-badge env-badge-missing">✗ missing</span>
              )}
            </dd>
            <dt>CV file</dt>
            <dd>
              {envInfo.cvPresent ? (
                <span className="env-badge env-badge-ok">✓ present</span>
              ) : (
                <span className="env-badge env-badge-missing">✗ missing</span>
              )}
            </dd>
            <dt>Providers</dt>
            <dd>
              {PROVIDERS.map((p) => (
                <span
                  key={p}
                  className={`env-provider ${envInfo.providers[p] ? 'env-provider-ok' : 'env-provider-missing'}`}
                >
                  {envInfo.providers[p] ? '✓' : '✗'} {p}
                </span>
              ))}
            </dd>
          </dl>
        )}
      </Section>

      <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      <SchedulerProgress onComplete={onSchedulerComplete} />
    </div>
  );
}

interface SectionProps {
  index: string;
  title: string;
  subtitle: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ index, title, subtitle, meta, action, children }: SectionProps) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <div className="settings-section-titles">
          <span className="settings-section-index">[{index}]</span>
          <div>
            <h2>{title}</h2>
            <p className="settings-section-subtitle">{subtitle}</p>
          </div>
        </div>
        <div className="settings-section-meta">
          {meta}
          {action}
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function ProviderChip({ provider }: { provider: ProviderChoice }) {
  return <span className="settings-meta-pill settings-meta-pill-ok mono">{provider}</span>;
}

function ProfileStatusChip({ profile }: { profile: ScoringProfile | null }) {
  if (!profile) return null;
  const weights = profile.weights ?? {};
  const personalActive = PERSONAL_WEIGHT_KEYS.some((k) => (weights[k] ?? 0) > 0);
  if (personalActive) {
    return <span className="settings-meta-pill settings-meta-pill-ok">active</span>;
  }
  return <span className="settings-meta-pill settings-meta-pill-warn">needs tuning</span>;
}

function ProfileSummary({ profile }: { profile: ScoringProfile }) {
  const keywords = profile.keywords ?? {};
  const weights = profile.weights ?? {};
  const populatedKwGroups = PERSONAL_KEYWORD_KEYS.filter((k) => {
    const v = keywords[k];
    return Array.isArray(v) && v.length > 0;
  });
  const activeWeightCount = PERSONAL_WEIGHT_KEYS.filter((k) => (weights[k] ?? 0) > 0).length;
  if (populatedKwGroups.length === 0 && activeWeightCount === 0) {
    return (
      <div className="settings-empty">
        <strong>Profile is neutral</strong>
        <p className="muted">
          No personal keywords or weights are set yet. Click "Regenerate from brief" to populate
          them based on <code>config/candidate-brief.md</code>.
        </p>
      </div>
    );
  }
  return (
    <ul className="profile-summary-list">
      {populatedKwGroups.map((k) => {
        const arr = keywords[k] as string[];
        const preview = arr.slice(0, 6).join(', ');
        const more = arr.length > 6 ? ` +${arr.length - 6} more` : '';
        return (
          <li key={k} className="profile-summary-row">
            <span className="profile-summary-key mono">{k}</span>
            <span className="profile-summary-value">
              {preview}
              {more}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="settings-skeleton" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static
        <div key={i} className="settings-skeleton-row" />
      ))}
    </div>
  );
}

interface SchedulerRowProps {
  label: string;
  cmd: string;
  installed: boolean;
  lastRun: string | null;
}

function SchedulerRow({ label, cmd, installed, lastRun }: SchedulerRowProps) {
  return (
    <div className="scheduler-row">
      <div className="scheduler-row-text">
        <span className="scheduler-label">{label}</span>
        <code className="scheduler-cmd">{cmd}</code>
      </div>
      <span className={`scheduler-pill scheduler-pill-${installed ? 'on' : 'off'}`}>
        {installed ? 'loaded' : 'not loaded'}
      </span>
      <span className="scheduler-lastrun">
        {lastRun ? `last run ${relativeTime(lastRun)}` : 'never run'}
      </span>
    </div>
  );
}

interface TerminalBlockProps {
  command: string;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  onCopy: (cmd: string) => void;
  copied: boolean;
  runLabel: string;
  danger?: boolean;
}

function TerminalBlock({
  command,
  busy,
  disabled,
  onRun,
  onCopy,
  copied,
  runLabel,
  danger,
}: TerminalBlockProps) {
  return (
    <div className={`terminal-block ${danger ? 'terminal-block-danger' : ''}`}>
      <code className="terminal-block-line">
        <span className="terminal-block-prompt">$</span>
        <span className="terminal-block-cmd">{command}</span>
      </code>
      <div className="terminal-block-actions">
        <button
          type="button"
          className="terminal-block-copy"
          onClick={() => onCopy(command)}
          title="Copy command"
        >
          {copied ? '✓ copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`terminal-block-run ${danger ? 'terminal-block-run-danger' : ''}`}
          disabled={disabled || busy}
          onClick={onRun}
        >
          {busy ? 'Running…' : runLabel}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat-chip ${accent ? 'stat-chip-accent' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function DiskRow({
  label,
  bucket,
  note,
  totalBytes,
}: {
  label: string;
  bucket: DiskBucket;
  note: string;
  totalBytes: number;
}) {
  const pct = totalBytes > 0 ? Math.max(2, Math.round((bucket.bytes / totalBytes) * 100)) : 0;
  return (
    <li className="disk-row">
      <div className="disk-row-head">
        <span className="disk-label mono">{label}</span>
        <span className="disk-size">{formatBytes(bucket.bytes)}</span>
        <span className="disk-files muted">{bucket.files} files</span>
      </div>
      <div className="disk-bar" aria-hidden>
        <div className="disk-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="disk-note muted">{note}</span>
    </li>
  );
}

interface MaintenanceRowProps {
  meta: CleanModeMeta;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function MaintenanceRow({ meta, busy, disabled, onClick }: MaintenanceRowProps) {
  return (
    <div className={`maintenance-row ${meta.destructive ? 'maintenance-row-danger' : ''}`}>
      <div className="maintenance-text">
        <code className="maintenance-label">{meta.command}</code>
        <p className="muted">{meta.shortDesc}</p>
      </div>
      <button
        type="button"
        className={`settings-button ${meta.destructive ? 'settings-button-danger' : 'settings-button-secondary'}`}
        disabled={disabled}
        onClick={onClick}
      >
        {busy ? 'Running…' : meta.destructive ? 'Run (destructive)' : 'Run'}
      </button>
    </div>
  );
}

function LlmTestResultPanel({ result }: { result: LlmTestResult }) {
  const tier =
    result.latencyMs <= 3000
      ? 'llm-test-fast'
      : result.latencyMs <= 10_000
        ? 'llm-test-mid'
        : 'llm-test-slow';
  return (
    <div className={`llm-test-result ${result.ok ? tier : 'llm-test-fail'}`}>
      {result.ok ? (
        <>
          <div className="llm-test-result-head">
            <strong>✓ {result.provider}</strong>
            <span className="muted">{result.latencyMs}ms</span>
          </div>
          <pre>{result.output}</pre>
        </>
      ) : (
        <>
          <div className="llm-test-result-head">
            <strong>✗ {result.provider} failed</strong>
          </div>
          <pre>{result.error ?? 'unknown error'}</pre>
        </>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="settings-empty">
      <strong>{title}</strong>
      <p className="muted">{body}</p>
    </div>
  );
}

interface ConfirmModalProps {
  dialog: ConfirmDialog | null;
  onClose: () => void;
}

function ConfirmModal({ dialog, onClose }: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // Focus the confirm action on open so the user can hit Enter to proceed
  // (and Esc to cancel — global listener in the parent handles that).
  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);

  if (!dialog) return null;
  // Click-outside-to-dismiss: only fires when the click target is the overlay
  // itself, not a bubbled click from inside the modal. Avoids needing a
  // stopPropagation handler on the inner div.
  const onOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  // Local keyboard handler on the overlay (in addition to the global Esc
  // listener in the parent) so this component is fully keyboard-accessible
  // standalone too.
  const onOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && e.target === e.currentTarget) onClose();
  };
  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onMouseDown={onOverlayMouseDown}
      onKeyDown={onOverlayKeyDown}
    >
      <div className={`confirm-modal ${dialog.destructive ? 'confirm-modal-danger' : ''}`}>
        <header className="confirm-modal-header">
          <h3 id="confirm-modal-title">{dialog.title}</h3>
          <button
            type="button"
            className="confirm-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p className="confirm-modal-body">{dialog.body}</p>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="settings-button settings-button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`settings-button ${dialog.destructive ? 'settings-button-danger' : 'settings-button-primary'}`}
            onClick={dialog.onConfirm}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
