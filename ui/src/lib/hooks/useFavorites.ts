/*
 * useFavorites — server-persisted "favorite" marker, independent of
 * application status and the Jinder skip list.
 *
 * One-shot mount load (no polling — favorites don't need cross-tab live
 * sync the way the apply queue does) plus an optimistic toggle that mutates
 * local state first and rolls back on failure.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, formatError } from '../api/index.ts';

export interface UseFavoritesArgs {
  /** Fired when a mutation fails (after rollback). App routes to its banner. */
  onError?: (message: string) => void;
}

export interface UseFavoritesResult {
  favoriteIds: Set<string>;
  isFavorite: (jobId: string) => boolean;
  toggleFavorite: (jobId: string) => Promise<void>;
}

export function useFavorites({ onError }: UseFavoritesArgs = {}): UseFavoritesResult {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.favorites.list({ signal: ctrl.signal });
      if (!r.ok) return;
      setFavoriteIds(new Set(r.value.favorites));
    };
    void load();
    return () => ctrl.abort();
  }, []);

  const isFavorite = useCallback((jobId: string) => favoriteIds.has(jobId), [favoriteIds]);

  // Identity churns with favoriteIds (same tradeoff useSwipeSkips's
  // toggleSkip already accepts in this codebase) — simpler and correct,
  // vs. the eager-updater-read trick used by useApplied's setApplied, which
  // doesn't reliably resolve synchronously enough to gate a branch decision.
  const toggleFavorite = useCallback<UseFavoritesResult['toggleFavorite']>(
    async (jobId) => {
      const wasFavorite = favoriteIds.has(jobId);

      if (wasFavorite) {
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        const r = await api.favorites.remove(jobId);
        if (!r.ok) {
          setFavoriteIds((prev) => new Set([...prev, jobId]));
          onError?.(`Could not unfavorite: ${formatError(r.error)}`);
        }
        return;
      }

      setFavoriteIds((prev) => new Set([...prev, jobId]));
      const r = await api.favorites.add(jobId);
      if (!r.ok) {
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        onError?.(`Could not favorite: ${formatError(r.error)}`);
      }
    },
    [favoriteIds, onError],
  );

  return { favoriteIds, isFavorite, toggleFavorite };
}
