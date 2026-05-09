import { useCallback, useEffect, useMemo, useState } from 'react';
import { FetchProgress } from './FetchProgress.tsx';
import { Onboarding } from './Onboarding.tsx';
import { Profile } from './Profile.tsx';
import type {
  AiReview,
  AiReviews,
  ApplicationStatus,
  AppliedEntry,
  Category,
  Job,
  JobSignals,
  Source,
} from './types.ts';

type Tab = 'jobs' | 'profile';

interface PreferencesResponse {
  provider: string | null;
  onboardedAt: string | null;
}

const STATUS_EMOJI: Record<ApplicationStatus, string> = {
  applied: '📝',
  interview: '💬',
  offer: '🎯',
  rejected: '❌',
  withdrawn: '⏸',
};

const STATUS_OPTIONS: ApplicationStatus[] = [
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

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

type AppliedMap = Record<string, AppliedEntry>;
type SetApplied = (job: Job, status: ApplicationStatus | null, notes?: string) => Promise<void>;

function readUrl(): {
  search: string;
  category: Category | 'all';
  source: Source | 'all';
  appliedOnly: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  groupByCompany: boolean;
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
    expanded: p.get('expanded'),
    expandedCompany: p.get('co'),
    tab: tab === 'profile' ? 'profile' : 'jobs',
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
  const [expanded, setExpanded] = useState<string | null>(initial.expanded);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(initial.expandedCompany);
  const [appliedById, setAppliedById] = useState<AppliedMap>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initial.tab);
  // jobs.json and ai-reviews.json are gitignored personal/AI artifacts —
  // fetched at runtime from the dev-server middleware so a fresh clone
  // works without those files existing.
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [aiReviews, setAiReviews] = useState<AiReviews>({});
  const [dataLoading, setDataLoading] = useState(true);
  // Onboarding state. `null` while we're still fetching /api/preferences;
  // `false` once we've confirmed the user has finished onboarding (or
  // they bypass via the Profile tab); `true` triggers the wizard.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  // Re-fetch jobs + AI reviews + applied entries (e.g. after the fetch-jobs
  // run completes, or after onboarding finishes). Reconciles applied
  // status with the current jobs list so URL-keyed entries land on the
  // right job ids.
  const reloadJobsAndReviews = useCallback(async () => {
    const [jobs, reviews, applied] = await Promise.all([
      fetch('/api/jobs')
        .then((r) => (r.ok ? (r.json() as Promise<Job[]>) : Promise.resolve([] as Job[])))
        .catch(() => [] as Job[]),
      fetch('/api/reviews')
        .then((r) => (r.ok ? (r.json() as Promise<AiReviews>) : Promise.resolve({} as AiReviews)))
        .catch(() => ({}) as AiReviews),
      fetch('/api/applied')
        .then((r) => (r.ok ? (r.json() as Promise<AppliedEntry[]>) : Promise.resolve([])))
        .catch(() => [] as AppliedEntry[]),
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
    let cancelled = false;
    const loadPrefs = fetch('/api/preferences')
      .then((r) =>
        r.ok
          ? (r.json() as Promise<PreferencesResponse>)
          : Promise.resolve({ provider: null, onboardedAt: null } as PreferencesResponse),
      )
      .catch(() => ({ provider: null, onboardedAt: null }) as PreferencesResponse);
    Promise.all([reloadJobsAndReviews(), loadPrefs]).then(([, prefs]) => {
      if (cancelled) return;
      setDataLoading(false);
      // First run = no `onboardedAt` stamp yet. Show the wizard.
      setShowOnboarding(!prefs.onboardedAt);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadJobsAndReviews]);

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
    expanded,
    expandedCompany,
    tab,
  ]);

  const setApplied = useCallback<SetApplied>(async (job, status, notes) => {
    let prevSnapshot: AppliedEntry | undefined;
    setAppliedById((prev) => {
      prevSnapshot = prev[job.id];
      return prev;
    });

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
        setApiError(`Failed to clear status: ${err instanceof Error ? err.message : String(err)}`);
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
  }, []);

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
      <header>
        <div>
          <h1>Job hunt</h1>
          <p className="subtitle">
            {dataLoading ? (
              'loading…'
            ) : (
              <>
                {allJobs.length} jobs · {totals['web3+ai']} web3+ai · {totals.web3} web3 ·{' '}
                {totals.ai} ai · {totals.general} general · {appliedCount} applied
              </>
            )}
          </p>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === 'jobs' ? 'tab-active' : ''}`}
            onClick={() => setTab('jobs')}
          >
            Jobs
          </button>
          <button
            type="button"
            className={`tab ${tab === 'profile' ? 'tab-active' : ''}`}
            onClick={() => setTab('profile')}
          >
            Profile
          </button>
        </div>
        {tab === 'jobs' && (
          <div className="counts">
            showing <strong>{visible.length}</strong>
          </div>
        )}
      </header>

      {tab === 'profile' && <Profile />}
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

          <div className="filters">
            <input
              type="search"
              placeholder="Search title / company / location"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category | 'all')}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All categories' : c}
                </option>
              ))}
            </select>

            <select value={source} onChange={(e) => setSource(e.target.value as Source | 'all')}>
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={appliedOnly}
                onChange={(e) => setAppliedOnly(e.target.checked)}
              />
              Applied only
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={groupByCompany}
                onChange={(e) => setGroupByCompany(e.target.checked)}
              />
              Group by company
            </label>

            {(search || category !== 'all' || source !== 'all' || appliedOnly) && (
              <button
                type="button"
                className="reset"
                onClick={() => {
                  setSearch('');
                  setCategory('all');
                  setSource('all');
                  setAppliedOnly(false);
                }}
              >
                Reset
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            allJobs.length === 0 ? (
              <FetchCta onFetch={triggerFetch} />
            ) : (
              <p className="empty">No jobs match the current filters.</p>
            )
          ) : (
            <table>
              <thead>
                <tr>
                  <SortableTh
                    label="Score"
                    active={sortKey === 'fitScore'}
                    dir={sortDir}
                    onClick={() => toggleSort('fitScore')}
                  />
                  <th>Title</th>
                  <th>Company</th>
                  <th>Source</th>
                  <SortableTh
                    label="Salary"
                    active={sortKey === 'salaryMax'}
                    dir={sortDir}
                    onClick={() => toggleSort('salaryMax')}
                  />
                  <SortableTh
                    label="Posted"
                    active={sortKey === 'postedAt'}
                    dir={sortDir}
                    onClick={() => toggleSort('postedAt')}
                  />
                  <th />
                </tr>
              </thead>
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
                        setApplied={setApplied}
                        onToggleCompany={() =>
                          setExpandedCompany(expandedCompany === g.key ? null : g.key)
                        }
                        onToggleJob={(id) => setExpanded(expanded === id ? null : id)}
                      />
                    ))
                  : visible.map((j) => {
                      const isOpen = expanded === j.id;
                      const review = aiReviews[j.id];
                      return (
                        <FragmentRow
                          key={j.id}
                          job={j}
                          isOpen={isOpen}
                          review={review}
                          applied={appliedById[j.id]}
                          setApplied={setApplied}
                          onToggle={() => setExpanded(isOpen ? null : j.id)}
                        />
                      );
                    })}
              </tbody>
            </table>
          )}
        </>
      )}
      <FetchProgress onComplete={reloadJobsAndReviews} />
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
  setApplied: SetApplied;
  onToggleCompany: () => void;
  onToggleJob: (id: string) => void;
}

function CompanyBlock({
  group,
  isOpen,
  expanded,
  appliedById,
  aiReviews,
  setApplied,
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
        setApplied={setApplied}
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
        <td colSpan={6}>
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
              setApplied={setApplied}
              onToggle={() => onToggleJob(j.id)}
              indent
            />
          );
        })}
    </>
  );
}

interface AiApplyState {
  busy: boolean;
  body: string | null;
  path: string | null;
  error: string | null;
}

interface AiApplyResponse {
  ok: boolean;
  path: string;
  body: string;
  applied?: AppliedEntry;
  provider?: string;
}

interface FragmentRowProps {
  job: Job;
  isOpen: boolean;
  review: AiReview | undefined;
  applied: AppliedEntry | undefined;
  setApplied: SetApplied;
  onToggle: () => void;
  indent?: boolean;
}

function FragmentRow({
  job,
  isOpen,
  review,
  applied,
  setApplied,
  onToggle,
  indent,
}: FragmentRowProps) {
  const rowClass = [applied ? 'applied' : '', isOpen ? 'open' : '', indent ? 'indent' : '']
    .filter(Boolean)
    .join(' ');
  const [aiApply, setAiApply] = useState<AiApplyState>({
    busy: false,
    body: null,
    path: null,
    error: null,
  });

  const triggerAiApply = useCallback(async () => {
    if (
      !window.confirm(
        `Generate a tailored application package for "${job.title}" at ${job.company ?? '?'}?\n\nThis runs your local LLM CLI and saves a markdown file at data/applications/${job.id}.md. The job will be auto-marked as applied.`,
      )
    ) {
      return;
    }
    setAiApply({ busy: true, body: null, path: null, error: null });
    try {
      const res = await fetch('/api/ai-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AiApplyResponse;
      setAiApply({ busy: false, body: data.body, path: data.path, error: null });
      // The server already wrote applied.json server-side — sync local state
      // by refetching, mirroring what setApplied('applied') would do but
      // without the optimistic round-trip.
      if (data.applied) {
        await setApplied(job, data.applied.status as ApplicationStatus, data.applied.notes);
      }
    } catch (err) {
      setAiApply({
        busy: false,
        body: null,
        path: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [job, setApplied]);
  return (
    <>
      <tr className={rowClass} onClick={onToggle}>
        <td className={`score ${scoreTier(job.fitScore)}`}>
          <span className="caret" aria-hidden>
            {isOpen ? '▾' : '▸'}
          </span>
          {job.fitScore}
        </td>
        <td className="title" title={job.title}>
          <span className="clamp-2">
            {applied && (
              <span className={`badge badge-${applied.status}`} title={applied.notes}>
                {STATUS_EMOJI[applied.status]} {applied.status}
              </span>
            )}
            {review && <span className={`badge verdict-${review.verdict}`}>{review.verdict}</span>}
            {job.title}
          </span>
        </td>
        <td className="company" title={job.company ?? ''}>
          <span className="clamp-2">{job.company ?? '—'}</span>
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
            disabled={aiApply.busy}
            onClick={(e) => {
              e.stopPropagation();
              void triggerAiApply();
            }}
            title="Generate a tailored cover letter + application package via your local LLM CLI"
          >
            {aiApply.busy ? '… generating' : 'AI Apply ✨'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="detail-row">
          <td colSpan={7}>
            <DetailPanel
              job={job}
              review={review}
              applied={applied}
              setApplied={setApplied}
              aiApply={aiApply}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface DetailPanelProps {
  job: Job;
  review: AiReview | undefined;
  applied: AppliedEntry | undefined;
  setApplied: SetApplied;
  aiApply: AiApplyState;
}

function DetailPanel({ job, review, applied, setApplied, aiApply }: DetailPanelProps) {
  return (
    <>
      <AppliedBar job={job} applied={applied} setApplied={setApplied} />
      {aiApply.error && (
        <div className="api-error" role="alert">
          AI Apply failed: {aiApply.error}
        </div>
      )}
      {aiApply.body && <AiApplyPanel body={aiApply.body} path={aiApply.path} />}
      <div className="detail">
        <section>
          <h3>AI take</h3>
          {review ? (
            <ReviewBody review={review} />
          ) : (
            <p className="placeholder">
              No AI review yet — run <code>pnpm run ai-review</code> after the next pipeline run.
            </p>
          )}
        </section>
        <section>
          <h3>Score breakdown</h3>
          {job._signals ? (
            <SignalsList signals={job._signals} />
          ) : (
            <p className="placeholder">
              No <code>_signals</code> on this job (older entry).
            </p>
          )}
        </section>
        <section>
          <h3>Meta</h3>
          <dl className="meta">
            <dt>Location</dt>
            <dd>
              {job.location ?? '—'} {job.remote ? '· remote' : ''}
            </dd>
            <dt>Tags</dt>
            <dd>{job.tags.length ? job.tags.join(', ') : '—'}</dd>
            <dt>Posted</dt>
            <dd>{job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'unknown'}</dd>
            <dt>ID</dt>
            <dd className="mono">{job.id}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

interface AppliedBarProps {
  job: Job;
  applied: AppliedEntry | undefined;
  setApplied: SetApplied;
}

function AppliedBar({ job, applied, setApplied }: AppliedBarProps) {
  const [notesDraft, setNotesDraft] = useState(applied?.notes ?? '');
  // Reset the notes draft whenever the underlying entry changes (e.g. after
  // server confirms or status switches via the pills).
  useEffect(() => {
    setNotesDraft(applied?.notes ?? '');
  }, [applied?.notes]);

  const persistNotes = () => {
    if (!applied) return;
    const trimmed = notesDraft.trim();
    if (trimmed === (applied.notes ?? '')) return;
    void setApplied(job, applied.status, trimmed);
  };

  return (
    <div className="applied-bar">
      <span className="applied-label">
        {applied ? (
          <>
            Currently{' '}
            <strong>
              {STATUS_EMOJI[applied.status]} {applied.status}
            </strong>{' '}
            since {applied.date}
          </>
        ) : (
          'Not applied'
        )}
      </span>
      <div className="applied-pills">
        {STATUS_OPTIONS.map((s) => {
          const active = applied?.status === s;
          return (
            <button
              key={s}
              type="button"
              className={`pill ${active ? `pill-active pill-${s}` : ''}`}
              aria-pressed={active}
              onClick={() => void setApplied(job, active ? null : s)}
              title={active ? 'Click to clear' : `Mark as ${s}`}
            >
              {active && (
                <span className="pill-check" aria-hidden>
                  ✓{' '}
                </span>
              )}
              {STATUS_EMOJI[s]} {s}
            </button>
          );
        })}
        {applied && (
          <button
            type="button"
            className="applied-clear"
            onClick={() => void setApplied(job, null)}
            title="Clear status"
          >
            clear
          </button>
        )}
      </div>
      {applied && (
        <input
          type="text"
          className="applied-notes"
          placeholder="notes (saved on blur)"
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={persistNotes}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
    </div>
  );
}

function ReviewBody({ review }: { review: AiReview }) {
  return (
    <div className="review">
      <p className="review-summary">{review.summary}</p>
      {review.reason && (
        <p className="review-reason">
          <strong>Verdict:</strong> {review.reason}
        </p>
      )}
      <div className="review-cols">
        {review.wants.length > 0 && (
          <div>
            <h4>Wants</h4>
            <ul>
              {review.wants.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {review.offers.length > 0 && (
          <div>
            <h4>Offers</h4>
            <ul>
              {review.offers.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        {review.redFlags.length > 0 && (
          <div>
            <h4>Red flags</h4>
            <ul className="red-flags">
              {review.redFlags.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

const SIGNAL_LABELS: Record<keyof JobSignals, string> = {
  web3TitleBody: 'web3 (title/body)',
  web3Stack: 'web3 stack',
  aiTitleBody: 'AI (title/body)',
  aiStack: 'AI stack',
  stackPrimary: 'React/Next/TS',
  stackRn: 'React Native',
  stackOther: 'GraphQL/Tailwind/Vite',
  leadTitle: 'lead title',
  seniorTitle: 'senior title',
  frontendTitle: 'frontend title',
  frontendBody: 'frontend body',
  locationRemote: 'remote-friendly',
  freshness7d: 'fresh ≤7d',
  freshness14d: 'fresh ≤14d',
  usCentricPenalty: 'US-centric penalty',
  rawTotal: '',
  capped: '',
};

function SignalsList({ signals }: { signals: JobSignals }) {
  const fired = (Object.keys(signals) as (keyof JobSignals)[])
    .filter((k) => k !== 'rawTotal' && k !== 'capped')
    .map((k) => ({ key: k, label: SIGNAL_LABELS[k], value: signals[k] as number }))
    .filter((s) => s.value !== 0);
  return (
    <ul className="signals">
      {fired.map((s) => (
        <li key={s.key}>
          <span className="signal-label">{s.label}</span>
          <span className={s.value > 0 ? 'signal-pos' : 'signal-neg'}>
            {s.value > 0 ? '+' : ''}
            {s.value}
          </span>
        </li>
      ))}
      <li className="signal-total">
        <span className="signal-label">raw total</span>
        <span>{signals.rawTotal}</span>
      </li>
      {signals.capped && <li className="signal-total muted">(capped at 100)</li>}
    </ul>
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

function relativeTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'unknown';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1mo ago';
  return `${months}mo ago`;
}

interface AiApplyPanelProps {
  body: string;
  path: string | null;
}

// Renders the AI Apply markdown package with a copy-to-clipboard button per
// `## Section`. The user copy/pastes each section into the actual application
// form. (Phase 2: replace this with a "Submit via Playwright" flow that
// auto-fills the live application.)
function AiApplyPanel({ body, path }: AiApplyPanelProps) {
  const sections = useMemo(() => splitMarkdownByH2(body), [body]);
  return (
    <div className="ai-apply-panel">
      <header>
        <strong>✨ AI Apply package</strong>
        {path && <span className="muted"> · saved to {path}</span>}
      </header>
      {sections.length === 0 ? (
        <pre className="ai-apply-raw">{body}</pre>
      ) : (
        sections.map((s) => (
          <section key={s.heading} className="ai-apply-section">
            <header>
              <h4>{s.heading}</h4>
              <button
                type="button"
                className="ai-apply-copy"
                onClick={() => {
                  void navigator.clipboard.writeText(s.body.trim());
                }}
              >
                Copy
              </button>
            </header>
            <pre>{s.body.trim()}</pre>
          </section>
        ))
      )}
    </div>
  );
}

interface MarkdownSection {
  heading: string;
  body: string;
}

function splitMarkdownByH2(md: string): MarkdownSection[] {
  const lines = md.split('\n');
  const out: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m?.[1]) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), body: '' };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) out.push(current);
  return out;
}
