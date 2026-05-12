// Tiny 48x48 SVG donut indicator used in the swipe-card header.
// The wrapping <div className="fit-donut"> already has the -90deg
// rotation in CSS — we draw the arc starting at the 3 o'clock position
// and let the CSS rotation move 0% to the 12 o'clock position.

interface FitDonutProps {
  score: number;
}

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function tierClass(score: number): string {
  if (score >= 80) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

export function FitDonut({ score }: FitDonutProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);
  const label = Math.round(clamped);

  return (
    <div className="fit-donut">
      <svg viewBox="0 0 48 48" role="img" aria-label={`Fit score ${label} of 100`}>
        <title>{`Fit score ${label}`}</title>
        <circle className="fit-donut-bg" cx="24" cy="24" r={RADIUS} />
        <circle
          className={`fit-donut-fg ${tierClass(clamped)}`}
          cx="24"
          cy="24"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="fit-donut-label">{label}</span>
    </div>
  );
}
