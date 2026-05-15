import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { AppliedEntry, Job, QueueRowStatus } from '../types.ts';
import styles from './AppliedBar.module.css';
import { type SetApplied, STATUS_EMOJI, STATUS_OPTIONS } from './types.ts';

interface AppliedBarProps {
  job: Job;
  applied: AppliedEntry | undefined;
  isSkipped: boolean;
  queueStatus: QueueRowStatus | null;
  setApplied: SetApplied;
  toggleSkip: (jobId: string) => void;
  cancelQueueRow: (jobId: string) => Promise<void>;
  enqueueJob: (jobId: string) => Promise<void>;
}

const STATUS_VARIANT_CLASS = {
  applied: styles.applied,
  interview: styles.interview,
  offer: styles.offer,
  rejected: styles.rejected,
  withdrawn: styles.withdrawn,
} as const;

export function AppliedBar({
  job,
  applied,
  isSkipped,
  queueStatus,
  setApplied,
  toggleSkip,
  cancelQueueRow,
  enqueueJob,
}: AppliedBarProps) {
  const [notesDraft, setNotesDraft] = useState(applied?.notes ?? '');
  // Reset the notes draft whenever the underlying entry changes (e.g. after
  // server confirms or status switches via the pills).
  useEffect(() => {
    setNotesDraft(applied?.notes ?? '');
  }, [applied?.notes]);

  const persistNotes = () => {
    if (!applied) return;
    const trimmed = notesDraft.trim();
    if (trimmed === (applied.notes ?? '')) return;
    void setApplied(job, applied.status, trimmed);
  };

  return (
    <div className={styles.bar}>
      <span className={styles.label}>
        {applied ? (
          <>
            Currently{' '}
            <strong>
              {STATUS_EMOJI[applied.status]} {applied.status}
            </strong>{' '}
            since {applied.date}
          </>
        ) : (
          'Not applied'
        )}
      </span>
      <div className={styles.pills}>
        {STATUS_OPTIONS.map((s) => {
          const active = applied?.status === s;
          return (
            <button
              key={s}
              type="button"
              className={clsx(
                styles.pill,
                active && styles.pillActive,
                active && STATUS_VARIANT_CLASS[s],
              )}
              aria-pressed={active}
              onClick={() => void setApplied(job, active ? null : s)}
              title={active ? 'Click to clear' : `Mark as ${s}`}
            >
              {active && (
                <span className={styles.check} aria-hidden>
                  ✓{' '}
                </span>
              )}
              {STATUS_EMOJI[s]} {s}
            </button>
          );
        })}
        {applied && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => void setApplied(job, null)}
            title="Clear status"
          >
            clear
          </button>
        )}
        <button
          type="button"
          className={clsx(
            styles.pill,
            isSkipped && styles.pillActive,
            isSkipped && styles.rejected,
          )}
          aria-pressed={isSkipped}
          onClick={() => toggleSkip(job.id)}
          title={isSkipped ? 'Click to un-skip — restores in Jinder' : 'Skip from Jinder'}
        >
          {isSkipped && (
            <span className={styles.check} aria-hidden>
              ✓{' '}
            </span>
          )}
          ❌ {isSkipped ? 'skipped' : 'skip'}
        </button>
        {queueStatus === 'queued' || queueStatus === 'running' ? (
          <button
            type="button"
            className={clsx(styles.pill, styles.pillActive, styles.rejected)}
            onClick={() => void cancelQueueRow(job.id)}
            title={
              queueStatus === 'running'
                ? 'Cancel the in-flight AI Apply run'
                : 'Remove from the AI Apply queue (no work happened yet)'
            }
          >
            ✕ {queueStatus === 'running' ? 'cancel apply' : 'remove from queue'}
          </button>
        ) : queueStatus !== 'done' ? (
          <button
            type="button"
            className={styles.pill}
            onClick={() => void enqueueJob(job.id)}
            title="Queue this job for AI Apply (background LLM run)"
          >
            ⏳ queue
          </button>
        ) : null}
      </div>
      {applied && (
        <input
          type="text"
          className={styles.notes}
          placeholder="notes (saved on blur)"
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={persistNotes}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
    </div>
  );
}
