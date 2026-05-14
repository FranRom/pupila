interface ScoreBarProps {
  score: number;
  /** Tier class to colour the fill: matches scoreTier() in App.tsx. */
  tier: 'score-high' | 'score-mid' | 'score-low';
}

/**
 * Renders a compact horizontal bar showing the fit score (0–100) plus the
 * numeric value. The bar fill width tracks the score; colour comes from
 * the tier class so it matches the existing colour ramp.
 */
export function ScoreBar({ score, tier }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className="score-bar" role="img" aria-label={`fit score ${score} of 100`}>
      <span className={`score-bar-num ${tier}`}>{score}</span>
      <span className="score-bar-track">
        <span className={`score-bar-fill ${tier}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
