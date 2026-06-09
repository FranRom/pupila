/*
 * useRoles — the candidate's target role interests (config/profile.json `roles[]`).
 *
 * Owns the read (GET /api/profile-roles on mount) and the write (PUT) of the
 * role list. Surfaces failures via the optional `onError` callback, same as the
 * other feature hooks; the consuming tab owns any banner display.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RoleInterest } from '../../types.ts';
import { api, formatError } from '../api/index.ts';

export interface UseRolesArgs {
  onError?: (msg: string) => void;
}

export interface UseRolesResult {
  roles: RoleInterest[];
  loading: boolean;
  saving: boolean;
  /** Persist a new role list and adopt the server-validated result. */
  save: (next: RoleInterest[]) => Promise<void>;
}

export function useRoles({ onError }: UseRolesArgs = {}): UseRolesResult {
  const [roles, setRoles] = useState<RoleInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.roles.get({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        onError?.(formatError(r.error));
        setLoading(false);
        return;
      }
      setRoles(r.value.roles);
      setLoading(false);
    };
    void load();
    return () => ctrl.abort();
  }, [onError]);

  const save = useCallback(
    async (next: RoleInterest[]) => {
      setSaving(true);
      const r = await api.roles.set(next);
      setSaving(false);
      if (!r.ok) {
        onError?.(formatError(r.error));
        return;
      }
      // Adopt the server-validated list (it may have dropped malformed roles).
      setRoles(r.value.roles);
    },
    [onError],
  );

  return { roles, loading, saving, save };
}
