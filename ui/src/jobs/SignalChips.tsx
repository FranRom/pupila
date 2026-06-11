import { memo } from 'react';
import chipStyles from '../styles/Chip.module.css';
import type { JobSignals } from '../types.ts';

// Short labels for the fixed inline chips. Signals not in this map are skipped —
// they don't help the user decide fit at a glance:
//   - rawTotal / capped: meta, not signals
//   - freshness7d / freshness14d: every recent job has them
//   - locationRemote: most kept jobs are remote
//   - outOfRegionPenalty: redundant with the verdict + region filter
//   - leadTitle / seniorTitle: the senior_req hard-drop ALREADY requires
//     these, so every job in the table has them. Including them here would
//     crowd out the actually-discriminating chips (categories / stack).
// Category contributions (the most discriminating, like the old web3/ai) are
// added dynamically from `signals.categories`, labelled by id — see below.
const CHIP_LABELS: Partial<Record<keyof JobSignals, string>> = {
  stackPrimary: 'react/ts',
  stackRn: 'rn',
  stackOther: 'gql/twcss',
  roleTitle: 'role',
  roleBody: 'role body',
};

interface SignalChipsProps {
  signals: JobSignals | undefined;
  /** Maximum number of chips to render (defaults to 3). */
  max?: number;
}

/**
 * Render up to `max` chips for the strongest non-zero domain/stack signals
 * on a job. Sorted by signal value desc. Helps the user spot "why this
 * scored well" without expanding the row. Skips universal/freshness signals
 * (location, freshness, penalties) — they're noise at the row level.
 */
export const SignalChips = memo(function SignalChips({ signals, max = 3 }: SignalChipsProps) {
  if (!signals) return null;
  // Category contributions (labelled by id) + the fixed stack/role signals.
  // Only positive contributions chip — a pure-label (+0) category adds no score,
  // so it isn't a "why it scored" signal at the row level.
  const categoryChips = Object.entries(signals.categories ?? {}).map(([id, value]) => ({
    key: `cat:${id}`,
    label: id,
    value,
  }));
  const fixedChips = (Object.keys(CHIP_LABELS) as (keyof JobSignals)[]).map((k) => ({
    key: k as string,
    label: CHIP_LABELS[k] as string,
    value: signals[k] as number,
  }));
  const fired = [...categoryChips, ...fixedChips]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, max);
  if (fired.length === 0) return null;
  return (
    <>
      {fired.map((s) => (
        <span
          key={s.key}
          className={chipStyles.signal}
          title={`${s.label} contributed +${s.value} to the fit score`}
        >
          {s.label} +{s.value}
        </span>
      ))}
    </>
  );
});
