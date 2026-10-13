// [01] LLM panel — switch + test the configured provider / Ollama model.

import clsx from 'clsx';
import { OllamaModelGroup } from '../components/OllamaModelGroup.tsx';
import buttonStyles from '../styles/Button.module.css';
import styles from './LlmCliPanel.module.css';
import {
  ProviderChip,
  type ProviderChipLabel,
  Section,
  SkeletonRows,
  settingsStyles,
} from './shared.tsx';
import {
  type EnvInfo,
  type LlmTestResult,
  PROVIDER_META,
  PROVIDERS,
  type PreferencesResponse,
  type Provider,
  type ProviderChoice,
} from './types.ts';

interface LlmCliPanelProps {
  prefs: PreferencesResponse | null;
  envInfo: EnvInfo | null;
  provider: ProviderChoice;
  ollamaModel: string | null;
  onProviderChange: (next: ProviderChoice) => void;
  onOllamaModelChange: (next: string | null) => void;
  onSave: () => void;
  onTest: () => void;
  savingProvider: boolean;
  llmTest: { busy: boolean; result: LlmTestResult | null };
  // LOW-2: render-time clock derivation replaced with explicit setState +
  // setTimeout — no longer relies on incidental re-renders.
  savedToastVisible: boolean;
}

const CLI_PROVIDERS = PROVIDERS.filter((p): p is Exclude<Provider, 'ollama'> => p !== 'ollama');

export function LlmCliPanel({
  prefs,
  envInfo,
  provider,
  ollamaModel,
  onProviderChange,
  onOllamaModelChange,
  onSave,
  onTest,
  savingProvider,
  llmTest,
  savedToastVisible,
}: LlmCliPanelProps) {
  const detectedAny = envInfo
    ? CLI_PROVIDERS.some((p) => envInfo.providers[p]) ||
      (envInfo.providers.ollama && envInfo.ollamaModels.length > 0)
    : false;
  const canSave = provider !== 'ollama' || Boolean(ollamaModel);
  // A saved model can disappear (`ollama rm`); say so instead of showing
  // an Ollama selection with no radio checked.
  const missingModel =
    envInfo?.providers.ollama && ollamaModel && !envInfo.ollamaModels.includes(ollamaModel)
      ? ollamaModel
      : null;
  const chipLabel: ProviderChipLabel | undefined =
    prefs?.provider === 'ollama' && prefs.ollamaModel
      ? `ollama/${prefs.ollamaModel}`
      : (prefs?.provider ?? undefined);

  return (
    <Section
      index="01"
      title="LLM"
      subtitle="Local CLI or Ollama model used for the CV summary, AI review, and AI Apply."
      meta={
        chipLabel ? (
          <ProviderChip provider={chipLabel} />
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
                — first installed in claude → codex → gemini → opencode → ollama
              </span>
            </label>
          </li>
          {CLI_PROVIDERS.map((p) => (
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
                <strong>{PROVIDER_META[p].label}</strong>
                <span className={envInfo.providers[p] ? styles.available : styles.unavailable}>
                  {envInfo.providers[p] ? '✓ installed' : '✗ not on PATH'}
                </span>
              </label>
            </li>
          ))}
          <OllamaModelGroup
            header={
              <>
                <strong>{PROVIDER_META.ollama.label}</strong>
                <span className={envInfo.providers.ollama ? styles.available : styles.unavailable}>
                  {envInfo.providers.ollama ? '✓ installed' : '✗ not on PATH'}
                </span>
              </>
            }
            radioName="settings-provider"
            models={envInfo.providers.ollama ? envInfo.ollamaModels : []}
            selected={provider === 'ollama' ? ollamaModel : null}
            onSelect={(name) => {
              onProviderChange('ollama');
              onOllamaModelChange(name);
            }}
          >
            {envInfo.providers.ollama && envInfo.ollamaModels.length === 0 && (
              <p className={styles.muted}>
                No models pulled. Run <code>ollama pull &lt;model&gt;</code>, then reload Settings.
              </p>
            )}
            {missingModel && (
              <p className={styles.warn}>
                Saved model <code>{missingModel}</code> is no longer pulled. Pick another model, or
                run <code>ollama pull {missingModel}</code> and reload Settings.
              </p>
            )}
            {provider === 'auto' && ollamaModel && !missingModel && (
              <p className={styles.muted}>
                <code>{ollamaModel}</code> is used if auto-detect falls back to Ollama.
              </p>
            )}
          </OllamaModelGroup>
        </ul>
      )}
      {!detectedAny && envInfo && (
        <p className={styles.warn}>
          No supported LLM CLI or Ollama model found. Install a CLI (e.g.{' '}
          <a
            href="https://docs.claude.com/en/docs/claude-code/quickstart"
            target="_blank"
            rel="noopener noreferrer"
          >
            Claude Code
          </a>
          ) or pull an Ollama model to enable AI features.
        </p>
      )}
      <div className={settingsStyles.actions}>
        <button
          type="button"
          className={buttonStyles.secondary}
          disabled={savingProvider || !envInfo || !canSave}
          onClick={onSave}
        >
          {savingProvider ? 'Saving…' : 'Save provider'}
        </button>
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={llmTest.busy || !detectedAny || !canSave}
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
