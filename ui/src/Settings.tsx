import { useCallback, useEffect, useState } from 'react';
import { formatBytes, relativeTime } from './format.ts';

// Settings tab. Six panels:
//   1. LLM CLI       — switch + test the configured provider
//   2. Scheduler     — read-only: launchd/cron registration + last run
//   3. Last run      — stats parsed from data/jobs.json
//   4. Disk usage    — bytes/files for data/raw, data/applications, data/archive
//   5. Maintenance   — clean / clean:all / clean:onboarding (with confirms)
//   6. Environment   — node version, repo path, brief/cv presence, providers
//
// All read APIs are GET; all writes (provider switch, clean) require an
// explicit user gesture. No auto-trigger logic here.

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

const CLEAN_DESCRIPTIONS: Record<'default' | 'all' | 'onboarding', string> = {
  default:
    'Wipe generated artifacts (jobs.json, JOBS.md, feed.xml, raw dumps, archive, logs). Keeps brief + applied.json.',
  all: 'Wipe everything above PLUS your candidate brief and applied.json — full reset.',
  onboarding:
    'Wipe preferences + brief + raw CV. Keeps jobs.json and applied.json. The first-run wizard will re-trigger.',
};

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
  const [cleaning, setCleaning] = useState<'default' | 'all' | 'onboarding' | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);

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
    const [p, s, rs, d, e] = await Promise.all([
      grab<PreferencesResponse>('/api/preferences'),
      grab<SchedulerStatus>('/api/scheduler-status'),
      grab<RunSummary>('/api/run-summary'),
      grab<DiskUsage>('/api/disk-usage'),
      grab<EnvInfo>('/api/env'),
    ]);
    if (p) {
      setPrefs(p);
      setProvider(p.provider ?? 'auto');
    }
    setScheduler(s);
    setRunSummary(rs);
    setDisk(d);
    setEnvInfo(e);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
    async (mode: 'default' | 'all' | 'onboarding') => {
      const ok = window.confirm(
        `Run pnpm run clean${mode === 'default' ? '' : `:${mode}`}?\n\n${CLEAN_DESCRIPTIONS[mode]}`,
      );
      if (!ok) return;
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
        // Reload everything that might have changed.
        await loadAll();
      } catch (err) {
        setError(`Clean failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setCleaning(null);
      }
    },
    [loadAll],
  );

  const showSavedToast = providerSavedAt && Date.now() - providerSavedAt < 3000;
  const detectedAny = envInfo ? PROVIDERS.some((p) => envInfo.providers[p]) : false;

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

      {/* 1. LLM CLI */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>LLM CLI</h2>
          <span className="muted">
            Currently using: <strong>{prefs?.provider ?? 'unknown'}</strong>
          </span>
        </header>
        {!envInfo ? (
          <p className="placeholder">Probing installed CLIs…</p>
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
            No supported LLM CLI found on PATH. Install one (e.g.{' '}
            <a
              href="https://docs.claude.com/en/docs/claude-code/quickstart"
              target="_blank"
              rel="noopener noreferrer"
            >
              Claude Code
            </a>
            ) to use AI Apply, AI review, and the CV summarizer.
          </p>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="settings-button"
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
      </section>

      {/* 2. Scheduler */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>Scheduler</h2>
          <span className="muted">
            {scheduler ? `${scheduler.platform} · read-only` : 'loading…'}
          </span>
        </header>
        {scheduler && (
          <>
            <div className="scheduler-grid">
              <SchedulerRow
                label="Aggregator"
                installed={scheduler.installed.aggregate}
                lastRun={scheduler.lastRun.aggregate}
              />
              <SchedulerRow
                label="AI review"
                installed={scheduler.installed.review}
                lastRun={scheduler.lastRun.review}
              />
            </div>
            {(!scheduler.installed.aggregate || !scheduler.installed.review) && (
              <div className="settings-snippet">
                <p className="muted">
                  Install with <code>{scheduler.installCmd}</code> (run from the repo root).
                </p>
              </div>
            )}
            {(scheduler.installed.aggregate || scheduler.installed.review) && (
              <div className="settings-snippet">
                <p className="muted">
                  Uninstall with <code>{scheduler.uninstallCmd}</code>.
                </p>
              </div>
            )}
            {scheduler.platform === 'other' && (
              <p className="warn">
                Unknown platform — only macOS and Linux scheduler scripts are bundled.
              </p>
            )}
          </>
        )}
      </section>

      {/* 3. Last run */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>Last run</h2>
          <span className="muted">
            {runSummary?.generatedAt
              ? `${relativeTime(runSummary.generatedAt)}${
                  runSummary.ageHours !== null && runSummary.ageHours >= 24 ? ' ⚠️ stale' : ''
                }`
              : 'no run yet'}
          </span>
        </header>
        {runSummary && runSummary.total > 0 ? (
          <>
            <div className="run-summary-totals">
              <Stat label="Total kept" value={runSummary.total.toLocaleString()} />
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
          <p className="placeholder">
            jobs.json is empty — run the aggregator from the Jobs tab or wait for the daily cron.
          </p>
        )}
      </section>

      {/* 4. Disk usage */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>Disk usage</h2>
          <span className="muted">
            {disk ? `${formatBytes(disk.total.bytes)} · ${disk.total.files} files` : 'loading…'}
          </span>
        </header>
        {disk && (
          <ul className="disk-list">
            <DiskRow
              label="data/raw"
              bucket={disk.raw}
              note="per-source raw dumps from each fetch"
            />
            <DiskRow
              label="data/applications"
              bucket={disk.applications}
              note="AI Apply markdown packages"
            />
            <DiskRow
              label="data/archive"
              bucket={disk.archive}
              note="month-end snapshots of jobs.json"
            />
          </ul>
        )}
      </section>

      {/* 5. Maintenance */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>Maintenance</h2>
        </header>
        <div className="maintenance-list">
          <MaintenanceRow
            label="pnpm run clean"
            description={CLEAN_DESCRIPTIONS.default}
            busy={cleaning === 'default'}
            disabled={cleaning !== null}
            onClick={() => void runClean('default')}
          />
          <MaintenanceRow
            label="pnpm run clean:onboarding"
            description={CLEAN_DESCRIPTIONS.onboarding}
            busy={cleaning === 'onboarding'}
            disabled={cleaning !== null}
            onClick={() => void runClean('onboarding')}
          />
          <MaintenanceRow
            label="pnpm run clean (--all)"
            description={CLEAN_DESCRIPTIONS.all}
            danger
            busy={cleaning === 'all'}
            disabled={cleaning !== null}
            onClick={() => void runClean('all')}
          />
        </div>
        {cleanResult && (
          <pre className="settings-clean-output">
            {cleanResult.output ||
              (cleanResult.ok ? 'done.' : `(no output, exit ${cleanResult.exitCode})`)}
          </pre>
        )}
      </section>

      {/* 6. Environment */}
      <section className="settings-section">
        <header className="settings-section-header">
          <h2>Environment</h2>
          <button
            type="button"
            className="settings-button settings-button-secondary settings-button-small"
            onClick={() => void loadAll()}
          >
            Refresh
          </button>
        </header>
        {envInfo && (
          <dl className="env-grid">
            <dt>Node</dt>
            <dd className="mono">{envInfo.node}</dd>
            <dt>Platform</dt>
            <dd className="mono">{envInfo.platform}</dd>
            <dt>Repo</dt>
            <dd className="mono">{envInfo.repoRoot}</dd>
            <dt>Brief</dt>
            <dd>{envInfo.briefPresent ? '✓ present' : '✗ missing'}</dd>
            <dt>CV file</dt>
            <dd>{envInfo.cvPresent ? '✓ present' : '✗ missing'}</dd>
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
      </section>
    </div>
  );
}

function SchedulerRow({
  label,
  installed,
  lastRun,
}: {
  label: string;
  installed: boolean;
  lastRun: string | null;
}) {
  return (
    <div className="scheduler-row">
      <span className="scheduler-label">{label}</span>
      <span className={`scheduler-pill scheduler-pill-${installed ? 'on' : 'off'}`}>
        {installed ? 'loaded' : 'not loaded'}
      </span>
      <span className="scheduler-lastrun">
        {lastRun ? `last run ${relativeTime(lastRun)}` : '—'}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-chip">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function DiskRow({ label, bucket, note }: { label: string; bucket: DiskBucket; note: string }) {
  return (
    <li className="disk-row">
      <span className="disk-label mono">{label}</span>
      <span className="disk-size">{formatBytes(bucket.bytes)}</span>
      <span className="disk-files muted">{bucket.files} files</span>
      <span className="disk-note muted">{note}</span>
    </li>
  );
}

interface MaintenanceRowProps {
  label: string;
  description: string;
  danger?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function MaintenanceRow({
  label,
  description,
  danger,
  busy,
  disabled,
  onClick,
}: MaintenanceRowProps) {
  return (
    <div className="maintenance-row">
      <div className="maintenance-text">
        <code className="maintenance-label">{label}</code>
        <p className="muted">{description}</p>
      </div>
      <button
        type="button"
        className={`settings-button ${danger ? 'settings-button-danger' : 'settings-button-secondary'}`}
        disabled={disabled}
        onClick={onClick}
      >
        {busy ? 'Running…' : danger ? 'Run (destructive)' : 'Run'}
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
          <strong>✓ {result.provider}</strong>
          <span className="muted"> · {result.latencyMs}ms</span>
          <pre>{result.output}</pre>
        </>
      ) : (
        <>
          <strong>✗ {result.provider} failed</strong>
          <pre>{result.error ?? 'unknown error'}</pre>
        </>
      )}
    </div>
  );
}
