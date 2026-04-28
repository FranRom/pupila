import { useMemo, useState } from 'react';
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

export function App() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [source, setSource] = useState<Source | 'all'>('all');
  const [appliedOnly, setAppliedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('fitScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);

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
            {visible.map((j) => {
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

interface FragmentRowProps {
  job: Job;
  isOpen: boolean;
  review: AiReview | undefined;
  onToggle: () => void;
}

function FragmentRow({ job, isOpen, review, onToggle }: FragmentRowProps) {
  return (
    <>
      <tr className={`${job.applied ? 'applied' : ''} ${isOpen ? 'open' : ''}`} onClick={onToggle}>
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
