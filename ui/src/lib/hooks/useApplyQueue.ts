/*
 * useApplyQueue — AI Apply queue snapshot + mutations.
 *
 * Owns the canonical `applyQueue` (GET /api/apply-queue) plus the file-
 * persisted `swipeSkipIds` (GET /api/apply-queue/skips). Polls every 2.5s
 * while `pollEnabled` is true so consumers don't have to wire their own
 * setInterval. App passes pollEnabled = tab === 'swipe' || tab === 'settings'
 * to keep the dev server quiet on tabs that don't render queue state.
 *
 * Exposes mutations (enqueue, cancel, addSkip, removeSkip) that hit the api
 * and refresh the snapshot. Derived helpers (statusMap, activeJobIds) live
 * here too so consumers don't recompute them — the cost is centralized.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApplyQueueResponse, QueueStatusMap } from '../../types.ts';
import { api, formatError } from '../api/index.ts';

const POLL_INTERVAL_MS = 2500;

export interface UseApplyQueueArgs {
  /** When true, the hook polls every 2.5s. App typically toggles this based
   *  on the active tab (Jinder + Settings render queue state). */
  pollEnabled: boolean;
  /** Fired when a mutation fails. App routes to its banner. */
  onError?: (message: string) => void;
}

export interface UseApplyQueueResult {
  queue: ApplyQueueResponse | null;
  swipeSkipIds: Set<string>;
  statusMap: QueueStatusMap;
  activeJobIds: Set<string>;
  refresh: (signal?: AbortSignal) => Promise<void>;
  enqueue: (jobId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  /** Server-side swipe-skip mutations — used by useSwipeSkips. */
  addSkip: (jobId: string) => Promise<string | null>;
  removeSkip: (jobId: string) => Promise<string | null>;
}

export function useApplyQueue({ pollEnabled, onError }: UseApplyQueueArgs): UseApplyQueueResult {
  const [queue, setQueue] = useState<ApplyQueueResponse | null>(null);
  const [swipeSkipIds, setSwipeSkipIds] = useState<Set<string>>(new Set());

  const refresh = useCallback<UseApplyQueueResult['refresh']>(async (signal) => {
    const [qr, sr] = await Promise.all([
      api.applyQueue.list({ signal }),
      api.applyQueue.listSkips({ signal }),
    ]);
    if (qr.ok) setQueue(qr.value);
    if (sr.ok) setSwipeSkipIds(new Set(sr.value.skips));
    // Network / abort blips just keep the previous snapshot — silent recovery.
  }, []);

  // Tab-gated polling effect. Wakes once immediately so a tab switch shows
  // fresh data without waiting up to 2.5s.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-running on every refresh identity churn would re-create the interval each tick.
  useEffect(() => {
    if (!pollEnabled) return;
    const ctrl = new AbortController();
    const tick = () => void refresh(ctrl.signal);
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [pollEnabled]);

  // 409 = backend dedup; surface as no-op rather than as an error.
  const enqueue = useCallback<UseApplyQueueResult['enqueue']>(
    async (jobId) => {
      const r = await api.applyQueue.enqueue(jobId);
      if (!r.ok && !(r.error.kind === 'http' && r.error.status === 409)) {
        onError?.(`Could not queue job: ${formatError(r.error)}`);
      }
      await refresh();
    },
    [refresh, onError],
  );

  const cancel = useCallback<UseApplyQueueResult['cancel']>(
    async (jobId) => {
      await api.applyQueue.cancel(jobId);
      await refresh();
    },
    [refresh],
  );

  // Optimistic + rollback. Mutate the local set immediately so the UI
  // reflects the change before the network round-trips, then roll back on
  // failure. Returns null on success, formatted error on failure so the
  // caller can surface the rollback reason.
  const addSkip = useCallback<UseApplyQueueResult['addSkip']>(async (jobId) => {
    setSwipeSkipIds((prev) => new Set([...prev, jobId]));
    const r = await api.applyQueue.addSkip(jobId);
    if (r.ok) return null;
    setSwipeSkipIds((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    return formatError(r.error);
  }, []);

  const removeSkip = useCallback<UseApplyQueueResult['removeSkip']>(async (jobId) => {
    setSwipeSkipIds((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    const r = await api.applyQueue.removeSkip(jobId);
    if (r.ok) return null;
    setSwipeSkipIds((prev) => new Set([...prev, jobId]));
    return formatError(r.error);
  }, []);

  // Derive a job-id → most-recent-status map. The queue can carry historical
  // rows when a job's been re-enqueued; most recent wins.
  const statusMap = useMemo<QueueStatusMap>(() => {
    const map: QueueStatusMap = {};
    if (!queue) return map;
    for (const row of queue.rows) map[row.jobId] = row.status;
    return map;
  }, [queue]);

  const activeJobIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    if (!queue) return ids;
    for (const row of queue.rows) {
      if (row.status === 'queued' || row.status === 'running') ids.add(row.jobId);
    }
    return ids;
  }, [queue]);

  return {
    queue,
    swipeSkipIds,
    statusMap,
    activeJobIds,
    refresh,
    enqueue,
    cancel,
    addSkip,
    removeSkip,
  };
}
