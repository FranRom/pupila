import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from './settings/ConfirmModal.tsx';
import { DiskUsagePanel } from './settings/DiskUsagePanel.tsx';
import { EnvironmentPanel } from './settings/EnvironmentPanel.tsx';
import { LastRunPanel } from './settings/LastRunPanel.tsx';
import { LlmCliPanel } from './settings/LlmCliPanel.tsx';
import { MaintenancePanel } from './settings/MaintenancePanel.tsx';
import { SchedulerPanel } from './settings/SchedulerPanel.tsx';
import { ScoringProfilePanel } from './settings/ScoringProfilePanel.tsx';
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
  type ProfileGetResponse,
  type ProviderChoice,
  type RunSummary,
  type SchedulerStatus,
  type ScoringProfile,
} from './settings/types.ts';

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
// LOW-9: SchedulerProgress is now mounted at the App level (sibling of the
// tab router) so the docked-card persists across tab switches. Settings
// receives `schedulerCompletedAt` and refetches scheduler status whenever
// it ticks.

interface SettingsProps {
  schedulerCompletedAt: number;
}

export function Settings({ schedulerCompletedAt }: SettingsProps) {
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
  const [generating, setGenerating] = useState(false);
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
      grab<ProfileGetResponse>('/api/profile'),
    ]);
    if (p) {
      setPrefs(p);
      setProvider(p.provider ?? 'auto');
    }
    setScheduler(s);
    setRunSummary(rs);
    setDisk(d);
    setEnvInfo(e);
    setProfile(prof?.profile ?? null);
    setGenerating(prof?.generating ?? false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // LOW-9: refetch scheduler status whenever the App-level
  // SchedulerProgress signals completion (skip the initial 0).
  useEffect(() => {
    if (schedulerCompletedAt === 0) return;
    setSchedulerOp(null);
    void fetch('/api/scheduler-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) setScheduler(s as SchedulerStatus);
      })
      .catch(() => {});
  }, [schedulerCompletedAt]);

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
      setSavedToastVisible(true);
      window.setTimeout(() => setSavedToastVisible(false), 3000);
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
      // Reload the profile so the UI reflects the new state. Re-uses the
      // new MED-7 { profile, generating } shape.
      const r = await fetch('/api/profile');
      if (r.ok) {
        const next = (await r.json()) as ProfileGetResponse;
        setProfile(next.profile ?? null);
        setGenerating(next.generating ?? false);
      }
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
        generating={generating}
        envInfo={envInfo}
        regenBusy={regenBusy}
        regenResult={regenResult}
        showRawProfile={showRawProfile}
        onAskRegenerate={askToRegenerateProfile}
        onToggleRaw={() => setShowRawProfile((v) => !v)}
      />

      <LastRunPanel runSummary={runSummary} />

      <DiskUsagePanel disk={disk} />

      <MaintenancePanel cleaning={cleaning} cleanResult={cleanResult} onAskClean={askToClean} />

      <EnvironmentPanel envInfo={envInfo} onRefreshAll={() => void loadAll()} />

      <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}
