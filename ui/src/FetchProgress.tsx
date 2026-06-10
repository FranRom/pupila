import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { api, type FetchJobsState, type RunStatus, type SourceState } from './lib/api/index.ts';
import dockStyles from './styles/Dock.module.css';

// Bottom-right docked card that streams the aggregator's per-source progress.
// Polls /api/fetch-jobs every ~1s while a run is in flight, auto-dismisses
// 3s after a successful run, and calls onComplete() so the parent can
// re-fetch /api/jobs + /api/reviews to swap empty state for the real table.
//
// Polling beats SSE here because the run is short (30-60s for 14 sources)
// and the polling code lives entirely in this component.

// FetchJobsState + FetchJobsSourceEntry now live in ui/src/lib/api/index.ts
// so this dock and Settings' last-run summary share one definition. Local
// type re-exports here keep the rest of the file's lookup tables stable.

// 'partial' = fetched > 0 AND errors > 0 (e.g. stale tier-S slugs that 404'd
// while the rest of the source delivered jobs). Rendered amber with the
// real fetched count; distinct from 'error' (red, zero items came through).

interface FetchProgressProps {
  onComplete: () => void;
  /**
   * Fires on every poll with the current run status. Used by `App` to drive
   * the "Refetch" button's disabled state without adding a second poller —
   * FetchProgress is already mounted at root and ticking every 1–5s.
   */
  onStatusChange?: (status: RunStatus) => void;
}

// LOW-7: dual-cadence polling — cheap when idle, snappy during runs.
const IDLE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 1000;
const DISMISS_MS = 3000;

function stateLabel(s: SourceState): string {
  if (s === 'pending') return '·';
  if (s === 'running') return '…';
  if (s === 'done') return '✓';
  if (s === 'partial') return '⚠';
  return '✗';
}

const ROW_CLASS = {
  pending: dockStyles.row,
  running: dockStyles.rowRunning,
  done: dockStyles.rowDone,
  partial: dockStyles.rowPartial,
  error: dockStyles.rowError,
} as const;

const DOCK_VARIANT = {
  idle: null,
  running: dockStyles.dockRunning,
  done: dockStyles.dockDone,
  error: dockStyles.dockError,
} as const;

export function FetchProgress({ onComplete, onStatusChange }: FetchProgressProps) {
  const [state, setState] = useState<FetchJobsState | null>(null);
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
      const r = await api.fetchJobs.status({ signal: ctrl.signal });
      // abort + network/parse failures: just wait for next tick. Visible
      // state stays as-is so a transient blip doesn't yank the dock away.
      if (!r.ok) return;
      const next = r.value;
      setState(next);
      onStatusChange?.(next.status);

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
    };

    void tick();
    const cadence = state?.status === 'running' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    intervalRef.current = window.setInterval(() => {
      void tick();
    }, cadence);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      ctrl.abort();
    };
  }, [onComplete, onStatusChange, state?.status]);

  // Clean up the dismiss timer on unmount only — it's separate from the
  // poll interval so it doesn't get torn down on every cadence flip.
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (hidden || !state || state.status === 'idle') return null;

  const total = state.sources.length;
  // Any terminal state counts toward "N/M complete" — 'partial' isn't still
  // running, it's just "done with caveats".
  const TERMINAL: readonly SourceState[] = ['done', 'partial', 'error'];
  const doneCount = state.sources.filter((s) => TERMINAL.includes(s.state)).length;
  const totalFetched = state.sources.reduce((acc, s) => acc + (s.fetched ?? 0), 0);

  return (
    <aside
      className={clsx(dockStyles.dock, DOCK_VARIANT[state.status])}
      role="status"
      aria-live="polite"
    >
      <header className={dockStyles.header}>
        <span className={dockStyles.title}>
          {state.status === 'running' && (
            <>
              <span className={dockStyles.spinner} aria-hidden />
              Fetching jobs…
            </>
          )}
          {state.status === 'done' && <>✓ Done — {totalFetched} jobs</>}
          {state.status === 'error' && <>✗ Run failed</>}
        </span>
        <span className={dockStyles.count}>
          {doneCount}/{total}
        </span>
      </header>

      <ul className={dockStyles.list}>
        {state.sources.map((s) => {
          const showCount =
            (s.state === 'done' || s.state === 'partial') && typeof s.fetched === 'number';
          const showStaleSuffix = s.state === 'partial' && typeof s.errors === 'number';
          const tooltip = showStaleSuffix
            ? `${s.fetched} fetched · ${s.errors} slug${s.errors === 1 ? '' : 's'} unavailable (stale or 404'd)`
            : undefined;
          return (
            <li key={s.name} className={ROW_CLASS[s.state]} title={tooltip}>
              <span>{s.name}</span>
              <span className={dockStyles.state}>
                {showCount ? `${stateLabel(s.state)} ${s.fetched}` : stateLabel(s.state)}
                {showStaleSuffix && (
                  <span className={dockStyles.staleSuffix}> · {s.errors} stale</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {state.lastError && (
        <p className={dockStyles.errorBlock} title={state.lastError}>
          {state.lastError.slice(0, 200)}
        </p>
      )}
      {(state.status === 'done' || state.status === 'error') && (
        <button type="button" className={dockStyles.dismiss} onClick={() => setHidden(true)}>
          dismiss
        </button>
      )}
    </aside>
  );
}
