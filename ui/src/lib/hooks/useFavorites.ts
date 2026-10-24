/*
 * useFavorites — server-persisted "favorite" marker, independent of
 * application status and the Jinder skip list.
 *
 * One-shot mount load (no polling — favorites don't need cross-tab live
 * sync the way the apply queue does) plus an optimistic toggle that mutates
 * local state first and rolls back on failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Mirror of the state, written on EVERY update path (optimistic toggle,
  // rollback, mount merge) via `commit`, so `toggleFavorite` can read the current
  // value without depending on `favoriteIds` and keeps a stable identity —
  // memoized rows would otherwise all re-render on each toggle (ui/CLAUDE.md §5).
  const idsRef = useRef<Set<string>>(favoriteIds);
  // Ids toggled before the mount load returned: the server snapshot must not
  // overwrite them (it may predate the toggle).
  const touched = useRef<Map<string, boolean>>(new Map());
  // Latest callback, so the stable callbacks and the one-shot mount load never
  // re-run when it changes. Updated in an effect, not during render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const commit = useCallback((update: (prev: Set<string>) => Set<string>) => {
    const next = update(idsRef.current);
    idsRef.current = next;
    setFavoriteIds(next);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.favorites.list({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind !== 'abort')
          onErrorRef.current?.(`Could not load favorites: ${formatError(r.error)}`);
        return;
      }
      if (r.value.damaged) {
        onErrorRef.current?.(
          'data/favorites.json is damaged; the favorites shown may be incomplete. A backup is kept as data/favorites.json.corrupt-* the next time you change a favorite.',
        );
      }
      const merged = new Set(r.value.favorites);
      for (const [id, isFav] of touched.current) {
        if (isFav) merged.add(id);
        else merged.delete(id);
      }
      commit(() => merged);
    };
    void load();
    return () => ctrl.abort();
  }, [commit]);

  const isFavorite = useCallback((jobId: string) => favoriteIds.has(jobId), [favoriteIds]);

  const toggleFavorite = useCallback<UseFavoritesResult['toggleFavorite']>(
    async (jobId) => {
      const wasFavorite = idsRef.current.has(jobId);
      touched.current.set(jobId, !wasFavorite);

      if (wasFavorite) {
        commit((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        const r = await api.favorites.remove(jobId);
        if (!r.ok) {
          touched.current.set(jobId, true);
          commit((prev) => new Set([...prev, jobId]));
          onErrorRef.current?.(`Could not unfavorite: ${formatError(r.error)}`);
        }
        return;
      }

      commit((prev) => new Set([...prev, jobId]));
      const r = await api.favorites.add(jobId);
      if (!r.ok) {
        touched.current.set(jobId, false);
        commit((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        onErrorRef.current?.(`Could not favorite: ${formatError(r.error)}`);
      }
    },
    [commit],
  );

  return { favoriteIds, isFavorite, toggleFavorite };
}
