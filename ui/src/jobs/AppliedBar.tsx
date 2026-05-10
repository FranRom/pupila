import { useEffect, useState } from 'react';
import type { AppliedEntry, Job } from '../types.ts';
import { type SetApplied, STATUS_EMOJI, STATUS_OPTIONS } from './types.ts';

interface AppliedBarProps {
  job: Job;
  applied: AppliedEntry | undefined;
  setApplied: SetApplied;
}

export function AppliedBar({ job, applied, setApplied }: AppliedBarProps) {
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
    <div className="applied-bar">
      <span className="applied-label">
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
      <div className="applied-pills">
        {STATUS_OPTIONS.map((s) => {
          const active = applied?.status === s;
          return (
            <button
              key={s}
              type="button"
              className={`pill ${active ? `pill-active pill-${s}` : ''}`}
              aria-pressed={active}
              onClick={() => void setApplied(job, active ? null : s)}
              title={active ? 'Click to clear' : `Mark as ${s}`}
            >
              {active && (
                <span className="pill-check" aria-hidden>
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
            className="applied-clear"
            onClick={() => void setApplied(job, null)}
            title="Clear status"
          >
            clear
          </button>
        )}
      </div>
      {applied && (
        <input
          type="text"
          className="applied-notes"
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
