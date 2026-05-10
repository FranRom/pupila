// [07] Environment panel — runtime + filesystem state for debugging.

import { Section, SkeletonRows } from './shared.tsx';
import { type EnvInfo, PROVIDERS } from './types.ts';

interface EnvironmentPanelProps {
  envInfo: EnvInfo | null;
  onRefreshAll: () => void;
}

export function EnvironmentPanel({ envInfo, onRefreshAll }: EnvironmentPanelProps) {
  return (
    <Section
      index="07"
      title="Environment"
      subtitle="Runtime + filesystem state for debugging."
      action={
        <button
          type="button"
          className="settings-button settings-button-secondary settings-button-small"
          onClick={onRefreshAll}
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
  );
}
