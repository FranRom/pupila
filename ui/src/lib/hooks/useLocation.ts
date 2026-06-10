/*
 * useLocation — the candidate's location preferences (config/profile.json
 * `location`). Owns the read (GET /api/profile-location on mount) and the write
 * (PUT). Surfaces failures via the optional `onError` callback, same as the
 * other feature hooks; the consuming tab owns any banner display.
 */

import { useCallback, useEffect, useState } from 'react';
import type { LocationProfile } from '../../types.ts';
import { api, formatError } from '../api/index.ts';

// Neutral default shown before the server responds (and when a profile has no
// `location` block yet). Mirrors config/profile.default.json: accepts every
// work type, no region preference, so nothing is dropped on geography.
export const DEFAULT_LOCATION: LocationProfile = {
  basedIn: '',
  workTypes: ['remote', 'hybrid', 'onsite'],
  acceptedRegions: [],
  excludeOutsideAcceptedRegions: false,
};

export interface UseLocationArgs {
  onError?: (msg: string) => void;
}

export interface UseLocationResult {
  location: LocationProfile;
  loading: boolean;
  saving: boolean;
  /** Persist a new location and adopt the server-validated result. */
  save: (next: LocationProfile) => Promise<void>;
}

export function useLocation({ onError }: UseLocationArgs = {}): UseLocationResult {
  const [location, setLocation] = useState<LocationProfile>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.location.get({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        onError?.(formatError(r.error));
        setLoading(false);
        return;
      }
      setLocation(r.value.location ?? DEFAULT_LOCATION);
      setLoading(false);
    };
    void load();
    return () => ctrl.abort();
  }, [onError]);

  const save = useCallback(
    async (next: LocationProfile) => {
      setSaving(true);
      const r = await api.location.set(next);
      setSaving(false);
      if (!r.ok) {
        onError?.(formatError(r.error));
        return;
      }
      // Adopt the server-validated value (it may have coerced/dropped fields).
      setLocation(r.value.location);
    },
    [onError],
  );

  return { location, loading, saving, save };
}
