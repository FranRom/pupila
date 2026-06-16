import { useCallback, useEffect, useState } from 'react';
import type { SourceHealthResponse, SourcesResponse, VerifyResponse } from './lib/api/index.ts';
import { api, formatError } from './lib/api/index.ts';
import styles from './Settings.module.css';
import { ApplyQueuePanel } from './settings/ApplyQueuePanel.tsx';
import { ConfirmModal } from './settings/ConfirmModal.tsx';
import { DiskUsagePanel } from './settings/DiskUsagePanel.tsx';
import { EnvironmentPanel } from './settings/EnvironmentPanel.tsx';
import { LastRunPanel } from './settings/LastRunPanel.tsx';
import { LlmCliPanel } from './settings/LlmCliPanel.tsx';
import { MaintenancePanel } from './settings/MaintenancePanel.tsx';
import { SchedulerPanel } from './settings/SchedulerPanel.tsx';
import { ScoringProfilePanel } from './settings/ScoringProfilePanel.tsx';
import { SourcesPanel } from './settings/SourcesPanel.tsx';
import {
  CLEAN_MODES,
  type CleanMode,
  type CleanResult,
  type ConfirmDialog,
  type DiskUsage,
  type EnvInfo,
  type LlmTestResult,
  type PreferencesResponse,
  type ProfileGenerateResult,
  type ProviderChoice,
  type RunSummary,
  type SchedulerStatus,
  type ScoringProfile,
} from './settings/types.ts';
import bannerStyles from './styles/Banner.module.css';
import type { ApplyQueueResponse } from './types.ts';

// Settings tab. Seven numbered panels — terminal-grade dashboard aesthetic
// matching the rest of the app.
//
//   [01] LLM CLI         — switch + test the configured provider
//   [02] Scheduler       — read state + install/uninstall daily agents
//   [03] Scoring profile — view + regenerate config/profile.json from the brief
//   [09] Job sources     - add/remove company boards (config/slugs.local.json)
//   [04] Last run        — stats parsed from data/jobs.json
//   [05] Disk usage      — bytes/files for data/raw, data/applications, data/archive
//   [06] Maintenance     — clean / clean:onboarding / clean:all
//   [07] Environment     — node, repo path, brief/cv presence, providers
//
// LOW-9: SchedulerProgress is now mounted at the App level (sibling of the
// tab router) so the docked-card persists across tab switches. Settings
// receives `schedulerCompletedAt` and refetches scheduler status whenever
// it ticks.

interface SettingsProps {
  schedulerCompletedAt: number;
  applyQueue: ApplyQueueResponse | null;
  onCancelQueueRow: (jobId: string) => Promise<void>;
  onRefreshQueue: () => Promise<void>;
  /** Called after any successful clean — re-probes preferences (so the
   * wizard re-triggers after `--all` wipes them) and reloads jobs. */
  onCleanComplete: () => Promise<void>;
}

