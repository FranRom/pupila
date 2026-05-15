/*
 * useJobsData — server data for the Jobs tab.
 *
 * Owns the canonical jobs.json + ai-reviews.json snapshot plus the boolean
 * `loading` flag used to swap empty-state vs table. The hook is intentionally
 * minimal: no applied reconciliation, no URL state, no filter logic. App
 * composes this with useApplied to derive the per-job applied map.
 *
 * `reload(signal)` re-fetches both sources. Returns the fresh values so the
 * caller can drive follow-on state (e.g. App's mount effect uses the return
 * value to decide when to flip `loading` off).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AiReviews, Job } from '../../types.ts';
import { api } from '../api/index.ts';

export interface UseJobsDataResult {
  allJobs: Job[];
  aiReviews: AiReviews;
  loading: boolean;
  reload: (signal?: AbortSignal) => Promise<{ jobs: Job[]; reviews: AiReviews } | null>;
}

export function useJobsData(): UseJobsDataResult {
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [aiReviews, setAiReviews] = useState<AiReviews>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback<UseJobsDataResult['reload']>(async (signal) => {
    const [jobsR, reviewsR] = await Promise.all([
      api.jobs.list({ signal }),
      api.reviews.list({ signal }),
    ]);
    // Both aborted → caller aborted us; surface that as null so they can
    // skip downstream state updates.
    if (
      !jobsR.ok &&
      jobsR.error.kind === 'abort' &&
      !reviewsR.ok &&
      reviewsR.error.kind === 'abort'
    ) {
      return null;
    }
    const jobs = jobsR.ok ? jobsR.value : [];
    const reviews = reviewsR.ok ? reviewsR.value : {};
    setAllJobs(jobs);
    setAiReviews(reviews);
    return { jobs, reviews };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const result = await reload(ctrl.signal);
      if (result === null) return;
      setLoading(false);
    };
    void load();
    return () => ctrl.abort();
  }, [reload]);

  return { allJobs, aiReviews, loading, reload };
}
