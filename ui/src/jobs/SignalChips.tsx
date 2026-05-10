import type { JobSignals } from '../types.ts';

// Short labels for the inline chips. Signals not in this map are skipped —
// they don't help the user decide fit at a glance:
//   - rawTotal / capped: meta, not signals
//   - freshness7d / freshness14d: every recent job has them
//   - locationRemote: most kept jobs are remote
//   - usCentricPenalty: redundant with the verdict + EMEA filter
//   - leadTitle / seniorTitle: the senior_req hard-drop ALREADY requires
//     these, so every job in the table has them. Including them here would
//     crowd out the actually-discriminating chips (web3/ai/stack).
const CHIP_LABELS: Partial<Record<keyof JobSignals, string>> = {
  web3TitleBody: 'web3',
  web3Stack: 'web3 stack',
  aiTitleBody: 'ai',
  aiStack: 'ai stack',
  stackPrimary: 'react/ts',
  stackRn: 'rn',
  stackOther: 'gql/twcss',
  frontendTitle: 'frontend',
  frontendBody: 'frontend body',
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
export function SignalChips({ signals, max = 3 }: SignalChipsProps) {
  if (!signals) return null;
  const fired = (Object.keys(CHIP_LABELS) as (keyof JobSignals)[])
    .map((k) => ({ key: k, label: CHIP_LABELS[k] as string, value: signals[k] as number }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, max);
  if (fired.length === 0) return null;
  return (
    <>
      {fired.map((s) => (
        <span
          key={s.key}
          className="signal-chip"
          title={`${s.label} contributed +${s.value} to the fit score`}
        >
          {s.label} +{s.value}
        </span>
      ))}
    </>
  );
}