export function Settings({
  schedulerCompletedAt,
  applyQueue,
  onCancelQueueRow,
  onRefreshQueue,
  onCleanComplete,
}: SettingsProps) {
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>('auto');
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  // LOW-2: render-time clock derivation replaced with explicit setState +
  // setTimeout — no longer relies on incidental re-renders.
  const [savedToastVisible, setSavedToastVisible] = useState(false);
  const [llmTest, setLlmTest] = useState<{ busy: boolean; result: LlmTestResult | null }>({
    busy: false,
    result: null,
  });
  const [cleaning, setCleaning] = useState<CleanMode | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [profile, setProfile] = useState<ScoringProfile | null>(null);
  // Distinguishes the initial null (fetch in flight) from "fetch resolved
  // but profile.json is missing on disk" — the second case needs a clear
  // CTA, not a loading skeleton.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState<ProfileGenerateResult | null>(null);
  const [showRawProfile, setShowRawProfile] = useState(false);
  const [skipReview, setSkipReview] = useState(false);
  const [schedulerOp, setSchedulerOp] = useState<'install' | 'uninstall' | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [sources, setSources] = useState<SourcesResponse | null>(null);

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    const [p, s, rs, d, e, prof, src] = await Promise.all([
      api.preferences.get({ signal }),
      api.scheduler.status({ signal }),
      api.runSummary.get({ signal }),
      api.diskUsage.get({ signal }),
      api.env.get({ signal }),
      api.profile.get({ signal }),
      api.sources.get({ signal }),
    ]);
    // If any request was aborted (e.g. tab unmount mid-flight), bail — the
    // unmounted component shouldn't setState.
    const results = [p, s, rs, d, e, prof, src];
    if (results.some((r) => !r.ok && r.error.kind === 'abort')) return;
    if (p.ok) {
      setPrefs(p.value);
      setProvider(p.value.provider ?? 'auto');
    }
    setScheduler(s.ok ? s.value : null);
    setRunSummary(rs.ok ? rs.value : null);
    setDisk(d.ok ? d.value : null);
    setEnvInfo(e.ok ? e.value : null);
    setProfile(prof.ok ? (prof.value.profile ?? null) : null);
    setGenerating(prof.ok ? (prof.value.generating ?? false) : false);
    setProfileLoaded(prof.ok);
    setSources(src.ok ? src.value : null);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadAll(ctrl.signal);
    return () => ctrl.abort();
  }, [loadAll]);

  // LOW-9: refetch scheduler status whenever the App-level
  // SchedulerProgress signals completion (skip the initial 0).
  useEffect(() => {
    if (schedulerCompletedAt === 0) return;
    setSchedulerOp(null);
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.scheduler.status({ signal: ctrl.signal });
      // Non-abort failure swallowed by design — previous status stays visible.
      if (r.ok) setScheduler(r.value);
    };
    void load();
    return () => ctrl.abort();
  }, [schedulerCompletedAt]);

  const saveProvider = useCallback(async () => {
    setSavingProvider(true);
    setError(null);
    const r = await api.preferences.set({ provider });
    setSavingProvider(false);
    if (!r.ok) {
      setError(`Could not save provider: ${formatError(r.error)}`);
      return;
    }
    setPrefs(r.value);
    setSavedToastVisible(true);
    window.setTimeout(() => setSavedToastVisible(false), 3000);
    setLlmTest({ busy: false, result: null });
  }, [provider]);

  const testLlm = useCallback(async () => {
    setLlmTest({ busy: true, result: null });
    setError(null);
    const r = await api.llm.test();
    if (r.ok) {
      setLlmTest({ busy: false, result: r.value });
    } else {
      // Network/abort/parse errors surface as a synthetic failed result so
      // the LLM CLI panel keeps the single-shape render path.
      setLlmTest({
        busy: false,
        result: {
          ok: false,
          provider,
          latencyMs: 0,
          output: '',
          error: formatError(r.error),
        },
      });
    }
  }, [provider]);

  const runClean = useCallback(
    async (mode: CleanMode) => {
      setCleaning(mode);
      setCleanResult(null);
      setError(null);
      const r = await api.clean({ mode });
      setCleaning(null);
      if (!r.ok) {
        setError(`Clean failed: ${formatError(r.error)}`);
        return;
      }
      setCleanResult(r.value);
      // Refresh Settings-local panels (run summary, disk, env) AND App-level
      // state (preferences probe + jobs reload). The latter is what routes
      // the user back to the wizard after a destructive clean.
      await Promise.all([loadAll(), onCleanComplete()]);
    },
    [loadAll, onCleanComplete],
  );

  const regenerateProfile = useCallback(async () => {
    setRegenBusy(true);
    setRegenResult(null);
    setError(null);
    const r = await api.profile.generate();
    if (!r.ok) {
      setError(`Profile regeneration failed: ${formatError(r.error)}`);
      setRegenBusy(false);
      return;
    }
    // JSON-mode response either matches ProfileGenerateResult or the
    // streaming-accepted shape; only the former carries weightsChanged.
    if ('weightsChanged' in r.value) {
      setRegenResult(r.value as ProfileGenerateResult);
    }
    // Reload the profile so the UI reflects the new state. Re-uses the
    // new MED-7 { profile, generating } shape.
    const reload = await api.profile.get();
    if (reload.ok) {
      setProfile(reload.value.profile ?? null);
      setGenerating(reload.value.generating ?? false);
    }
    setRegenBusy(false);
  }, []);

  const saveSources = useCallback(async (key: string, add: string[], remove: string[]) => {
    setError(null);
    const r = await api.sources.set({ key, add, remove });
    if (!r.ok) {
      setError(`Could not save sources: ${formatError(r.error)}`);
      return;
    }
    setSources(r.value);
  }, []);

  const verifySource = useCallback(
    async (key: string, slug: string): Promise<VerifyResponse | null> => {
      const r = await api.sources.verify({ key, slug });
      return r.ok ? r.value : null;
    },
    [],
  );

  const checkSourceHealth = useCallback(async (): Promise<SourceHealthResponse | null> => {
    setError(null);
    const r = await api.sources.health();
    if (!r.ok) {
      setError(`Board health check failed: ${formatError(r.error)}`);
      return null;
    }
    return r.value;
  }, []);

  const installScheduler = useCallback(async () => {
    setError(null);
    setSchedulerOp('install');
    const r = await api.scheduler.install({ skipReview });
    // 202 is success — request() already treats it as 2xx ok.
    if (!r.ok) {
      setError(`Install failed: ${formatError(r.error)}`);
      setSchedulerOp(null);
    }
  }, [skipReview]);

  const uninstallScheduler = useCallback(async () => {
    setError(null);
    setSchedulerOp('uninstall');
    const r = await api.scheduler.uninstall();
    if (!r.ok) {
      setError(`Uninstall failed: ${formatError(r.error)}`);
      setSchedulerOp(null);
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
      body: 'This re-runs the local LLM CLI on your candidate brief and overwrites the personal weights + keyword arrays + role interests in config/profile.json (stackPrimary, w3*, ai*, roles, titleExcludedSpecialties, etc.). Universal rules (junior excludes, US-only filter, scoring config) are preserved. Takes 10–20 seconds.',
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

  return (
    <div className={styles.tab}>
      {error && (
        <div className={bannerStyles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <LlmCliPanel
        prefs={prefs}
        envInfo={envInfo}
        provider={provider}
        onProviderChange={setProvider}
        onSave={() => void saveProvider()}
        onTest={() => void testLlm()}
        savingProvider={savingProvider}
        llmTest={llmTest}
        savedToastVisible={savedToastVisible}
      />

      <SchedulerPanel
        scheduler={scheduler}
        schedulerOp={schedulerOp}
        skipReview={skipReview}
        onSkipReviewChange={setSkipReview}
        onAskInstall={askToInstall}
        onAskUninstall={askToUninstall}
        copy={copy}
        copiedSnippet={copiedSnippet}
      />

      <ScoringProfilePanel
        profile={profile}
        profileLoaded={profileLoaded}
        generating={generating}
        envInfo={envInfo}
        regenBusy={regenBusy}
        regenResult={regenResult}
        showRawProfile={showRawProfile}
        onAskRegenerate={askToRegenerateProfile}
        onToggleRaw={() => setShowRawProfile((v) => !v)}
      />

      <SourcesPanel
        sources={sources}
        onSave={saveSources}
        onVerify={verifySource}
        onCheckHealth={checkSourceHealth}
      />

      <LastRunPanel runSummary={runSummary} />

      <DiskUsagePanel disk={disk} />

      <MaintenancePanel cleaning={cleaning} cleanResult={cleanResult} onAskClean={askToClean} />

      <ApplyQueuePanel
        data={applyQueue}
        onCancel={onCancelQueueRow}
        onRefresh={() => void onRefreshQueue()}
      />

      <EnvironmentPanel envInfo={envInfo} onRefreshAll={() => void loadAll()} />

      <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}
