// [04] Last run panel — stats parsed from data/jobs.json.

import { relativeTime } from '../format.ts';
import { EmptyState, Section, SkeletonRows, Stat } from './shared.tsx';
import type { RunSummary } from './types.ts';

interface LastRunPanelProps {
  runSummary: RunSummary | null;
}

export function LastRunPanel({ runSummary }: LastRunPanelProps) {
  return (
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
  );
}
