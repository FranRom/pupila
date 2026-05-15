/*
 * useOnboarding — single-resource data layer for the first-run wizard gate.
 *
 * Owns the `showOnboarding` decision derived from /api/preferences. `null`
 * means we haven't probed yet (initial loading state); App renders a
 * placeholder until it resolves to a boolean.
 *
 * `reprobe()` re-fetches the preferences stamp. Called by Settings' clean
 * flow so a destructive reset (which wipes preferences.json on disk) routes
 * the user back to the wizard without a hard refresh.
 *
 * `dismiss()` flips the flag to false after the user completes the wizard.
 * The Onboarding component calls this from its `onComplete` callback.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.ts';

export interface UseOnboardingResult {
  /** `null` until the first probe resolves; then `true` if the wizard
   *  should show (no `onboardedAt` stamp), `false` otherwise. */
  showOnboarding: boolean | null;
  /** Re-fetch /api/preferences and re-evaluate the gate. Used after a
   *  destructive clean that wipes preferences.json. */
  reprobe: (signal?: AbortSignal) => Promise<void>;
  /** Flip the gate off after the user finishes the wizard. */
  dismiss: () => void;
}

export function useOnboarding(): UseOnboardingResult {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  const reprobe = useCallback<UseOnboardingResult['reprobe']>(async (signal) => {
    const r = await api.preferences.get({ signal });
    if (!r.ok && r.error.kind === 'abort') return;
    const prefs = r.ok ? r.value : { provider: null, onboardedAt: null };
    setShowOnboarding(!prefs.onboardedAt);
  }, []);

  const dismiss = useCallback(() => setShowOnboarding(false), []);

  useEffect(() => {
    const ctrl = new AbortController();
    void reprobe(ctrl.signal);
    return () => ctrl.abort();
  }, [reprobe]);

  return { showOnboarding, reprobe, dismiss };
}
