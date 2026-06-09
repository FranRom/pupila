import clsx from 'clsx';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AiApplyProgress, type AiApplyState as DockState } from './AiApplyProgress.tsx';
import styles from './App.module.css';
import { FetchProgress } from './FetchProgress.tsx';
import { relativeTime } from './format.ts';
import { AppHeader } from './jobs/AppHeader.tsx';
import { DetailPanel } from './jobs/DetailPanel.tsx';
import { JobsFilters, type RoleFilterOption } from './jobs/JobsFilters.tsx';
import { QueueBadge } from './jobs/QueueBadge.tsx';
import { ScoreBar, type ScoreTier } from './jobs/ScoreBar.tsx';
import { SignalChips } from './jobs/SignalChips.tsx';
import {
  type AiApplyError,
  type AiApplyResult,
  type AppliedMap,
  type SetApplied,
  STATUS_EMOJI,
} from './jobs/types.ts';
import { api, formatError } from './lib/api/index.ts';
import { useApplied } from './lib/hooks/useApplied.ts';
import { useApplyQueue } from './lib/hooks/useApplyQueue.ts';
import { useJobsData } from './lib/hooks/useJobsData.ts';
import { useOnboarding } from './lib/hooks/useOnboarding.ts';
import { useSwipeSkips } from './lib/hooks/useSwipeSkips.ts';
import { type SortDir, type SortKey, useUrlSyncedState } from './lib/hooks/useUrlSyncedState.ts';
import { SchedulerProgress } from './SchedulerProgress.tsx';
import badgeStyles from './styles/Badge.module.css';
import bannerStyles from './styles/Banner.module.css';
import buttonStyles from './styles/Button.module.css';
import dockStyles from './styles/Dock.module.css';
import type {
  AiReview,
  AiReviews,
  ApplicationStatus,
  AppliedEntry,
  Category,
  Job,
  QueueRowStatus,
  QueueStatusMap,
  Source,
} from './types.ts';

// Lazy-loaded tab subtrees. Each is its own bundle chunk so the initial Jobs
// view doesn't ship Settings/Profile/Onboarding code the user may never open.
// Wrap the named export as `default` to match `React.lazy()`'s required shape.
const Onboarding = lazy(() => import('./Onboarding.tsx').then((m) => ({ default: m.Onboarding })));
const Profile = lazy(() => import('./Profile.tsx').then((m) => ({ default: m.Profile })));
const Settings = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.Settings })));
const SwipeDeck = lazy(() =>
  import('./swipe/SwipeDeck.tsx').then((m) => ({ default: m.SwipeDeck })),
);

const SCORE_TIER_CLASS = {
  high: styles.scoreHigh,
  mid: styles.scoreMid,
  low: styles.scoreLow,
} as const;

const VERDICT_CLASS = {
  'strong-match': styles.verdictStrongMatch,
  match: styles.verdictMatch,
  'weak-match': styles.verdictWeakMatch,
  skip: styles.verdictSkip,
} as const;

const STATUS_BADGE_CLASS = {
  applied: badgeStyles.applied,
  interview: badgeStyles.interview,
  offer: badgeStyles.offer,
  rejected: badgeStyles.rejected,
  withdrawn: badgeStyles.withdrawn,
} as const;

const CATEGORY_OPTIONS: ReadonlyArray<Category | 'all'> = [
  'all',
  'web3+ai',
  'web3',
  'ai',
  'general',
];

interface CompanyGroup {
  /** lowercased — used as identity for expand state and grouping key */
  key: string;
  /** original casing for display */
  display: string;
  jobs: Job[];
  topScore: number;
  topJob: Job;
}

