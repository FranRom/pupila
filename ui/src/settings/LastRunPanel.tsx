// [04] Last run panel — stats parsed from data/jobs.json.

import clsx from 'clsx';
import { relativeTime } from '../format.ts';
import styles from './LastRunPanel.module.css';
import { EmptyState, Section, SkeletonRows, Stat, settingsStyles } from './shared.tsx';
import type { RunSummary } from './types.ts';

interface LastRunPanelProps {
  runSummary: RunSummary | null;
}

export function LastRunPanel({ runSummary }: LastRunPanelProps) {
  const stale = runSummary?.ageHours !== null && (runSummary?.ageHours ?? 0) >= 24;
  return (
    <Section
      index="04"
      title="Last run"
      subtitle="Snapshot of the most recent aggregator output."
      meta={
        runSummary?.generatedAt ? (
          <span
            className={clsx(
              settingsStyles.pill,
              stale ? settingsStyles.pillWarn : settingsStyles.pillOk,
            )}
          >
            {relativeTime(runSummary.generatedAt)}
            {stale ? ' · stale' : ''}
          </span>
        ) : null
      }
    >
      {!runSummary ? (
        <SkeletonRows count={3} />
      ) : runSummary.total > 0 ? (
        <>
          <div className={styles.totals}>
            <Stat label="Kept" value={runSummary.total.toLocaleString()} accent />
            {Object.entries(runSummary.byCategory)
              .filter(([, n]) => n > 0)
              .map(([id, n]) => (
                <Stat key={id} label={id} value={n.toLocaleString()} />
              ))}
          </div>
          <ul className={styles.sourceList}>
            {runSummary.bySource.map((s) => (
              <li key={s.name} className={s.kept === 0 ? styles.sourceRowEmpty : styles.sourceRow}>
                <span className={styles.sourceName}>{s.name}</span>
                <span className={styles.sourceKept}>{s.kept === 0 ? '🚨 0' : s.kept}</span>
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
  );
}
