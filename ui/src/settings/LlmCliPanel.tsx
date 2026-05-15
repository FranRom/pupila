// [01] LLM CLI panel — switch + test the configured provider.

import clsx from 'clsx';
import buttonStyles from '../styles/Button.module.css';
import styles from './LlmCliPanel.module.css';
import { ProviderChip, Section, SkeletonRows, settingsStyles } from './shared.tsx';
import {
  type EnvInfo,
  type LlmTestResult,
  PROVIDERS,
  type PreferencesResponse,
  type ProviderChoice,
} from './types.ts';

interface LlmCliPanelProps {
  prefs: PreferencesResponse | null;
  envInfo: EnvInfo | null;
  provider: ProviderChoice;
  onProviderChange: (next: ProviderChoice) => void;
  onSave: () => void;
  onTest: () => void;
  savingProvider: boolean;
  llmTest: { busy: boolean; result: LlmTestResult | null };
  // LOW-2: render-time clock derivation replaced with explicit setState +
  // setTimeout — no longer relies on incidental re-renders.
  savedToastVisible: boolean;
}

export function LlmCliPanel({
  prefs,
  envInfo,
  provider,
  onProviderChange,
  onSave,
  onTest,
  savingProvider,
  llmTest,
  savedToastVisible,
}: LlmCliPanelProps) {
  const detectedAny = envInfo ? PROVIDERS.some((p) => envInfo.providers[p]) : false;
  return (
    <Section
      index="01"
      title="LLM CLI"
      subtitle="Local CLI used for the CV summary, AI review, and AI Apply."
      meta={
        prefs?.provider ? (
          <ProviderChip provider={prefs.provider} />
        ) : (
          <span className={clsx(settingsStyles.pill, settingsStyles.pillWarn)}>not set</span>
        )
      }
    >
      {!envInfo ? (
        <SkeletonRows count={5} />
      ) : (
        <ul className={styles.providerList}>
          <li>
            <label>
              <input
                type="radio"
                name="settings-provider"
                value="auto"
                checked={provider === 'auto'}
                onChange={() => onProviderChange('auto')}
              />
              <strong>Auto-detect</strong>
              <span className={styles.muted}>
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
                  onChange={() => onProviderChange(p)}
                  disabled={!envInfo.providers[p]}
                />
                <strong>{p}</strong>
                <span className={envInfo.providers[p] ? styles.available : styles.unavailable}>
                  {envInfo.providers[p] ? '✓ installed' : '✗ not on PATH'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!detectedAny && envInfo && (
        <p className={styles.warn}>
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
      <div className={settingsStyles.actions}>
        <button
          type="button"
          className={buttonStyles.secondary}
          disabled={savingProvider || !envInfo}
          onClick={onSave}
        >
          {savingProvider ? 'Saving…' : 'Save provider'}
        </button>
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={llmTest.busy || !detectedAny}
          onClick={onTest}
        >
          {llmTest.busy ? 'Testing…' : 'Test connection'}
        </button>
        {savedToastVisible && <span className={settingsStyles.toast}>✓ saved</span>}
      </div>
      {llmTest.result && <LlmTestResultPanel result={llmTest.result} />}
    </Section>
  );
}

function LlmTestResultPanel({ result }: { result: LlmTestResult }) {
  const tierClass = !result.ok
    ? styles.resultFail
    : result.latencyMs <= 3000
      ? styles.resultFast
      : result.latencyMs <= 10_000
        ? styles.resultMid
        : styles.resultSlow;
  return (
    <div className={tierClass}>
      {result.ok ? (
        <>
          <div className={styles.resultHead}>
            <strong>✓ {result.provider}</strong>
            <span className={styles.muted}>{result.latencyMs}ms</span>
          </div>
          <pre>{result.output}</pre>
        </>
      ) : (
        <>
          <div className={styles.resultHead}>
            <strong>✗ {result.provider} failed</strong>
          </div>
          <pre>{result.error ?? 'unknown error'}</pre>
        </>
      )}
    </div>
  );
}
