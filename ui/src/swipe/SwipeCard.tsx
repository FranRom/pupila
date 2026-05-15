import clsx from 'clsx';
import { relativeTime } from '../format.ts';
import chipStyles from '../styles/Chip.module.css';
import type { Job } from '../types.ts';
import { FitDonut } from './FitDonut.tsx';
import styles from './SwipeCard.module.css';
import type { SwipeAction } from './types.ts';
import { useSwipeGesture } from './useSwipeGesture.ts';

// The visible swipe card. Stateless w.r.t. the deck — gestures are owned
// by useSwipeGesture; the parent decides what to do on commit. Body is
// rendered as plain pre-wrap text (the API has already stripped HTML).

interface SwipeCardProps {
  job: Job;
  body: string;
  onSwipe: (action: SwipeAction) => void;
  leaving?: 'left' | 'right' | null;
}

function pickDisplayBody(body: string, job: Job): string {
  const trimmed = body.trim();
  if (trimmed.length > 0) return body;
  if (job.bodyPreview && job.bodyPreview.trim().length > 0) return job.bodyPreview;
  return 'No description available.';
}

export function SwipeCard({ job, body, onSwipe, leaving }: SwipeCardProps) {
  const { cardProps, dragging, direction } = useSwipeGesture({
    onSwipe,
    enabled: !leaving,
  });

  const className = clsx(
    styles.card,
    dragging && styles.isSwiping,
    direction === 'left' && styles.directionLeft,
    direction === 'right' && styles.directionRight,
    leaving === 'left' && styles.leavingLeft,
    leaving === 'right' && styles.leavingRight,
  );

  const visibleTags = job.tags.slice(0, 6);

  return (
    <div
      className={className}
      style={cardProps.style}
      onPointerDown={cardProps.onPointerDown}
      onPointerMove={cardProps.onPointerMove}
      onPointerUp={cardProps.onPointerUp}
      onPointerCancel={cardProps.onPointerCancel}
    >
      <div className={styles.stampSkip} aria-hidden>
        SKIP
      </div>

      <div className={styles.header}>
        <div className={styles.company}>{job.company ?? '—'}</div>
        <FitDonut score={job.fitScore} />
      </div>

      <h2 className={styles.title}>{job.title}</h2>

      <div className={styles.meta}>
        {job.location ? <span>{job.location}</span> : null}
        <span>{job.source}</span>
        <span>{relativeTime(job.postedAt)}</span>
      </div>

      <div className={styles.body}>{pickDisplayBody(body, job)}</div>

      {visibleTags.length > 0 ? (
        <div className={styles.tags}>
          {visibleTags.map((tag) => (
            <span className={chipStyles.signal} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
