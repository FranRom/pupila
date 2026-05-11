// [08] Apply queue panel — view + cancel rows from data/apply-queue.json.
//
// Parent (Settings.tsx) owns the fetch + cancel API. This component is
// pure rendering + interaction: filter, sort, cancel, refresh.

import { useMemo, useState } from 'react';
import { relativeTime } from '../format.ts';
import {
  type ApplyQueueResponse,
  QUEUE_STATUS_EMOJI,
  QUEUE_STATUS_LABEL,
  type QueueRow,
  type QueueRowStatus,
} from '../types.ts';

interface ApplyQueuePanelProps {
  data: ApplyQueueResponse | null;
  onCancel: (jobId: string) => Promise<void>;
  onRefresh: () => void;
}

type QueueFilter = 'all' | 'active' | 'done' | 'failed';

const FILTER_LABELS: Record<QueueFilter, string> = {
  all: 'All',
  active: 'Active',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_RANK: Record<QueueRowStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  cancelled: 3,
  done: 4,
};

function matchesFilter(status: QueueRowStatus, filter: QueueFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'queued' || status === 'running';
  if (filter === 'done') return status === 'done';
  return status === 'failed' || status === 'cancelled';
}

function compareRows(a: QueueRow, b: QueueRow): number {
  const rankDelta = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rankDelta !== 0) return rankDelta;
  // Within active states: oldest first (FIFO). Within terminal states: newest first.
  const aTime = new Date(a.enqueuedAt).getTime();
  const bTime = new Date(b.enqueuedAt).getTime();
  if (a.status === 'queued' || a.status === 'running') {
    return aTime - bTime;
  }
  return bTime - aTime;
}

function countByStatus(rows: QueueRow[]): Record<QueueRowStatus, number> {
  const counts: Record<QueueRowStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return counts;
}

export function ApplyQueuePanel({ data, onCancel, onRefresh }: ApplyQueuePanelProps) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  const rows = data?.rows ?? [];

  const counts = useMemo(() => countByStatus(rows), [rows]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((r) => matchesFilter(r.status, filter));
    return [...filtered].sort(compareRows);
  }, [rows, filter]);

  const handleCancel = async (jobId: string): Promise<void> => {
    setCancelling((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
    try {
      await onCancel(jobId);
    } finally {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  return (
    <section className="settings-section apply-queue-panel">
      <header className="apply-queue-panel-header">
        <h2>[08] APPLY QUEUE</h2>
        <button type="button" className="apply-queue-cancel" onClick={onRefresh}>
          ↻ refresh
        </button>
      </header>
      <p className="apply-queue-panel-subtitle">
        Background jobs queued for AI apply. Right-swipe in the Tik Tjob tab enqueues; the worker
        drains serially. Cancel anytime.
      </p>

      {data === null ? (
        <div className="apply-queue-empty">Loading…</div>
      ) : (
        <>
          {data.worker.alive ? (
            <div className="apply-queue-worker-banner">
              <span>✓ worker running (pid {data.worker.pid ?? '—'})</span>
            </div>
          ) : (
            <div className="apply-queue-worker-banner">
              <span>⚠ apply-worker is not running. Start it in a terminal:</span>
              <code className="apply-queue-worker-banner-cmd">pnpm run apply-worker</code>
            </div>
          )}

          <div className="apply-queue-panel-subtitle">
            {counts.queued} queued · {counts.running} running · {counts.done} done · {counts.failed}{' '}
            failed · {counts.cancelled} cancelled
          </div>

          <div className="apply-queue-panel-header">
            {(Object.keys(FILTER_LABELS) as QueueFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                className="apply-queue-cancel"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                disabled={filter === f}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {visibleRows.length === 0 ? (
            <div className="apply-queue-empty">Queue is empty.</div>
          ) : (
            <ul className="apply-queue-list">
              {visibleRows.map((row) => {
                const isActive = row.status === 'queued' || row.status === 'running';
                const isCancelling = cancelling.has(row.jobId);
                const timeIso = row.startedAt ?? row.enqueuedAt;
                return (
                  <li key={`${row.jobId}-${row.enqueuedAt}`} className="apply-queue-row">
                    <span className={`apply-queue-status qstatus-${row.status}`}>
                      {QUEUE_STATUS_EMOJI[row.status]} {QUEUE_STATUS_LABEL[row.status]}
                    </span>
                    <code className="apply-queue-jobid">{row.jobId.slice(0, 10)}…</code>
                    {row.attempts > 1 && (
                      <span className="apply-queue-attempts">attempts: {row.attempts}</span>
                    )}
                    <span className="apply-queue-time">{relativeTime(timeIso)}</span>
                    {row.error && (row.status === 'failed' || row.status === 'cancelled') && (
                      <span className="apply-queue-error" title={row.error}>
                        {row.error.slice(0, 60)}…
                      </span>
                    )}
                    {isActive && (
                      <button
                        type="button"
                        className="apply-queue-cancel"
                        onClick={() => void handleCancel(row.jobId)}
                        disabled={isCancelling}
                      >
                        {isCancelling ? 'cancelling…' : 'cancel'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
