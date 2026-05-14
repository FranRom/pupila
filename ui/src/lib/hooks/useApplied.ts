/*
 * useApplied — applied-status tracking with optimistic mutations.
 *
 * Owns `appliedById` (jobId-keyed map) reconciled against the canonical
 * AppliedEntry[] from /api/applied. Reconciliation re-runs whenever the
 * caller-supplied `allJobs` changes — the file is URL-keyed, but the UI is
 * jobId-keyed, so we have to join.
 *
 * `setApplied(job, status, notes)` is the single mutation entry point:
 *   - status === null  → DELETE /api/applied (clear)
 *   - status !== null  → POST /api/applied (upsert)
 * Both apply optimistic updates and roll back on failure, routing the
 * server message via the caller-supplied `onError` callback. UI error state
 * lives in App, not in the hook — hooks own server state, App owns banners.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppliedMap, SetApplied } from '../../jobs/types.ts';
import type { AppliedEntry, Job } from '../../types.ts';
import { api, formatError } from '../api/index.ts';

export interface UseAppliedArgs {
  allJobs: Job[];
  /** Fired when a mutation fails (after rollback). App routes to its banner. */
  onError?: (message: string) => void;
  /** Fired on successful mutation so App can clear a stale banner. */
  onSuccess?: () => void;
}

export interface UseAppliedResult {
  appliedById: AppliedMap;
  setApplied: SetApplied;
  /** Imperative hydrate — used by hooks/effects that already have the entries
   *  in hand (e.g. AiApplyProgress's onComplete payload). */
  upsertEntry: (jobId: string, entry: AppliedEntry) => void;
}

export function useApplied({ allJobs, onError, onSuccess }: UseAppliedArgs): UseAppliedResult {
  const [appliedById, setAppliedById] = useState<AppliedMap>({});

  // Initial load + reconciliation when allJobs changes. Server is the source
  // of truth for entries; the jobId map is a UI projection.
  useEffect(() => {
    const ctrl = new AbortController();
    const reconcile = async () => {
      const r = await api.applied.list({ signal: ctrl.signal });
      if (!r.ok) {
        // Abort = caller cancelled. Other failures = leave existing state
        // alone (don't clobber an optimistic in-flight mutation).
        return;
      }
      const byUrl = new Map(r.value.map((e) => [e.url, e]));
      const next: AppliedMap = {};
      for (const j of allJobs) {
        const e = byUrl.get(j.url);
        if (e) next[j.id] = e;
      }
      setAppliedById(next);
    };
    void reconcile();
    return () => ctrl.abort();
  }, [allJobs]);

  const setApplied = useCallback<SetApplied>(
    async (job, status, notes) => {
      // Read snapshot directly from state via a no-op updater to avoid the
      // stale-closure trap: under StrictMode double-invocation, the closure
      // can capture a pre-update value if we just read appliedById here.
      let prevSnapshot: AppliedEntry | undefined;
      setAppliedById((prev) => {
        prevSnapshot = prev[job.id];
        return prev;
      });

      if (status === null) {
        setAppliedById((prev) => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
        const r = await api.applied.clear(job.url);
        if (!r.ok) {
          setAppliedById((prev) => {
            if (!prevSnapshot) return prev;
            return { ...prev, [job.id]: prevSnapshot };
          });
          onError?.(`Failed to clear status: ${formatError(r.error)}`);
        } else {
          onSuccess?.();
        }
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const finalNotes = notes !== undefined ? notes : prevSnapshot?.notes;
      const optimistic: AppliedEntry = {
        url: job.url,
        status,
        date: prevSnapshot?.date ?? today,
        ...(finalNotes ? { notes: finalNotes } : {}),
      };
      setAppliedById((prev) => ({ ...prev, [job.id]: optimistic }));

      const r = await api.applied.set(optimistic);
      if (r.ok) {
        setAppliedById((prev) => ({ ...prev, [job.id]: r.value }));
        onSuccess?.();
      } else {
        setAppliedById((prev) => {
          const next = { ...prev };
          if (prevSnapshot) next[job.id] = prevSnapshot;
          else delete next[job.id];
          return next;
        });
        onError?.(`Failed to save status: ${formatError(r.error)}`);
      }
    },
    [onError, onSuccess],
  );

  const upsertEntry = useCallback((jobId: string, entry: AppliedEntry) => {
    setAppliedById((prev) => ({ ...prev, [jobId]: entry }));
  }, []);

  return { appliedById, setApplied, upsertEntry };
}
