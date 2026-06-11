import clsx from 'clsx';
import type { JobSignals } from '../types.ts';
import styles from './SignalsList.module.css';

// Fixed, universal signals. Category contributions are dynamic (keyed by id)
// and rendered separately — see `signals.categories`.
const SIGNAL_LABELS: Record<
  Exclude<keyof JobSignals, 'categories' | 'rawTotal' | 'capped'>,
  string
> = {
  stackPrimary: 'React/Next/TS',
  stackRn: 'React Native',
  stackOther: 'GraphQL/Tailwind/Vite',
  leadTitle: 'lead title',
  seniorTitle: 'senior title',
  roleTitle: 'role title',
  roleBody: 'role body',
  locationRemote: 'remote-friendly',
  freshness7d: 'fresh ≤7d',
  freshness14d: 'fresh ≤14d',
  outOfRegionPenalty: 'out-of-region penalty',
};

export function SignalsList({ signals }: { signals: JobSignals }) {
  // Matched categories first (most discriminating). Shown even at +0 — a
  // pure-label category contributes nothing to the score but still tells the
  // user the job was tagged. Then the fixed signals that fired.
  const categoryRows = Object.entries(signals.categories ?? {}).map(([id, value]) => ({
    key: `cat:${id}`,
    label: id,
    value,
  }));
  const fixedRows = (Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>)
    .map((k) => ({ key: k as string, label: SIGNAL_LABELS[k], value: signals[k] }))
    .filter((s) => s.value !== 0);
  const fired = [...categoryRows, ...fixedRows];
  return (
    <ul className={styles.list}>
      {fired.map((s) => (
        <li key={s.key}>
          <span className={styles.label}>{s.label}</span>
          <span className={clsx(s.value > 0 && styles.pos, s.value < 0 && styles.neg)}>
            {s.value > 0 ? '+' : ''}
            {s.value}
          </span>
        </li>
      ))}
      <li className={styles.total}>
        <span className={styles.label}>raw total</span>
        <span>{signals.rawTotal}</span>
      </li>
      {signals.capped && <li className={clsx(styles.total, styles.muted)}>(capped at 100)</li>}
    </ul>
  );
}
