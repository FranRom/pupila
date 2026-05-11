import { relativeTime } from '../format.ts';
import type { Job } from '../types.ts';
import { FitDonut } from './FitDonut.tsx';
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
  const { cardProps } = useSwipeGesture({
    onSwipe,
    enabled: !leaving,
  });

  const leavingClass = leaving ? `swipe-leaving-${leaving}` : '';
  const className = ['swipe-card', cardProps.className, leavingClass].filter(Boolean).join(' ');

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
      <div className="swipe-card-header">
        <div className="swipe-card-company">{job.company ?? '—'}</div>
        <FitDonut score={job.fitScore} />
      </div>

      <h2 className="swipe-card-title">{job.title}</h2>

      <div className="swipe-card-meta">
        {job.location ? <span>{job.location}</span> : null}
        <span>{job.source}</span>
        <span>{relativeTime(job.postedAt)}</span>
      </div>

      <div className="swipe-card-body">{pickDisplayBody(body, job)}</div>

      {visibleTags.length > 0 ? (
        <div className="swipe-card-tags">
          {visibleTags.map((tag) => (
            <span className="swipe-card-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
