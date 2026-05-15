// [06] Maintenance panel — clean / clean:onboarding / clean:all.

import buttonStyles from '../styles/Button.module.css';
import styles from './MaintenancePanel.module.css';
import { Section } from './shared.tsx';
import { CLEAN_MODES, type CleanMode, type CleanModeMeta, type CleanResult } from './types.ts';

interface MaintenancePanelProps {
  cleaning: CleanMode | null;
  cleanResult: CleanResult | null;
  onAskClean: (mode: CleanMode) => void;
}

export function MaintenancePanel({ cleaning, cleanResult, onAskClean }: MaintenancePanelProps) {
  return (
    <Section
      index="06"
      title="Maintenance"
      subtitle="Reset local state. Each action shows a confirmation before it runs."
    >
      <div className={styles.list}>
        {(Object.keys(CLEAN_MODES) as CleanMode[]).map((mode) => {
          const meta = CLEAN_MODES[mode];
          return (
            <MaintenanceRow
              key={mode}
              meta={meta}
              busy={cleaning === mode}
              disabled={cleaning !== null}
              onClick={() => onAskClean(mode)}
            />
          );
        })}
      </div>
      {cleanResult && (
        <pre className={styles.output}>
          {cleanResult.output ||
            (cleanResult.ok ? 'done.' : `(no output, exit ${cleanResult.exitCode})`)}
        </pre>
      )}
    </Section>
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
    <div className={meta.destructive ? styles.rowDanger : styles.row}>
      <div className={styles.text}>
        <code className={styles.label}>{meta.command}</code>
        <p className={styles.muted}>{meta.shortDesc}</p>
      </div>
      <button
        type="button"
        className={meta.destructive ? buttonStyles.danger : buttonStyles.primary}
        disabled={disabled}
        onClick={onClick}
      >
        {busy ? 'Running…' : meta.destructive ? 'Run (destructive)' : 'Run'}
      </button>
    </div>
  );
}
