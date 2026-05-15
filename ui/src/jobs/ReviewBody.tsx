import type { AiReview } from '../types.ts';
import styles from './ReviewBody.module.css';

export function ReviewBody({ review }: { review: AiReview }) {
  return (
    <div>
      <p className={styles.summary}>{review.summary}</p>
      {review.reason && (
        <p className={styles.reason}>
          <strong>Verdict:</strong> {review.reason}
        </p>
      )}
      <div className={styles.cols}>
        {review.wants.length > 0 && (
          <div>
            <h4>Wants</h4>
            <ul>
              {review.wants.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {review.offers.length > 0 && (
          <div>
            <h4>Offers</h4>
            <ul>
              {review.offers.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        {review.redFlags.length > 0 && (
          <div>
            <h4>Red flags</h4>
            <ul className={styles.redFlags}>
              {review.redFlags.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
