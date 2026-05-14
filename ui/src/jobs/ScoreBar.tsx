import clsx from 'clsx';
import { memo } from 'react';
import styles from './ScoreBar.module.css';

export type ScoreTier = 'high' | 'mid' | 'low';

interface ScoreBarProps {
  score: number;
  /** Tier identifier driving the fill + number colour. Computed in App.tsx. */
  tier: ScoreTier;
}

const NUM_TIER = {
  high: styles.numHigh,
  mid: styles.numMid,
  low: styles.numLow,
} as const;

const FILL_TIER = {
  high: styles.fillHigh,
  mid: styles.fillMid,
  low: styles.fillLow,
} as const;

/**
 * Renders a compact horizontal bar showing the fit score (0–100) plus the
 * numeric value. The bar fill width tracks the score; colour comes from
 * the tier so it matches the existing colour ramp.
 */
export const ScoreBar = memo(function ScoreBar({ score, tier }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className={styles.bar} role="img" aria-label={`fit score ${score} of 100`}>
      <span className={clsx(styles.num, NUM_TIER[tier])}>{score}</span>
      <span className={styles.track}>
        <span className={clsx(styles.fill, FILL_TIER[tier])} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
});
