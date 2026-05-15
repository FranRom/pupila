import clsx from 'clsx';
import buttonStyles from '../styles/Button.module.css';
import type { Category, Source } from '../types.ts';
import styles from './JobsFilters.module.css';

interface JobsFiltersProps {
  search: string;
  category: Category | 'all';
  source: Source | 'all';
  appliedOnly: boolean;
  showSkipped: boolean;
  queuedOnly: boolean;
  groupByCompany: boolean;
  compact: boolean;
  sources: Source[];
  categoryOptions: ReadonlyArray<Category | 'all'>;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: Category | 'all') => void;
  onSourceChange: (v: Source | 'all') => void;
  onAppliedOnlyChange: (v: boolean) => void;
  onShowSkippedChange: (v: boolean) => void;
  onQueuedOnlyChange: (v: boolean) => void;
  onGroupByCompanyChange: (v: boolean) => void;
  onCompactChange: (v: boolean) => void;
  onReset: () => void;
  onRefetch: () => void;
  isFetching: boolean;
}

export function JobsFilters({
  search,
  category,
  source,
  appliedOnly,
  showSkipped,
  queuedOnly,
  groupByCompany,
  compact,
  sources,
  categoryOptions,
  onSearchChange,
  onCategoryChange,
  onSourceChange,
  onAppliedOnlyChange,
  onShowSkippedChange,
  onQueuedOnlyChange,
  onGroupByCompanyChange,
  onCompactChange,
  onReset,
  onRefetch,
  isFetching,
}: JobsFiltersProps) {
  const hasActiveFilters =
    Boolean(search) ||
    category !== 'all' ||
    source !== 'all' ||
    appliedOnly ||
    showSkipped ||
    queuedOnly;
  return (
    <div className={styles.filters}>
      <input
        type="search"
        className={styles.search}
        placeholder="Search title / company / location"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <select
        className={styles.select}
        value={category}
        onChange={(e) => onCategoryChange(e.target.value as Category | 'all')}
      >
        {categoryOptions.map((c) => (
          <option key={c} value={c}>
            {c === 'all' ? 'All categories' : c}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={source}
        onChange={(e) => onSourceChange(e.target.value as Source | 'all')}
      >
        <option value="all">All sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={appliedOnly}
          onChange={(e) => onAppliedOnlyChange(e.target.checked)}
        />
        Applied only
      </label>

      <label className={styles.checkbox} title="Show jobs you left-swiped in Jinder">
        <input
          type="checkbox"
          checked={showSkipped}
          onChange={(e) => onShowSkippedChange(e.target.checked)}
        />
        Show skipped
      </label>

      <label
        className={styles.checkbox}
        title="Show only jobs currently queued or running in AI Apply"
      >
        <input
          type="checkbox"
          checked={queuedOnly}
          onChange={(e) => onQueuedOnlyChange(e.target.checked)}
        />
        Queued only
      </label>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={groupByCompany}
          onChange={(e) => onGroupByCompanyChange(e.target.checked)}
        />
        Group by company
      </label>

      <label className={styles.checkbox} title="Shrink row padding for higher density">
        <input
          type="checkbox"
          checked={compact}
          onChange={(e) => onCompactChange(e.target.checked)}
        />
        Compact
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          className={clsx(buttonStyles.secondary, buttonStyles.sm)}
          onClick={onReset}
        >
          Reset
        </button>
      )}

      <button
        type="button"
        className={clsx(buttonStyles.primary, buttonStyles.sm, styles.refetch)}
        onClick={onRefetch}
        disabled={isFetching}
        title={isFetching ? 'A fetch run is already in flight' : 'Refetch jobs from all sources'}
      >
        {isFetching ? 'Fetching…' : 'Refetch'}
      </button>
    </div>
  );
}
