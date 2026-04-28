import { useMemo, useState } from 'react';
import jobsData from '../../data/jobs.json' with { type: 'json' };
import type { ApplicationStatus, Category, Job, Source } from './types.ts';

const ALL_JOBS = jobsData as unknown as Job[];

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
            {visible.map((j) => (
              <tr key={j.id} className={j.applied ? 'applied' : ''}>
                <td className={`score ${scoreTier(j.fitScore)}`}>{j.fitScore}</td>
                <td className="title" title={j.title}>
                  <span className="clamp-2">
                    {j.applied && (
                      <span className={`badge badge-${j.applied.status}`} title={j.applied.notes}>
                        {STATUS_EMOJI[j.applied.status]} {j.applied.status}
                      </span>
                    )}
                    {j.title}
                  </span>
                </td>
                <td className="company" title={j.company ?? ''}>
                  <span className="clamp-2">{j.company ?? '—'}</span>
                </td>
                <td>
                  <span className="source">{j.source}</span>
                </td>
                <td>{j.salary ?? '—'}</td>
                <td className="muted">{relativeTime(j.postedAt)}</td>
                <td>
                  <a href={j.url} target="_blank" rel="noopener noreferrer">
                    Apply ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
