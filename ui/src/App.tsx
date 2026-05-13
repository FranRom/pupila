import { useCallback, useEffect, useMemo, useState } from 'react';
import { AiApplyProgress, type AiApplyState as DockState } from './AiApplyProgress.tsx';
import { FetchProgress } from './FetchProgress.tsx';
import { relativeTime } from './format.ts';
import { AppHeader } from './jobs/AppHeader.tsx';
import { DetailPanel } from './jobs/DetailPanel.tsx';
import { JobsFilters } from './jobs/JobsFilters.tsx';
import { QueueBadge } from './jobs/QueueBadge.tsx';
import { ScoreBar } from './jobs/ScoreBar.tsx';
import { SignalChips } from './jobs/SignalChips.tsx';
import {
  type AiApplyError,
  type AiApplyResult,
  type AppliedMap,
  type SetApplied,
  STATUS_EMOJI,
} from './jobs/types.ts';
import { Onboarding } from './Onboarding.tsx';
import { Profile } from './Profile.tsx';
import { SchedulerProgress } from './SchedulerProgress.tsx';
import { Settings } from './Settings.tsx';
import { SwipeDeck } from './swipe/SwipeDeck.tsx';
import type {
  AiReview,
  AiReviews,
  ApplicationStatus,
  AppliedEntry,
  ApplyQueueResponse,
  Category,
  Job,
  QueueRowStatus,
  QueueStatusMap,
  Source,
} from './types.ts';

type Tab = 'jobs' | 'swipe' | 'profile' | 'settings';

interface PreferencesResponse {
  provider: string | null;
  onboardedAt: string | null;
}

const CATEGORY_OPTIONS: ReadonlyArray<Category | 'all'> = [
  'all',
  'web3+ai',
  'web3',
  'ai',
  'general',
];

type SortKey = 'fitScore' | 'salaryMax' | 'postedAt';
type SortDir = 'asc' | 'desc';

interface CompanyGroup {
  /** lowercased — used as identity for expand state and grouping key */
  key: string;
  /** original casing for display */
  display: string;
  jobs: Job[];
  topScore: number;
  topJob: Job;
}

function readUrl(): {
  search: string;
  category: Category | 'all';
  source: Source | 'all';
  appliedOnly: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  groupByCompany: boolean;
  compact: boolean;
  expanded: string | null;
  expandedCompany: string | null;
  tab: Tab;
} {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get('cat');
  const sortKey = p.get('sort');
  const sortDir = p.get('dir');
  const tab = p.get('tab');
  return {
    search: p.get('q') ?? '',
    category:
      cat === 'web3+ai' || cat === 'web3' || cat === 'ai' || cat === 'general' ? cat : 'all',
    source: (p.get('src') as Source | 'all' | null) ?? 'all',
    appliedOnly: p.get('applied') === '1',
    sortKey: sortKey === 'salaryMax' || sortKey === 'postedAt' ? sortKey : 'fitScore',
    sortDir: sortDir === 'asc' ? 'asc' : 'desc',
    groupByCompany: p.get('group') !== '0',
    // Default OFF — only persisted in URL when explicitly enabled.
    compact: p.get('compact') === '1',
    expanded: p.get('expanded'),
    expandedCompany: p.get('co'),
    tab:
      tab === 'profile'
        ? 'profile'
        : tab === 'settings'
          ? 'settings'
          : tab === 'swipe'
            ? 'swipe'
            : 'jobs',
  };
}

