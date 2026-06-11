/*
 * useCategories: the candidate's job categories (config/profile.json
 * `categories[]`). Owns the read (GET /api/profile-categories on mount) and the
 * write (PUT). Surfaces failures via the optional `onError` callback, same as
 * the other feature hooks; the consuming tab owns any banner display.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CategoryDef } from '../../types.ts';
import { api, formatError } from '../api/index.ts';

export interface UseCategoriesArgs {
  onError?: (msg: string) => void;
}

export interface UseCategoriesResult {
  categories: CategoryDef[];
  loading: boolean;
  saving: boolean;
  /** Persist a new category list and adopt the server-validated result. */
  save: (next: CategoryDef[]) => Promise<void>;
}

export function useCategories({ onError }: UseCategoriesArgs = {}): UseCategoriesResult {
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.categories.get({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        onError?.(formatError(r.error));
        setLoading(false);
        return;
      }
      setCategories(r.value.categories);
      setLoading(false);
    };
    void load();
    return () => ctrl.abort();
  }, [onError]);

  const save = useCallback(
    async (next: CategoryDef[]) => {
      setSaving(true);
      const r = await api.categories.set(next);
      setSaving(false);
      if (!r.ok) {
        onError?.(formatError(r.error));
        return;
      }
      // Adopt the server-validated list (it may have dropped malformed entries).
      setCategories(r.value.categories);
    },
    [onError],
  );

  return { categories, loading, saving, save };
}
