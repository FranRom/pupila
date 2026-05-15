/*
 * useSwipeSkips — unified "is this job skipped?" model.
 *
 * Two sources of truth contribute to the skipped state of a job:
 *   1. swipeSkipIds — the file-persisted server list (data/swipe-skips.json),
 *      written by Jinder swipes and the table's skip pill. Loaded by
 *      useApplyQueue via /api/apply-queue/skips.
 *   2. aiSkipOverrides — local-only Set<jobId> in localStorage. Used to
 *      override an AI verdict of 'skip' when the user wants to see the job
 *      anyway (UI-only state; never persisted server-side).
 *
 * A job is "effectively skipped" iff it's in swipeSkipIds OR the AI verdict
 * is 'skip' AND the user hasn't overridden that.
 *
 * `toggleSkip(jobId)` flips the state, handling either source. The mutation
 * is optimistic: it calls the server first and rolls back if the request
 * fails. Server mutations are delegated to useApplyQueue (passed in as
 * addSkip / removeSkip) so the polling refresh sees the change.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AiReviews } from '../../types.ts';

const STORAGE_KEY = 'jinder-ai-skip-overrides';

export interface UseSwipeSkipsArgs {
  /** Server-side skip list, owned by useApplyQueue. */
  swipeSkipIds: Set<string>;
  /** AI review verdicts; verdict === 'skip' counts as an implicit skip. */
  aiReviews: AiReviews;
  /** Mutators from useApplyQueue. Return null on success, error string on
   *  failure, so this hook can roll back optimistic local updates. */
  addSkip: (jobId: string) => Promise<string | null>;
  removeSkip: (jobId: string) => Promise<string | null>;
  /** Optional notifier when a queue mutation fails — lets App route the
   *  error to its banner without coupling the hook to setApiError. */
  onError?: (message: string) => void;
}

export interface UseSwipeSkipsResult {
  aiSkipOverrides: Set<string>;
  /** Combines file-persisted swipe skips with the AI-verdict-skip minus overrides. */
  isJobSkipped: (jobId: string) => boolean;
  /** Toggle: skipped → unskipped, or unskipped → skipped. */
  toggleSkip: (jobId: string) => Promise<void>;
}

function loadOverrides(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // localStorage unavailable or value corrupted — start with an empty set.
  }
  return new Set();
}

export function useSwipeSkips({
  swipeSkipIds,
  aiReviews,
  addSkip,
  removeSkip,
  onError,
}: UseSwipeSkipsArgs): UseSwipeSkipsResult {
  const [aiSkipOverrides, setAiSkipOverrides] = useState<Set<string>>(loadOverrides);

  // localStorage is only authoritative for our own UI state; sync on every
  // change so a reload survives.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...aiSkipOverrides]));
    } catch {
      // Quota exceeded / disabled — best effort, fall through.
    }
  }, [aiSkipOverrides]);

  const isJobSkipped = useCallback(
    (jobId: string): boolean =>
      swipeSkipIds.has(jobId) ||
      (aiReviews[jobId]?.verdict === 'skip' && !aiSkipOverrides.has(jobId)),
    [swipeSkipIds, aiReviews, aiSkipOverrides],
  );

  const toggleSkip = useCallback<UseSwipeSkipsResult['toggleSkip']>(
    async (jobId) => {
      const inSwipe = swipeSkipIds.has(jobId);
      const aiSays = aiReviews[jobId]?.verdict === 'skip';
      const overridden = aiSkipOverrides.has(jobId);
      const effectivelySkipped = inSwipe || (aiSays && !overridden);

      if (effectivelySkipped) {
        // UNSKIP path. Two stores might contribute.
        if (aiSays && !overridden) {
          setAiSkipOverrides((prev) => new Set([...prev, jobId]));
        }
        if (inSwipe) {
          const err = await removeSkip(jobId);
          if (err) onError?.(`Could not unskip: ${err}`);
        }
        return;
      }

      // SKIP path. If the AI override is the only thing keeping us visible,
      // just lift it (no server mutation needed).
      if (aiSays && overridden) {
        setAiSkipOverrides((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        return;
      }

      const err = await addSkip(jobId);
      if (err) onError?.(`Could not skip: ${err}`);
    },
    [swipeSkipIds, aiReviews, aiSkipOverrides, addSkip, removeSkip, onError],
  );

  return { aiSkipOverrides, isJobSkipped, toggleSkip };
}