export function App() {
  const initial = useMemo(() => readUrl(), []);
  const [search, setSearch] = useState(initial.search);
  const [category, setCategory] = useState<Category | 'all'>(initial.category);
  const [source, setSource] = useState<Source | 'all'>(initial.source);
  const [appliedOnly, setAppliedOnly] = useState(initial.appliedOnly);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [groupByCompany, setGroupByCompany] = useState(initial.groupByCompany);
  const [compact, setCompact] = useState(initial.compact);
  const [expanded, setExpanded] = useState<string | null>(initial.expanded);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(initial.expandedCompany);
  const [appliedById, setAppliedById] = useState<AppliedMap>({});
  const [apiError, setApiError] = useState<string | null>(null);
  // Lifted AI Apply state — the dock at App root is the only source of
  // truth for "is something running"; FragmentRow reads {busyJobId, result,
  // error} to know what to render and whether to disable its button.
  const [aiApplyBusyId, setAiApplyBusyId] = useState<string | null>(null);
  const [aiApplyResult, setAiApplyResult] = useState<AiApplyResult | null>(null);
  const [aiApplyError, setAiApplyError] = useState<AiApplyError | null>(null);
  const [tab, setTab] = useState<Tab>(initial.tab);
  // jobs.json and ai-reviews.json are gitignored personal/AI artifacts —
  // fetched at runtime from the dev-server middleware so a fresh clone
  // works without those files existing.
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [aiReviews, setAiReviews] = useState<AiReviews>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchInFlight, setFetchInFlight] = useState(false);
  // null = not loaded yet (don't surface banner); false = scheduler not
  // installed (the banner's "install daily scheduler" CTA makes sense).
  const [schedulerInstalled, setSchedulerInstalled] = useState<boolean | null>(null);
  // Onboarding state. `null` while we're still fetching /api/preferences;
  // `false` once we've confirmed the user has finished onboarding (or
  // they bypass via the Profile tab); `true` triggers the wizard.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  // LOW-9: SchedulerProgress dock now lives at App root. Settings reads
  // schedulerCompletedAt to know when to refresh its status panel.
  const [schedulerCompletedAt, setSchedulerCompletedAt] = useState(0);
  // Apply-queue state. Polled at App root so both the Tik Tjob deck and the
  // Settings panel see the same snapshot. Skipped when the relevant tabs
  // aren't visible to keep the dev server quiet.
  const [applyQueue, setApplyQueue] = useState<ApplyQueueResponse | null>(null);
  const [swipeSkipIds, setSwipeSkipIds] = useState<Set<string>>(new Set());

  const refreshApplyQueue = useCallback(async (signal?: AbortSignal) => {
    try {
      const [qr, sr] = await Promise.all([
        fetch('/api/apply-queue', { signal }),
        fetch('/api/apply-queue/skips', { signal }),
      ]);
      if (qr.ok) setApplyQueue((await qr.json()) as ApplyQueueResponse);
      if (sr.ok) {
        const body = (await sr.json()) as { skips: string[] };
        setSwipeSkipIds(new Set(body.skips));
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // other network blip — keep the previous snapshot
    }
  }, []);

  const cancelQueueRow = useCallback(
    async (jobId: string): Promise<void> => {
      try {
        await fetch(`/api/apply-queue/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      } finally {
        await refreshApplyQueue();
      }
    },
    [refreshApplyQueue],
  );

  // Re-fetch jobs + AI reviews + applied entries (e.g. after the fetch-jobs
  // run completes, or after onboarding finishes). Reconciles applied
  // status with the current jobs list so URL-keyed entries land on the
  // right job ids. Optional signal lets the caller abort on unmount.
  const reloadJobsAndReviews = useCallback(async (signal?: AbortSignal) => {
    async function fetchOrFallback<T>(url: string, fallback: T): Promise<T> {
      try {
        const r = await fetch(url, { signal });
        return r.ok ? ((await r.json()) as T) : fallback;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return fallback;
      }
    }
    try {
      const [jobs, reviews, applied] = await Promise.all([
        fetchOrFallback<Job[]>('/api/jobs', []),
        fetchOrFallback<AiReviews>('/api/reviews', {}),
        fetchOrFallback<AppliedEntry[]>('/api/applied', []),
      ]);
      setAllJobs(jobs);
      setAiReviews(reviews);
      const byUrl = new Map(applied.map((e) => [e.url, e]));
      const nextApplied: AppliedMap = {};
      for (const j of jobs) {
        const e = byUrl.get(j.url);
        if (e) nextApplied[j.id] = e;
      }
      setAppliedById(nextApplied);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    }
  }, []);

  // POST /api/ai-apply — kicks off a background LLM run. The
  // <AiApplyProgress /> dock at root polls /api/ai-apply-progress for live
  // state. We just need to bookmark which jobId we asked for so per-row
  // buttons render the right state. Refuses 409 if another run is in flight.
  const triggerAiApply = useCallback(
    async (job: Job) => {
      if (aiApplyBusyId) return; // another run in flight; rely on disabled button
      const ok = window.confirm(
        `Generate a tailored application package for "${job.title}" at ${job.company ?? '?'}?\n\nThis runs your local LLM CLI (CV at config/cv.* re-attached automatically) and saves a markdown file at data/applications/${job.id}.md. The job will be auto-marked as applied.`,
      );
      if (!ok) return;
      setAiApplyBusyId(job.id);
      setAiApplyResult(null);
      setAiApplyError(null);
      try {
        const res = await fetch('/api/ai-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        });
        if (!res.ok && res.status !== 202) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        // Don't wait for the body — the dock will stream it in.
      } catch (err) {
        setAiApplyError({
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
        setAiApplyBusyId(null);
      }
    },
    [aiApplyBusyId],
  );

  // Called by the AiApplyProgress dock when a run finishes.
  const onAiApplyComplete = useCallback((dockState: DockState) => {
    if (dockState.status === 'done' && dockState.jobId && dockState.path) {
      setAiApplyResult({
        jobId: dockState.jobId,
        body: dockState.output,
        path: dockState.path,
      });
      // Sync applied state without an extra round-trip.
      if (dockState.applied) {
        const appliedJobId = dockState.jobId;
        const appliedEntry = dockState.applied;
        setAppliedById((prev) => ({
          ...prev,
          [appliedJobId]: {
            url: appliedEntry.url,
            status: appliedEntry.status as ApplicationStatus,
            date: appliedEntry.date,
            ...(appliedEntry.notes ? { notes: appliedEntry.notes } : {}),
          },
        }));
      }
    } else if (dockState.status === 'error' && dockState.jobId && dockState.error) {
      setAiApplyError({ jobId: dockState.jobId, error: dockState.error });
    }
    setAiApplyBusyId(null);
  }, []);

  // LOW-9: bookkeeping for the SchedulerProgress dock — Settings reads this
  // to know when to refresh its status panel after install/uninstall.
  const onSchedulerComplete = useCallback(() => {
    setSchedulerCompletedAt(Date.now());
  }, []);

  // POST /api/fetch-jobs — kicks off the aggregator. The FetchProgress
  // component handles its own polling + parent re-fetch on success.
  const triggerFetch = useCallback(async () => {
    try {
      const res = await fetch('/api/fetch-jobs', { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setApiError(errBody.error ?? `fetch run failed: HTTP ${res.status}`);
      }
    } catch (err) {
      setApiError(`fetch run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Load jobs + AI reviews + applied state + preferences on mount.
  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      async function loadPrefs(): Promise<PreferencesResponse> {
        try {
          const r = await fetch('/api/preferences', { signal: ctrl.signal });
          if (r.ok) return (await r.json()) as PreferencesResponse;
          return { provider: null, onboardedAt: null };
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err;
          return { provider: null, onboardedAt: null };
        }
      }
      try {
        const [, prefs] = await Promise.all([reloadJobsAndReviews(ctrl.signal), loadPrefs()]);
        setDataLoading(false);
        // First run = no `onboardedAt` stamp yet. Show the wizard.
        setShowOnboarding(!prefs.onboardedAt);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      }
    }
    void load();
    return () => ctrl.abort();
  }, [reloadJobsAndReviews]);

  // Load scheduler install state on mount and whenever an install/uninstall
  // op completes (Settings tab sets `schedulerCompletedAt`). Drives the
  // "Install daily scheduler" CTA in the staleness banner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: schedulerCompletedAt is the trigger for re-fetching — it intentionally isn't read inside.
  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const r = await fetch('/api/scheduler-status', { signal: ctrl.signal });
        if (!r.ok) {
          setSchedulerInstalled(false);
          return;
        }
        const data = (await r.json()) as { installed?: { aggregate?: boolean } };
        setSchedulerInstalled(Boolean(data.installed?.aggregate));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setSchedulerInstalled(false);
      }
    }
    void load();
    return () => ctrl.abort();
  }, [schedulerCompletedAt]);

  // Lifted from FetchProgress: track whether a fetch run is in flight so the
  // header "Refetch" button can disable itself without a second poller.
  const onFetchStatusChange = useCallback((status: 'idle' | 'running' | 'done' | 'error') => {
    setFetchInFlight(status === 'running');
  }, []);

  // Latest fetchedAt across all jobs + derived staleness flag. Drives the
  // banner: shown when >24h since the latest fetch AND scheduler isn't
  // installed (the banner CTA is to install it).
  const { latestFetchedAt, isStale } = useMemo(() => {
    let maxIso: string | null = null;
    let maxMs = 0;
    for (const j of allJobs) {
      const t = Date.parse(j.fetchedAt ?? '');
      if (Number.isFinite(t) && t > maxMs) {
        maxMs = t;
        maxIso = j.fetchedAt ?? null;
      }
    }
    return {
      latestFetchedAt: maxIso,
      isStale: maxMs > 0 && Date.now() - maxMs > 24 * 60 * 60 * 1000,
    };
  }, [allJobs]);

  // Poll the apply-queue while the swipe deck or Settings tab is mounted.
  // The two tabs are the only places the data is rendered, so other tabs
  // skip the refresh to keep the dev server quiet.
  useEffect(() => {
    if (tab !== 'swipe' && tab !== 'settings') return;
    const ctrl = new AbortController();
    async function tick() {
      await refreshApplyQueue(ctrl.signal);
    }
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [tab, refreshApplyQueue]);

  // Sync state → URL via replaceState so the back button doesn't get spammed.
  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set('q', search);
    if (category !== 'all') p.set('cat', category);
    if (source !== 'all') p.set('src', source);
    if (appliedOnly) p.set('applied', '1');
    if (sortKey !== 'fitScore') p.set('sort', sortKey);
    if (sortDir !== 'desc') p.set('dir', sortDir);
    if (!groupByCompany) p.set('group', '0');
    if (compact) p.set('compact', '1');
    if (expanded) p.set('expanded', expanded);
    if (expandedCompany) p.set('co', expandedCompany);
    if (tab !== 'jobs') p.set('tab', tab);
    const qs = p.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [
    search,
    category,
    source,
    appliedOnly,
    sortKey,
    sortDir,
    groupByCompany,
    compact,
    expanded,
    expandedCompany,
    tab,
  ]);

  const setApplied = useCallback<SetApplied>(
    async (job, status, notes) => {
      // MED-8: read snapshot directly from closure instead of via a no-op
      // state updater (which is unsound under StrictMode double-invocation).
      const prevSnapshot = appliedById[job.id];

      if (status === null) {
        setAppliedById((prev) => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
        try {
          const res = await fetch('/api/applied', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: job.url }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setApiError(null);
        } catch (err) {
          setAppliedById((prev) => {
            if (!prevSnapshot) return prev;
            return { ...prev, [job.id]: prevSnapshot };
          });
          setApiError(
            `Failed to clear status: ${err instanceof Error ? err.message : String(err)}`,
          );
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

      try {
        const res = await fetch('/api/applied', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(optimistic),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = (await res.json()) as AppliedEntry;
        setAppliedById((prev) => ({ ...prev, [job.id]: saved }));
        setApiError(null);
      } catch (err) {
        setAppliedById((prev) => {
          const next = { ...prev };
          if (prevSnapshot) next[job.id] = prevSnapshot;
          else delete next[job.id];
          return next;
        });
        setApiError(`Failed to save status: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [appliedById],
  );

  const sources = useMemo(() => {
    const s = new Set<Source>();
    for (const j of allJobs) s.add(j.source);
    return Array.from(s).sort();
  }, [allJobs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allJobs.filter((j) => {
      if (category !== 'all' && j.category !== category) return false;
      if (source !== 'all' && j.source !== source) return false;
      if (appliedOnly && !appliedById[j.id]) return false;
      if (q) {
        const hay = `${j.title} ${j.company ?? ''} ${j.location ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return a.id < b.id ? -1 : 1;
      return av < bv ? -1 * dir : 1 * dir;
    });
    return filtered;
  }, [allJobs, search, category, source, appliedOnly, sortKey, sortDir, appliedById]);

  // When grouping is on, fold jobs by lower-cased company. Single-job
  // "groups" render flat (no header); only multi-job groups get a collapsible
  // header. Within a group, jobs use the same sort as the table.
  const groups = useMemo<CompanyGroup[] | null>(() => {
    if (!groupByCompany) return null;
    const map = new Map<string, Job[]>();
    for (const j of visible) {
      const key = (j.company ?? '(unknown)').toLowerCase();
      const arr = map.get(key);
      if (arr) arr.push(j);
      else map.set(key, [j]);
    }
    const result: CompanyGroup[] = [];
    for (const [key, jobs] of map) {
      const topJob = jobs[0];
      if (!topJob) continue;
      result.push({
        key,
        display: topJob.company ?? '(unknown)',
        jobs,
        topScore: topJob.fitScore,
        topJob,
      });
    }
    const dir = sortDir === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      const av = sortValue(a.topJob, sortKey);
      const bv = sortValue(b.topJob, sortKey);
      if (av === bv) return a.display < b.display ? -1 : 1;
      return av < bv ? -1 * dir : 1 * dir;
    });
    return result;
  }, [visible, groupByCompany, sortKey, sortDir]);

  const totals = useMemo(() => {
    const counts: Record<Category, number> = { 'web3+ai': 0, web3: 0, ai: 0, general: 0 };
    for (const j of allJobs) counts[j.category]++;
    return counts;
  }, [allJobs]);

  const appliedCount = useMemo(() => Object.keys(appliedById).length, [appliedById]);

  // Derive the queue-status-by-jobId map and the set of jobIds with
  // non-terminal queue rows. Both the Jobs-tab badge and the SwipeDeck
  // filter use these.
  const queueStatusMap = useMemo<QueueStatusMap>(() => {
    const map: QueueStatusMap = {};
    if (!applyQueue) return map;
    for (const row of applyQueue.rows) {
      // Most recent row wins per jobId (queue can carry historical rows
      // when a job has been re-enqueued after a previous done/failed run).
      map[row.jobId] = row.status;
    }
    return map;
  }, [applyQueue]);

  const activeQueueJobIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const [jobId, status] of Object.entries(queueStatusMap)) {
      if (status === 'queued' || status === 'running') ids.add(jobId);
    }
    return ids;
  }, [queueStatusMap]);

  const appliedJobIds = useMemo<Set<string>>(
    () => new Set(Object.keys(appliedById)),
    [appliedById],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (showOnboarding === null) {
    return (
      <div className="app">
        <p className="placeholder">Loading…</p>
      </div>
    );
  }
  if (showOnboarding) {
    return (
      <div className="app">
        <Onboarding
          onComplete={async () => {
            setShowOnboarding(false);
            await reloadJobsAndReviews();
            // First-time user just finished onboarding and jobs.json is
            // still empty — kick off the first aggregator run automatically
            // so they don't land on an empty table with no obvious next
            // action. The FetchProgress card handles the live UI; the
            // poller will call reloadJobsAndReviews when it finishes.
            void triggerFetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader
        tab={tab}
        onTabChange={setTab}
        dataLoading={dataLoading}
        totalJobs={allJobs.length}
        totals={totals}
        appliedCount={appliedCount}
        visibleCount={visible.length}
      />

      {tab === 'profile' && <Profile />}
      {tab === 'settings' && (
        <Settings
          schedulerCompletedAt={schedulerCompletedAt}
          applyQueue={applyQueue}
          onCancelQueueRow={cancelQueueRow}
          onRefreshQueue={refreshApplyQueue}
        />
      )}
      {tab === 'swipe' && (
        <SwipeDeck
          allJobs={allJobs}
          appliedJobIds={appliedJobIds}
          queueRowJobIds={activeQueueJobIds}
          skippedJobIds={swipeSkipIds}
          onQueueRefresh={refreshApplyQueue}
        />
      )}
      {tab === 'jobs' && (
        <>
          {apiError && (
            <div className="api-error" role="alert">
              {apiError}{' '}
              <button type="button" onClick={() => setApiError(null)}>
                dismiss
              </button>
            </div>
          )}

          <JobsFilters
            search={search}
            category={category}
            source={source}
            appliedOnly={appliedOnly}
            groupByCompany={groupByCompany}
            compact={compact}
            sources={sources}
            categoryOptions={CATEGORY_OPTIONS}
            onSearchChange={setSearch}
            onCategoryChange={setCategory}
            onSourceChange={setSource}
            onAppliedOnlyChange={setAppliedOnly}
            onGroupByCompanyChange={setGroupByCompany}
            onCompactChange={setCompact}
            onReset={() => {
              setSearch('');
              setCategory('all');
              setSource('all');
              setAppliedOnly(false);
            }}
            onRefetch={triggerFetch}
            isFetching={fetchInFlight}
          />

          {isStale && schedulerInstalled === false && (
            <StalenessBanner
              fetchedAt={latestFetchedAt}
              isFetching={fetchInFlight}
              onRefetch={triggerFetch}
              onOpenScheduler={() => setTab('settings')}
            />
          )}

          {visible.length === 0 ? (
            allJobs.length === 0 ? (
              <FetchCta onFetch={triggerFetch} />
            ) : (
              <p className="empty">No jobs match the current filters.</p>
            )
          ) : (
            <table className={compact ? 'row-compact' : ''}>
              <JobsTableHead sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <tbody>
                {groups
                  ? groups.map((g) => (
                      <CompanyBlock
                        key={g.key}
                        group={g}
                        isOpen={expandedCompany === g.key}
                        expanded={expanded}
                        appliedById={appliedById}
                        aiReviews={aiReviews}
                        queueStatusMap={queueStatusMap}
                        setApplied={setApplied}
                        triggerAiApply={triggerAiApply}
                        aiApplyBusyId={aiApplyBusyId}
                        aiApplyResult={aiApplyResult}
                        aiApplyError={aiApplyError}
                        onToggleCompany={() =>
                          setExpandedCompany(expandedCompany === g.key ? null : g.key)
                        }
                        onToggleJob={(id) => setExpanded(expanded === id ? null : id)}
                      />
                    ))
                  : visible.map((j) => (
                      <FragmentRow
                        key={j.id}
                        job={j}
                        isOpen={expanded === j.id}
                        review={aiReviews[j.id]}
                        applied={appliedById[j.id]}
                        queueStatus={queueStatusMap[j.id] ?? null}
                        setApplied={setApplied}
                        triggerAiApply={triggerAiApply}
                        aiApplyBusyId={aiApplyBusyId}
                        aiApplyResult={aiApplyResult}
                        aiApplyError={aiApplyError}
                        onToggle={() => setExpanded(expanded === j.id ? null : j.id)}
                      />
                    ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {/* LOW-9: SchedulerProgress lifted from Settings to App root so it
          stays visible across tab changes and stacks predictably alongside
          the other two docks. CSS class .dock-stack handles layout. */}
      <div className="dock-stack">
        <FetchProgress onComplete={reloadJobsAndReviews} onStatusChange={onFetchStatusChange} />
        <AiApplyProgress onComplete={onAiApplyComplete} />
        <SchedulerProgress onComplete={onSchedulerComplete} />
      </div>
    </div>
  );
}

interface StalenessBannerProps {
  fetchedAt: string | null;
  isFetching: boolean;
  onRefetch: () => void;
  onOpenScheduler: () => void;
}

function StalenessBanner({
  fetchedAt,
  isFetching,
  onRefetch,
  onOpenScheduler,
}: StalenessBannerProps) {
  return (
    <div className="staleness-banner" role="status">
      <span className="staleness-banner-icon" aria-hidden>
        ⏳
      </span>
      <div className="staleness-banner-body">
        <strong>Your job data is stale.</strong>
        <span className="muted">
          Last fetched {fetchedAt ? relativeTime(fetchedAt) : 'over 24h ago'}. The daily scheduler
          isn't installed yet — without it, jobs only refresh when you trigger a fetch manually.
        </span>
      </div>
      <div className="staleness-banner-actions">
        <button
          type="button"
          className="staleness-banner-primary"
          onClick={onRefetch}
          disabled={isFetching}
        >
          {isFetching ? '⟳ Fetching…' : '⟳ Refetch now'}
        </button>
        <button type="button" className="staleness-banner-secondary" onClick={onOpenScheduler}>
          Install daily scheduler →
        </button>
      </div>
    </div>
  );
}

interface FetchCtaProps {
  onFetch: () => void;
}

function FetchCta({ onFetch }: FetchCtaProps) {
  return (
    <div className="fetch-cta">
      <h2>No jobs yet</h2>
      <p>
        Run the aggregator to pull listings from 13 sources (Ashby, Greenhouse, Lever, Hacker News,
        Web3 boards, etc.). Takes about 30–60 seconds.
      </p>
      <button type="button" className="fetch-cta-button" onClick={onFetch}>
        ✨ Fetch jobs now
      </button>
      <p className="muted fetch-cta-hint">
        After the first run you can schedule daily fetches with{' '}
        <code>scripts/install-launchd.sh</code> (macOS) or <code>scripts/install-cron.sh</code>{' '}
        (Linux).
      </p>
    </div>
  );
}

interface CompanyBlockProps {
  group: CompanyGroup;
  isOpen: boolean;
  expanded: string | null;
  appliedById: AppliedMap;
  aiReviews: AiReviews;
  queueStatusMap: QueueStatusMap;
  setApplied: SetApplied;
  triggerAiApply: (job: Job) => void;
  aiApplyBusyId: string | null;
  aiApplyResult: AiApplyResult | null;
  aiApplyError: AiApplyError | null;
  onToggleCompany: () => void;
  onToggleJob: (id: string) => void;
}

function CompanyBlock({
  group,
  isOpen,
  expanded,
  appliedById,
  aiReviews,
  queueStatusMap,
  setApplied,
  triggerAiApply,
  aiApplyBusyId,
  aiApplyResult,
  aiApplyError,
  onToggleCompany,
  onToggleJob,
}: CompanyBlockProps) {
  // Single-job groups render flat — no header noise.
  if (group.jobs.length === 1) {
    const job = group.jobs[0];
    if (!job) return null;
    const jobOpen = expanded === job.id;
    return (
      <FragmentRow
        job={job}
        isOpen={jobOpen}
        review={aiReviews[job.id]}
        applied={appliedById[job.id]}
        queueStatus={queueStatusMap[job.id] ?? null}
        setApplied={setApplied}
        triggerAiApply={triggerAiApply}
        aiApplyBusyId={aiApplyBusyId}
        aiApplyResult={aiApplyResult}
        aiApplyError={aiApplyError}
        onToggle={() => onToggleJob(job.id)}
      />
    );
  }
  return (
    <>
      <tr className={`group-row ${isOpen ? 'open' : ''}`} onClick={onToggleCompany}>
        <td className={`score ${scoreTier(group.topScore)}`}>
          <span className="caret" aria-hidden>
            {isOpen ? '▾' : '▸'}
          </span>
          {group.topScore}
        </td>
        <td colSpan={7}>
          <span className="group-co">{group.display}</span>
          <span className="group-count">
            {group.jobs.length} role{group.jobs.length === 1 ? '' : 's'}
          </span>
          {!isOpen && (
            <span className="group-preview" title={group.topJob.title}>
              {group.topJob.title}
            </span>
          )}
        </td>
      </tr>
      {isOpen &&
        group.jobs.map((j) => {
          const jobOpen = expanded === j.id;
          return (
            <FragmentRow
              key={j.id}
              job={j}
              isOpen={jobOpen}
              review={aiReviews[j.id]}
              applied={appliedById[j.id]}
              queueStatus={queueStatusMap[j.id] ?? null}
              setApplied={setApplied}
              triggerAiApply={triggerAiApply}
              aiApplyBusyId={aiApplyBusyId}
              aiApplyResult={aiApplyResult}
              aiApplyError={aiApplyError}
              onToggle={() => onToggleJob(j.id)}
              indent
            />
          );
        })}
    </>
  );
}

interface FragmentRowProps {
  job: Job;
  isOpen: boolean;
  review: AiReview | undefined;
  applied: AppliedEntry | undefined;
  queueStatus: QueueRowStatus | null;
  setApplied: SetApplied;
  triggerAiApply: (job: Job) => void;
  aiApplyBusyId: string | null;
  aiApplyResult: AiApplyResult | null;
  aiApplyError: AiApplyError | null;
  onToggle: () => void;
  indent?: boolean;
}

function FragmentRow({
  job,
  isOpen,
  review,
  applied,
  queueStatus,
  setApplied,
  triggerAiApply,
  aiApplyBusyId,
  aiApplyResult,
  aiApplyError,
  onToggle,
  indent,
}: FragmentRowProps) {
  const tier = scoreTier(job.fitScore);
  const rowClass = [
    applied ? 'applied' : '',
    isOpen ? 'open' : '',
    indent ? 'indent' : '',
    review ? `has-verdict verdict-stripe-${review.verdict}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const isMine = aiApplyBusyId === job.id;
  const otherBusy = aiApplyBusyId !== null && aiApplyBusyId !== job.id;
  const myResult = aiApplyResult && aiApplyResult.jobId === job.id ? aiApplyResult : null;
  const myError = aiApplyError && aiApplyError.jobId === job.id ? aiApplyError : null;
  // Hover-preview tooltip: show a longer excerpt than the inline preview so
  // the user can read more without expanding.
  const titleTooltip = job.bodyPreview
    ? `${job.title}\n\n${job.bodyPreview.slice(0, 600)}`
    : job.title;
  return (
    <>
      <tr className={rowClass} onClick={onToggle}>
        <td className={`score ${tier}`}>
          <span className="caret" aria-hidden>
            {isOpen ? '▾' : '▸'}
          </span>
          <ScoreBar score={job.fitScore} tier={tier} />
        </td>
        <td className="title" title={titleTooltip}>
          <span className="title-row">
            {applied && (
              <span className={`badge badge-${applied.status}`} title={applied.notes}>
                {STATUS_EMOJI[applied.status]} {applied.status}
              </span>
            )}
            {review && <span className={`badge verdict-${review.verdict}`}>{review.verdict}</span>}
            <QueueBadge status={queueStatus} />
            <span className="title-text">{job.title}</span>
            <SignalChips signals={job._signals} />
          </span>
          {job.bodyPreview && <p className="body-preview">{job.bodyPreview}</p>}
        </td>
        <td className="company" title={job.company ?? ''}>
          <span className="clamp-2">{job.company ?? '—'}</span>
        </td>
        <td className="location" title={job.location ?? ''}>
          <span className="clamp-2">{formatLocation(job)}</span>
        </td>
        <td>
          <span className="source">{job.source}</span>
        </td>
        <td>{job.salary ?? '—'}</td>
        <td className="muted">{relativeTime(job.postedAt)}</td>
        <td>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Apply ↗
          </a>
          {' · '}
          <button
            type="button"
            className="ai-apply-link"
            disabled={isMine || otherBusy}
            onClick={(e) => {
              e.stopPropagation();
              triggerAiApply(job);
            }}
            title={
              otherBusy
                ? 'Another AI Apply is in progress'
                : 'Generate a tailored cover letter + application package via your local LLM CLI'
            }
          >
            {isMine ? '… generating' : 'AI Apply ✨'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="detail-row">
          <td colSpan={8}>
            <DetailPanel
              job={job}
              review={review}
              applied={applied}
              setApplied={setApplied}
              aiApplyResult={myResult}
              aiApplyError={myError}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface SortableThProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}

function SortableTh({ label, active, dir, onClick }: SortableThProps) {
  const arrow = active ? (dir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <th>
      <button type="button" className="sort" onClick={onClick}>
        {label}
        {arrow}
      </button>
    </th>
  );
}

interface JobsTableHeadProps {
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
}

function JobsTableHead({ sortKey, sortDir, onToggleSort }: JobsTableHeadProps) {
  return (
    <thead>
      <tr>
        <SortableTh
          label="Score"
          active={sortKey === 'fitScore'}
          dir={sortDir}
          onClick={() => onToggleSort('fitScore')}
        />
        <th>Title</th>
        <th>Company</th>
        <th>Location</th>
        <th>Source</th>
        <SortableTh
          label="Salary"
          active={sortKey === 'salaryMax'}
          dir={sortDir}
          onClick={() => onToggleSort('salaryMax')}
        />
        <SortableTh
          label="Posted"
          active={sortKey === 'postedAt'}
          dir={sortDir}
          onClick={() => onToggleSort('postedAt')}
        />
        <th />
      </tr>
    </thead>
  );
}

// Compact display for the Location column. Falls back to "Remote" if the
// job is flagged remote but has no explicit location string, "—" if neither.
// Trim is here (not in the data) so we can keep the raw value in the
// `title` tooltip for the full text.
function formatLocation(job: Job): string {
  const raw = (job.location ?? '').trim();
  if (raw) return raw;
  if (job.remote) return 'Remote';
  return '—';
}

function scoreTier(score: number): 'score-high' | 'score-mid' | 'score-low' {
  if (score >= 80) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

function sortValue(j: Job, key: SortKey): number {
  if (key === 'fitScore') return j.fitScore;
  if (key === 'salaryMax') return j.salaryMax ?? 0;
  return j.postedAt ? new Date(j.postedAt).getTime() : 0;
}
