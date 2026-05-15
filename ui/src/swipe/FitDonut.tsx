// Tiny 48x48 SVG donut indicator used in the swipe-card header.
// The wrapping <div> rotates -90deg via CSS so the arc starts at the
// 12 o'clock position even though we draw it from 3 o'clock.

import clsx from 'clsx';
import type { ScoreTier } from '../jobs/ScoreBar.tsx';
import styles from './FitDonut.module.css';

interface FitDonutProps {
  score: number;
}

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const FG_TIER = {
  high: styles.fgHigh,
  mid: styles.fgMid,
  low: styles.fgLow,
} as const;

function tier(score: number): ScoreTier {
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

export function FitDonut({ score }: FitDonutProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);
  const label = Math.round(clamped);

  return (
    <div className={styles.donut}>
      <svg viewBox="0 0 48 48" role="img" aria-label={`Fit score ${label} of 100`}>
        <title>{`Fit score ${label}`}</title>
        <circle className={styles.bg} cx="24" cy="24" r={RADIUS} />
        <circle
          className={clsx(styles.fg, FG_TIER[tier(clamped)])}
          cx="24"
          cy="24"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
