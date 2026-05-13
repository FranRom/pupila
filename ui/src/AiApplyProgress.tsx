import { useEffect, useRef, useState } from 'react';

// Bottom-right docked card streaming the AI Apply LLM output. Polls
// /api/ai-apply-progress every 1s while a run is in flight; auto-dismisses
// 4s after success and notifies the parent so the inline AiApplyPanel can
// show the final structured package. Mirrors FetchProgress / SchedulerProgress
// visually via shared `.fetch-progress*` classes; stack offset (.fetch-progress-aiapply)
// keeps it from overlapping when multiple docks are visible at once.

type RunStatus = 'idle' | 'running' | 'done' | 'error';

interface AppliedEntry {
  url: string;
  status: string;
  date: string;
  notes?: string;
}

export interface AiApplyState {
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  cvPath: string | null;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  path: string | null;
  applied: AppliedEntry | null;
  provider: string | null;
  error: string | null;
}

interface AiApplyProgressProps {
  // Called when a run transitions to `done` so the parent can refresh the
  // inline panel + applied state in App.tsx.
  onComplete: (state: AiApplyState) => void;
}

// LOW-7: dual-cadence polling — cheap when idle, snappy during runs.
const IDLE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 1000;
const DISMISS_MS = 4000;

export function AiApplyProgress({ onComplete }: AiApplyProgressProps) {
  const [state, setState] = useState<AiApplyState | null>(null);
  const [hidden, setHidden] = useState(true);
  const completedRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  // LOW-7: dual-cadence polling — cheap when idle, snappy during runs.
  // Re-create the interval whenever the cadence flips between running and
  // any other state.
  useEffect(() => {
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const res = await fetch('/api/ai-apply-progress', { signal: ctrl.signal });
        if (!res.ok) return;
        const next = (await res.json()) as AiApplyState;
        setState(next);

        if (next.status === 'running') {
          setHidden(false);
          completedRef.current = false;
          if (dismissTimerRef.current) {
            window.clearTimeout(dismissTimerRef.current);
            dismissTimerRef.current = null;
          }
        } else if (next.status === 'done' && !completedRef.current) {
          completedRef.current = true;
          onComplete(next);
          dismissTimerRef.current = window.setTimeout(() => setHidden(true), DISMISS_MS);
        } else if (next.status === 'error' && !completedRef.current) {
          // Notify parent on error too, otherwise aiApplyBusyId stays set
          // and every AI Apply button locks forever after the first failure.
          completedRef.current = true;
          onComplete(next);
          setHidden(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // other network blip — ignore
      }
    };
    void tick();
    const cadence = state?.status === 'running' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    intervalRef.current = window.setInterval(() => void tick(), cadence);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ctrl.abort();
    };
  }, [onComplete, state?.status]);

  // Clean up the dismiss timer on unmount only — it's separate from the
  // poll interval so it doesn't get torn down on every cadence flip.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (hidden || !state || state.status === 'idle') return null;

  const titleLabel = state.jobTitle
    ? `${state.company ?? '—'} · ${state.jobTitle.length > 36 ? `${state.jobTitle.slice(0, 36)}…` : state.jobTitle}`
    : 'application';

  return (
    <aside
      className={`fetch-progress fetch-progress-${state.status} fetch-progress-aiapply`}
      role="status"
      aria-live="polite"
    >
      <header className="fetch-progress-header">
        <span className="fetch-progress-title">
          {state.status === 'running' && (
            <>
              <span className="fetch-progress-spinner" aria-hidden />
              AI Apply ✨
            </>
          )}
          {state.status === 'done' && <>✓ AI Apply ready</>}
          {state.status === 'error' && <>✗ AI Apply failed</>}
        </span>
        {state.provider && <span className="fetch-progress-count">{state.provider}</span>}
      </header>

      <div className="fetch-progress-meta" title={titleLabel}>
        {titleLabel}
      </div>
      {state.cvPath && (
        <div className="fetch-progress-meta fetch-progress-meta-muted">
          Using CV: <code>{state.cvPath}</code>
        </div>
      )}

      <pre className="fetch-progress-log">
        {state.output.trim() || '(waiting for first token…)'}
      </pre>

      {state.error && state.status === 'error' && (
        <p className="fetch-progress-error" title={state.error}>
          {state.error.slice(0, 240)}
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
