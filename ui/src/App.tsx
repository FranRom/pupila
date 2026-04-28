import { useEffect, useMemo, useState } from 'react';
import aiReviewsData from '../../data/ai-reviews.json' with { type: 'json' };
import jobsData from '../../data/jobs.json' with { type: 'json' };
import type {
  AiReview,
  AiReviews,
  ApplicationStatus,
  Category,
  Job,
  JobSignals,
  Source,
} from './types.ts';

const ALL_JOBS = jobsData as unknown as Job[];
const AI_REVIEWS = aiReviewsData as unknown as AiReviews;

const STATUS_EMOJI: Record<ApplicationStatus, string> = {
  applied: '📝',
  interview: '💬',
  offer: '🎯',
  rejected: '❌',
  withdrawn: '⏸',
};

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
  expanded: string | null;
  expandedCompany: string | null;
} {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get('cat');
  const sortKey = p.get('sort');
  const sortDir = p.get('dir');
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
  ]);

  const sources = useMemo(() => {
    const s = new Set<Source>();
    for (const j of ALL_JOBS) s.add(j.source);
    return Array.from(s).sort();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = ALL_JOBS.filter((j) => {
      if (category !== 'all' && j.category !== category) return false;
      if (source !== 'all' && j.source !== source) return false;
      if (appliedOnly && !j.applied) return false;
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
  }, [search, category, source, appliedOnly, sortKey, sortDir]);

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
    for (const j of ALL_JOBS) counts[j.category]++;
    return counts;
  }, []);

  const appliedCount = useMemo(() => ALL_JOBS.filter((j) => j.applied).length, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Job hunt</h1>
          <p className="subtitle">
            {ALL_JOBS.length} jobs · {totals['web3+ai']} web3+ai · {totals.web3} web3 · {totals.ai}{' '}
            ai · {totals.general} general · {appliedCount} applied
          </p>
        </div>
        <div className="counts">
          showing <strong>{visible.length}</strong>
        </div>
      </header>

      <div className="filters">
        <input
          type="search"
          placeholder="Search title / company / location"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')}>
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
        <p className="empty">No jobs match the current filters.</p>
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
                    onToggleCompany={() =>
                      setExpandedCompany(expandedCompany === g.key ? null : g.key)
                    }
                    onToggleJob={(id) => setExpanded(expanded === id ? null : id)}
                  />
                ))
              : visible.map((j) => {
                  const isOpen = expanded === j.id;
                  const review = AI_REVIEWS[j.id];
                  return (
                    <FragmentRow
                      key={j.id}
                      job={j}
                      isOpen={isOpen}
                      review={review}
                      onToggle={() => setExpanded(isOpen ? null : j.id)}
                    />
                  );
                })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface CompanyBlockProps {
  group: CompanyGroup;
  isOpen: boolean;
  expanded: string | null;
  onToggleCompany: () => void;
  onToggleJob: (id: string) => void;
}

function CompanyBlock({
  group,
  isOpen,
  expanded,
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
        review={AI_REVIEWS[job.id]}
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
              review={AI_REVIEWS[j.id]}
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
  onToggle: () => void;
  indent?: boolean;
}

function FragmentRow({ job, isOpen, review, onToggle, indent }: FragmentRowProps) {
  const rowClass = [job.applied ? 'applied' : '', isOpen ? 'open' : '', indent ? 'indent' : '']
    .filter(Boolean)
    .join(' ');
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
            {job.applied && (
              <span className={`badge badge-${job.applied.status}`} title={job.applied.notes}>
                {STATUS_EMOJI[job.applied.status]} {job.applied.status}
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
        </td>
      </tr>
      {isOpen && (
        <tr className="detail-row">
          <td colSpan={7}>
            <DetailPanel job={job} review={review} />
          </td>
        </tr>
      )}
    </>
  );
}

interface DetailPanelProps {
  job: Job;
  review: AiReview | undefined;
}

function DetailPanel({ job, review }: DetailPanelProps) {
  return (
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
