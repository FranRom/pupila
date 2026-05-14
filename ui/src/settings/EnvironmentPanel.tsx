// [07] Environment panel — runtime + filesystem state for debugging.

import clsx from 'clsx';
import buttonStyles from '../styles/Button.module.css';
import styles from './EnvironmentPanel.module.css';
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
          className={clsx(buttonStyles.primary, buttonStyles.sm)}
          onClick={onRefreshAll}
        >
          Refresh all
        </button>
      }
    >
      {!envInfo ? (
        <SkeletonRows count={5} />
      ) : (
        <dl className={styles.grid}>
          <dt>Node</dt>
          <dd className={styles.mono}>{envInfo.node}</dd>
          <dt>Platform</dt>
          <dd className={styles.mono}>{envInfo.platform}</dd>
          <dt>Repo</dt>
          <dd className={styles.mono}>{envInfo.repoRoot}</dd>
          <dt>Brief</dt>
          <dd>
            {envInfo.briefPresent ? (
              <span className={styles.badgeOk}>✓ present</span>
            ) : (
              <span className={styles.badgeMissing}>✗ missing</span>
            )}
          </dd>
          <dt>CV file</dt>
          <dd>
            {envInfo.cvPresent ? (
              <span className={styles.badgeOk}>✓ present</span>
            ) : (
              <span className={styles.badgeMissing}>✗ missing</span>
            )}
          </dd>
          <dt>Providers</dt>
          <dd>
            {PROVIDERS.map((p) => (
              <span
                key={p}
                className={envInfo.providers[p] ? styles.providerOk : styles.providerMissing}
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