export function App() {
  // URL-synced filter / sort / group / tab state — readUrl on mount, write
  // back to history.replaceState on every change. See useUrlSyncedState.
  const {
    search,
    category,
    role,
    source,
    appliedOnly,
    showSkipped,
    queuedOnly,
    sortKey,
    sortDir,
    groupByCompany,
    compact,
    expanded,
    expandedCompany,
    tab,
    setSearch,
    setCategory,
    setRole,
    setSource,
    setAppliedOnly,
    setShowSkipped,
    setQueuedOnly,
    setSortKey,
    setSortDir,
    setGroupByCompany,
    setCompact,
    setTab,
    toggleExpanded,
    toggleExpandedCompany,
  } = useUrlSyncedState();

  // Cross-cutting UI banner — shared by every async failure path.
  const [apiError, setApiError] = useState<string | null>(null);
  const onApiError = useCallback((msg: string) => setApiError(msg), []);
  const onApiSuccess = useCallback(() => setApiError(null), []);

  // Lifted AI Apply state — the dock at App root is the only source of
  // truth for "is something running"; FragmentRow reads {busyJobId, result,
  // error} to know what to render and whether to disable its button.
  const [aiApplyBusyId, setAiApplyBusyId] = useState<string | null>(null);
  const [aiApplyResult, setAiApplyResult] = useState<AiApplyResult | null>(null);
  const [aiApplyError, setAiApplyError] = useState<AiApplyError | null>(null);

  // jobs.json + ai-reviews.json — server snapshot.
  const { allJobs, aiReviews, loading: dataLoading, reload: reloadJobsAndReviews } = useJobsData();

  // applied tracking: jobId-keyed map reconciled against allJobs.
  const {
    appliedById,
    setApplied,
    upsertEntry: upsertApplied,
  } = useApplied({
    allJobs,
    onError: onApiError,
    onSuccess: onApiSuccess,
  });

  // AI Apply queue: snapshot + mutations + derived helpers + tab-gated poll.
  const {
    queue: applyQueue,
    swipeSkipIds,
    statusMap: queueStatusMap,
    activeJobIds: activeQueueJobIds,
    refresh: refreshApplyQueue,
    enqueue: enqueueJob,
    cancel: cancelQueueRow,
    addSkip,
    removeSkip,
  } = useApplyQueue({
    pollEnabled: tab === 'swipe' || tab === 'settings',
    onError: onApiError,
  });

  // Unified skip predicate combining server skips + AI-verdict skips + local
  // AI-override Set in localStorage.
  const { isJobSkipped, toggleSkip } = useSwipeSkips({
    swipeSkipIds,
    aiReviews,
    addSkip,
    removeSkip,
    onError: onApiError,
  });

  // First-run wizard gate. Owns its own mount-probe; exposes a reprobe()
  // we plumb into the clean flow so a destructive reset routes back to
  // onboarding without a hard refresh.
  const {
    showOnboarding,
    reprobe: reprobeOnboarding,
    dismiss: dismissOnboarding,
  } = useOnboarding();

  // Status panels that don't justify their own hooks yet.
  const [fetchInFlight, setFetchInFlight] = useState(false);
  const [schedulerInstalled, setSchedulerInstalled] = useState<boolean | null>(null);
  const [schedulerCompletedAt, setSchedulerCompletedAt] = useState(0);

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
      const r = await api.aiApply.run(job.id);
      // 202 Accepted is success: the dock will stream the body in.
      // (request() treats 2xx as ok, so we just check r.ok here.)
      if (!r.ok) {
        setAiApplyError({ jobId: job.id, error: formatError(r.error) });
        setAiApplyBusyId(null);
      }
    },
    [aiApplyBusyId],
  );

  // Called by the AiApplyProgress dock when a run finishes.
  const onAiApplyComplete = useCallback(
    (dockState: DockState) => {
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
          upsertApplied(appliedJobId, {
            url: appliedEntry.url,
            status: appliedEntry.status as ApplicationStatus,
            date: appliedEntry.date,
            ...(appliedEntry.notes ? { notes: appliedEntry.notes } : {}),
          });
        }
      } else if (dockState.status === 'error' && dockState.jobId && dockState.error) {
        setAiApplyError({ jobId: dockState.jobId, error: dockState.error });
      }
      setAiApplyBusyId(null);
    },
    [upsertApplied],
  );

  // LOW-9: bookkeeping for the SchedulerProgress dock — Settings reads this
  // to know when to refresh its status panel after install/uninstall.
  const onSchedulerComplete = useCallback(() => {
    setSchedulerCompletedAt(Date.now());
  }, []);

  // POST /api/fetch-jobs — kicks off the aggregator. The FetchProgress
  // component handles its own polling + parent re-fetch on success.
  const triggerFetch = useCallback(async () => {
    const r = await api.fetchJobs.trigger();
    if (!r.ok) setApiError(`fetch run failed: ${formatError(r.error)}`);
  }, []);

  // Settings' Maintenance panel calls this after a clean completes. A
  // destructive clean wipes preferences + jobs on disk; we need to re-probe
  // both so the user lands on the wizard (or an empty Jobs view) instead of
  // a stale in-memory snapshot.
  const onCleanComplete = useCallback(async () => {
    await Promise.all([reprobeOnboarding(), reloadJobsAndReviews(), refreshApplyQueue()]);
  }, [reprobeOnboarding, reloadJobsAndReviews, refreshApplyQueue]);

  // Load scheduler install state on mount and whenever an install/uninstall
  // op completes (Settings tab sets `schedulerCompletedAt`). Drives the
  // "Install daily scheduler" CTA in the staleness banner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: schedulerCompletedAt is the trigger for re-fetching — it intentionally isn't read inside.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      const r = await api.scheduler.status({ signal: ctrl.signal });
      if (!r.ok) {
        if (r.error.kind === 'abort') return;
        setSchedulerInstalled(false);
        return;
      }
      setSchedulerInstalled(Boolean(r.value.installed.aggregate));
    };
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

  const sources = useMemo(() => {
    const s = new Set<Source>();
    for (const j of allJobs) s.add(j.source);
    return Array.from(s).sort();
  }, [allJobs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allJobs.filter((j) => {
      if (category !== 'all' && j.category !== category) return false;
      if (role !== 'all') {
        const matches = j.roleMatches ?? [];
        if (role === '__none' ? matches.length > 0 : !matches.includes(role)) return false;
      }
      if (source !== 'all' && j.source !== source) return false;
      if (appliedOnly && !appliedById[j.id]) return false;
      if (!showSkipped && isJobSkipped(j.id)) return false;
      if (queuedOnly) {
        const qs = queueStatusMap[j.id];
        if (qs !== 'queued' && qs !== 'running') return false;
      }
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
  }, [
    allJobs,
    search,
    category,
    role,
    source,
    appliedOnly,
    showSkipped,
    isJobSkipped,
    queuedOnly,
    queueStatusMap,
    sortKey,
    sortDir,
    appliedById,
  ]);

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

  // Role-filter options derived from the role ids actually present on jobs, so
  // the dropdown only offers roles that match something. 'All roles' is always
  // first; '(no role match)' appears only when some job matched no role.
  const roleOptions = useMemo<RoleFilterOption[]>(() => {
    const ids = new Set<string>();
    let hasUnmatched = false;
    for (const j of allJobs) {
      const matches = j.roleMatches ?? [];
      if (matches.length === 0) hasUnmatched = true;
      for (const id of matches) ids.add(id);
    }
    if (ids.size === 0) return [];
    const opts: RoleFilterOption[] = [{ value: 'all', label: 'All roles' }];
    for (const id of [...ids].sort()) opts.push({ value: id, label: id });
    if (hasUnmatched) opts.push({ value: '__none', label: 'No role match' });
    return opts;
  }, [allJobs]);

  const appliedCount = useMemo(() => Object.keys(appliedById).length, [appliedById]);

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
      <div className={styles.app}>
        <p className={styles.placeholder}>Loading…</p>
      </div>
    );
  }
  if (showOnboarding) {
    return (
      <div className={styles.app}>
        <Suspense fallback={<p className={styles.placeholder}>Loading…</p>}>
          <Onboarding
            onComplete={async () => {
              dismissOnboarding();
              await reloadJobsAndReviews();
              // First-time user just finished onboarding and jobs.json is
              // still empty — kick off the first aggregator run automatically
              // so they don't land on an empty table with no obvious next
              // action. The FetchProgress card handles the live UI; the
              // poller will call reloadJobsAndReviews when it finishes.
              void triggerFetch();
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <AppHeader
        tab={tab}
        onTabChange={setTab}
        dataLoading={dataLoading}
        totalJobs={allJobs.length}
        totals={totals}
        appliedCount={appliedCount}
        visibleCount={visible.length}
      />

      {/* Each lazy tab needs a Suspense boundary; sharing one would unmount
          and re-suspend on every tab swap. Per-tab fallbacks let the user
          see they're loading the chunk on first open. */}
      {tab === 'profile' && (
        <Suspense fallback={<p className={styles.placeholder}>Loading profile…</p>}>
          <Profile />
        </Suspense>
      )}
      {tab === 'settings' && (
        <Suspense fallback={<p className={styles.placeholder}>Loading settings…</p>}>
          <Settings
            schedulerCompletedAt={schedulerCompletedAt}
            applyQueue={applyQueue}
            onCancelQueueRow={cancelQueueRow}
            onRefreshQueue={refreshApplyQueue}
            onCleanComplete={onCleanComplete}
          />
        </Suspense>
      )}
      {tab === 'swipe' && (
        <Suspense fallback={<p className={styles.placeholder}>Loading Jinder…</p>}>
          <SwipeDeck
            allJobs={allJobs}
            appliedJobIds={appliedJobIds}
            queueRowJobIds={activeQueueJobIds}
            skippedJobIds={swipeSkipIds}
            onQueueRefresh={refreshApplyQueue}
          />
        </Suspense>
      )}
      {tab === 'jobs' && (
        <>
          {apiError && (
            <div className={bannerStyles.error} role="alert">
              <span>{apiError}</span>
              <button type="button" onClick={() => setApiError(null)}>
                dismiss
              </button>
            </div>
          )}

          <JobsFilters
            search={search}
            category={category}
            role={role}
            source={source}
            appliedOnly={appliedOnly}
            showSkipped={showSkipped}
            queuedOnly={queuedOnly}
            groupByCompany={groupByCompany}
            compact={compact}
            sources={sources}
            categoryOptions={CATEGORY_OPTIONS}
            roleOptions={roleOptions}
            onSearchChange={setSearch}
            onCategoryChange={setCategory}
            onRoleChange={setRole}
            onSourceChange={setSource}
            onAppliedOnlyChange={setAppliedOnly}
            onShowSkippedChange={setShowSkipped}
            onQueuedOnlyChange={setQueuedOnly}
            onGroupByCompanyChange={setGroupByCompany}
            onCompactChange={setCompact}
            onReset={() => {
              setSearch('');
              setCategory('all');
              setRole('all');
              setSource('all');
              setAppliedOnly(false);
              setShowSkipped(false);
              setQueuedOnly(false);
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
              <p className={styles.empty}>No jobs match the current filters.</p>
            )
          ) : (
            <table className={clsx(styles.table, compact && styles.tableCompact)}>
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
                        isJobSkipped={isJobSkipped}
                        toggleSkip={toggleSkip}
                        cancelQueueRow={cancelQueueRow}
                        enqueueJob={enqueueJob}
                        aiReviews={aiReviews}
                        queueStatusMap={queueStatusMap}
                        setApplied={setApplied}
                        triggerAiApply={triggerAiApply}
                        aiApplyBusyId={aiApplyBusyId}
                        aiApplyResult={aiApplyResult}
                        aiApplyError={aiApplyError}
                        onToggleCompany={toggleExpandedCompany}
                        onToggleJob={toggleExpanded}
                      />
                    ))
                  : visible.map((j) => (
                      <FragmentRow
                        key={j.id}
                        job={j}
                        isOpen={expanded === j.id}
                        review={aiReviews[j.id]}
                        applied={appliedById[j.id]}
                        isSkipped={isJobSkipped(j.id)}
                        queueStatus={queueStatusMap[j.id] ?? null}
                        setApplied={setApplied}
                        toggleSkip={toggleSkip}
                        cancelQueueRow={cancelQueueRow}
                        enqueueJob={enqueueJob}
                        triggerAiApply={triggerAiApply}
                        aiApplyBusyId={aiApplyBusyId}
                        aiApplyResult={aiApplyResult}
                        aiApplyError={aiApplyError}
                        onToggle={toggleExpanded}
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
      <div className={dockStyles.dockStack}>
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
    <div className={styles.stalenessBanner} role="status">
      <span className={styles.stalenessIcon} aria-hidden>
        ⏳
      </span>
      <div className={styles.stalenessBody}>
        <strong>Your job data is stale.</strong>
        <span className={styles.muted}>
          Last fetched {fetchedAt ? relativeTime(fetchedAt) : 'over 24h ago'}. The daily scheduler
          isn't installed yet, without it, jobs only refresh when you trigger a fetch manually.
        </span>
      </div>
      <div className={styles.stalenessActions}>
        <button
          type="button"
          className={clsx(buttonStyles.secondary, buttonStyles.sm)}
          onClick={onRefetch}
          disabled={isFetching}
        >
          {isFetching ? 'Fetching…' : 'Refetch now'}
        </button>
        <button
          type="button"
          className={clsx(buttonStyles.primary, buttonStyles.sm)}
          onClick={onOpenScheduler}
        >
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
    <div className={styles.fetchCta}>
      <h2>No jobs yet</h2>
      <p>Run the aggregator to pull listings from all the sources.</p>
      <button
        type="button"
        className={clsx(buttonStyles.primary, buttonStyles.lg)}
        onClick={onFetch}
      >
        Fetch jobs now
      </button>
      <div className={styles.fetchCtaHint}>
        <p>After the first run you can also schedule daily fetches automatically with:</p>
        <ul>
          <li>
            <code>scripts/install-launchd.sh</code> (macOS)
          </li>
          <li>
            <code>scripts/install-cron.sh</code> (Linux)
          </li>
        </ul>
      </div>
    </div>
  );
}

interface CompanyBlockProps {
  group: CompanyGroup;
  isOpen: boolean;
  expanded: string | null;
  appliedById: AppliedMap;
  isJobSkipped: (jobId: string) => boolean;
  aiReviews: AiReviews;
  queueStatusMap: QueueStatusMap;
  setApplied: SetApplied;
  toggleSkip: (jobId: string) => void;
  cancelQueueRow: (jobId: string) => Promise<void>;
  enqueueJob: (jobId: string) => Promise<void>;
  triggerAiApply: (job: Job) => void;
  aiApplyBusyId: string | null;
  aiApplyResult: AiApplyResult | null;
  aiApplyError: AiApplyError | null;
  /** Receives the company group key — App passes a stable functional-setState
   *  toggle so React.memo on rows isn't defeated by per-render arrows. */
  onToggleCompany: (key: string) => void;
  onToggleJob: (id: string) => void;
}

const CompanyBlock = memo(function CompanyBlock({
  group,
  isOpen,
  expanded,
  appliedById,
  isJobSkipped,
  aiReviews,
  queueStatusMap,
  setApplied,
  toggleSkip,
  cancelQueueRow,
  enqueueJob,
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
        isSkipped={isJobSkipped(job.id)}
        queueStatus={queueStatusMap[job.id] ?? null}
        setApplied={setApplied}
        toggleSkip={toggleSkip}
        cancelQueueRow={cancelQueueRow}
        enqueueJob={enqueueJob}
        triggerAiApply={triggerAiApply}
        aiApplyBusyId={aiApplyBusyId}
        aiApplyResult={aiApplyResult}
        aiApplyError={aiApplyError}
        onToggle={onToggleJob}
      />
    );
  }
  return (
    <>
      <tr
        className={clsx(styles.groupRow, isOpen && styles.rowOpen)}
        onClick={() => onToggleCompany(group.key)}
      >
        <td className={clsx(styles.score, SCORE_TIER_CLASS[scoreTier(group.topScore)])}>
          <div className={styles.scoreCell}>
            <span className={styles.caret} aria-hidden>
              {isOpen ? '×' : '+'}
            </span>
            {group.topScore}
          </div>
        </td>
        <td colSpan={7}>
          <span className={styles.groupCo}>{group.display}</span>
          <span className={styles.groupCount}>
            {group.jobs.length} role{group.jobs.length === 1 ? '' : 's'}
          </span>
          {!isOpen && (
            <span className={styles.groupPreview} title={group.topJob.title}>
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
              isSkipped={isJobSkipped(j.id)}
              queueStatus={queueStatusMap[j.id] ?? null}
              setApplied={setApplied}
              toggleSkip={toggleSkip}
              cancelQueueRow={cancelQueueRow}
              enqueueJob={enqueueJob}
              triggerAiApply={triggerAiApply}
              aiApplyBusyId={aiApplyBusyId}
              aiApplyResult={aiApplyResult}
              aiApplyError={aiApplyError}
              onToggle={onToggleJob}
              indent
            />
          );
        })}
    </>
  );
});

interface FragmentRowProps {
  job: Job;
  isOpen: boolean;
  review: AiReview | undefined;
  applied: AppliedEntry | undefined;
  isSkipped: boolean;
  queueStatus: QueueRowStatus | null;
  setApplied: SetApplied;
  toggleSkip: (jobId: string) => void;
  cancelQueueRow: (jobId: string) => Promise<void>;
  enqueueJob: (jobId: string) => Promise<void>;
  triggerAiApply: (job: Job) => void;
  aiApplyBusyId: string | null;
  aiApplyResult: AiApplyResult | null;
  aiApplyError: AiApplyError | null;
  /** Receives the job id — App passes a stable functional-setState toggle so
   *  this row component is React.memo-safe across keystrokes. */
  onToggle: (id: string) => void;
  indent?: boolean;
}

const FragmentRow = memo(function FragmentRow({
  job,
  isOpen,
  review,
  applied,
  isSkipped,
  queueStatus,
  setApplied,
  toggleSkip,
  cancelQueueRow,
  enqueueJob,
  triggerAiApply,
  aiApplyBusyId,
  aiApplyResult,
  aiApplyError,
  onToggle,
  indent,
}: FragmentRowProps) {
  const tier = scoreTier(job.fitScore);
  const rowClass = clsx(
    applied && styles.rowApplied,
    isSkipped && styles.rowSkipped,
    isOpen && styles.rowOpen,
    indent && styles.indent,
  );
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
      <tr className={rowClass} onClick={() => onToggle(job.id)}>
        <td className={clsx(styles.score, SCORE_TIER_CLASS[tier])}>
          <div className={styles.scoreCell}>
            <span className={styles.caret} aria-hidden>
              {isOpen ? '▾' : '▸'}
            </span>
            <ScoreBar score={job.fitScore} tier={tier} />
          </div>
        </td>
        <td className={styles.tdTitle} title={titleTooltip}>
          <span className={styles.titleRow}>
            {applied && (
              <span
                className={clsx(badgeStyles.base, STATUS_BADGE_CLASS[applied.status])}
                title={applied.notes}
              >
                {STATUS_EMOJI[applied.status]} {applied.status}
              </span>
            )}
            {isSkipped && !applied && (
              <span className={badgeStyles.skipped} title="Skipped from Jinder">
                skipped
              </span>
            )}
            {review && review.verdict !== 'skip' && (
              <span className={clsx(badgeStyles.base, VERDICT_CLASS[review.verdict])}>
                {review.verdict}
              </span>
            )}
            {job.roleMatches?.map((roleId) => (
              <span
                key={roleId}
                className={badgeStyles.role}
                title={`Matches your "${roleId}" role interest`}
              >
                {roleId}
              </span>
            ))}
            <QueueBadge status={queueStatus} />
            <span className={styles.titleText}>{job.title}</span>
          </span>
          {job._signals && (
            <div className={styles.signalChipRow}>
              <SignalChips signals={job._signals} />
            </div>
          )}
          {job.bodyPreview && <p className={styles.bodyPreview}>{job.bodyPreview}</p>}
        </td>
        <td className={styles.tdCompany} title={job.company ?? ''}>
          <span className={styles.clamp2}>{job.company ?? '—'}</span>
        </td>
        <td className={styles.tdLocation} title={job.location ?? ''}>
          <span className={styles.clamp2}>{formatLocation(job)}</span>
        </td>
        <td>
          <span className={styles.source}>{job.source}</span>
        </td>
        <td>{job.salary ?? '—'}</td>
        <td className={styles.tdMuted}>{relativeTime(job.postedAt)}</td>
        <td className={styles.tdActions}>
          <div className={styles.rowActions}>
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.actionLink}
              onClick={(e) => e.stopPropagation()}
            >
              Apply
              <span className={styles.actionArrow} aria-hidden>
                ↗
              </span>
            </a>
            <button
              type="button"
              className={styles.actionLink}
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
              {isMine ? '… generating' : 'AI Apply'}
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className={styles.detailRow}>
          <td colSpan={8}>
            <DetailPanel
              job={job}
              review={review}
              applied={applied}
              isSkipped={isSkipped}
              queueStatus={queueStatus}
              setApplied={setApplied}
              toggleSkip={toggleSkip}
              cancelQueueRow={cancelQueueRow}
              enqueueJob={enqueueJob}
              aiApplyResult={myResult}
              aiApplyError={myError}
            />
          </td>
        </tr>
      )}
    </>
  );
});

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
      <button type="button" className={styles.sortButton} onClick={onClick}>
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

function scoreTier(score: number): ScoreTier {
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

function sortValue(j: Job, key: SortKey): number {
  if (key === 'fitScore') return j.fitScore;
  if (key === 'salaryMax') return j.salaryMax ?? 0;
  return j.postedAt ? new Date(j.postedAt).getTime() : 0;
}
