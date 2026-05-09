import { useEffect, useRef, useState } from 'react';

// Bottom-right docked card that streams the aggregator's per-source progress.
// Polls /api/fetch-jobs every ~1s while a run is in flight, auto-dismisses
// 3s after a successful run, and calls onComplete() so the parent can
// re-fetch /api/jobs + /api/reviews to swap empty state for the real table.
//
// Polling beats SSE here because the run is short (30-60s for 13 sources)
// and the polling code lives entirely in this component.

type RunStatus = 'idle' | 'running' | 'done' | 'error';
type SourceState = 'pending' | 'running' | 'done' | 'error';

interface SourceEntry {
  name: string;
  state: SourceState;
  fetched?: number;
  errors?: number;
  message?: string;
}

interface FetchJobsState {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  sources: SourceEntry[];
  exitCode: number | null;
  lastError: string | null;
}

interface FetchProgressProps {
  onComplete: () => void;
}

const POLL_MS = 1000;
const DISMISS_MS = 3000;

function stateLabel(s: SourceState): string {
  if (s === 'pending') return '·';
  if (s === 'running') return '…';
  if (s === 'done') return '✓';
  return '✗';
}

export function FetchProgress({ onComplete }: FetchProgressProps) {
  const [state, setState] = useState<FetchJobsState | null>(null);
  const [hidden, setHidden] = useState(true);
  const completedRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch('/api/fetch-jobs');
        if (!res.ok) return;
        const next = (await res.json()) as FetchJobsState;
        if (cancelled) return;
        setState(next);

        // Show whenever a run is active, regardless of who started it.
        if (next.status === 'running') {
          setHidden(false);
          completedRef.current = false;
          if (dismissTimerRef.current) {
            window.clearTimeout(dismissTimerRef.current);
            dismissTimerRef.current = null;
          }
        } else if (next.status === 'done' && !completedRef.current) {
          completedRef.current = true;
          // Trigger parent re-fetch as soon as we see the success transition.
          onComplete();
          dismissTimerRef.current = window.setTimeout(() => {
            setHidden(true);
          }, DISMISS_MS);
        } else if (next.status === 'error') {
          // Keep error visible until the user dismisses or starts a new run.
          setHidden(false);
        }
      } catch {
        // network blip; just try again next tick
      }
    };

    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, [onComplete]);

  if (hidden || !state || state.status === 'idle') return null;

  const total = state.sources.length;
  const doneCount = state.sources.filter((s) => s.state === 'done' || s.state === 'error').length;
  const totalFetched = state.sources.reduce((acc, s) => acc + (s.fetched ?? 0), 0);

  return (
    <aside
      className={`fetch-progress fetch-progress-${state.status}`}
      role="status"
      aria-live="polite"
    >
      <header className="fetch-progress-header">
        <span className="fetch-progress-title">
          {state.status === 'running' && (
            <>
              <span className="fetch-progress-spinner" aria-hidden />
              Fetching jobs…
            </>
          )}
          {state.status === 'done' && <>✓ Done — {totalFetched} jobs</>}
          {state.status === 'error' && <>✗ Run failed</>}
        </span>
        <span className="fetch-progress-count">
          {doneCount}/{total}
        </span>
      </header>

      <ul className="fetch-progress-list">
        {state.sources.map((s) => (
          <li key={s.name} className={`fetch-progress-row fetch-progress-${s.state}`}>
            <span className="fetch-progress-name">{s.name}</span>
            <span className="fetch-progress-state">
              {s.state === 'done' && typeof s.fetched === 'number'
                ? `${stateLabel(s.state)} ${s.fetched}`
                : stateLabel(s.state)}
            </span>
          </li>
        ))}
      </ul>

      {state.lastError && (
        <p className="fetch-progress-error" title={state.lastError}>
          {state.lastError.slice(0, 200)}
        </p>
      )}
      {(state.status === 'done' || state.status === 'error') && (
        <button type="button" className="fetch-progress-dismiss" onClick={() => setHidden(true)}>
          dismiss
        </button>
      )}
    </aside>
  );
}
