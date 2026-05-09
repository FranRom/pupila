import { useEffect, useRef, useState } from 'react';

// Bottom-right docked card mirroring FetchProgress, scoped to the
// scheduler install/uninstall script. Polls /api/scheduler-progress every
// 1s while a run is in flight, streams the script's stdout into the panel,
// auto-dismisses 4s after success, and pings the parent to refresh the
// scheduler status panel.
//
// Visually inherits .fetch-progress* classes so the docked-card affordance
// stays consistent across "fetching jobs" and "installing scheduler".

type RunStatus = 'idle' | 'running' | 'done' | 'error';
type SchedulerOp = 'install' | 'uninstall';

interface SchedulerOpState {
  op: SchedulerOp | null;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
  lastError: string | null;
}

interface SchedulerProgressProps {
  onComplete: () => void;
}

const POLL_MS = 1000;
const DISMISS_MS = 4000;

function opLabel(op: SchedulerOp | null): string {
  if (op === 'install') return 'Installing scheduler';
  if (op === 'uninstall') return 'Uninstalling scheduler';
  return 'Scheduler';
}

export function SchedulerProgress({ onComplete }: SchedulerProgressProps) {
  const [state, setState] = useState<SchedulerOpState | null>(null);
  const [hidden, setHidden] = useState(true);
  const completedRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/scheduler-progress');
        if (!res.ok) return;
        const next = (await res.json()) as SchedulerOpState;
        if (cancelled) return;
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
          onComplete();
          dismissTimerRef.current = window.setTimeout(() => setHidden(true), DISMISS_MS);
        } else if (next.status === 'error' && !completedRef.current) {
          // Notify parent on error too, otherwise schedulerOp stays set in
          // Settings.tsx and Install/Uninstall buttons lock forever.
          completedRef.current = true;
          onComplete();
          setHidden(false);
        }
      } catch {
        // ignore network blips
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, [onComplete]);

  if (hidden || !state || state.status === 'idle') return null;

  return (
    <aside
      className={`fetch-progress fetch-progress-${state.status} fetch-progress-scheduler`}
      role="status"
      aria-live="polite"
    >
      <header className="fetch-progress-header">
        <span className="fetch-progress-title">
          {state.status === 'running' && (
            <>
              <span className="fetch-progress-spinner" aria-hidden />
              {opLabel(state.op)}…
            </>
          )}
          {state.status === 'done' && <>✓ {opLabel(state.op)} done</>}
          {state.status === 'error' && <>✗ {opLabel(state.op)} failed</>}
        </span>
        {state.exitCode !== null && (
          <span className="fetch-progress-count">exit {state.exitCode}</span>
        )}
      </header>

      <pre className="fetch-progress-log">{state.output.trim() || '(waiting for output…)'}</pre>

      {state.lastError && state.status === 'error' && (
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
