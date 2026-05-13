import type { Category, Source } from '../types.ts';

interface JobsFiltersProps {
  search: string;
  category: Category | 'all';
  source: Source | 'all';
  appliedOnly: boolean;
  groupByCompany: boolean;
  compact: boolean;
  sources: Source[];
  categoryOptions: ReadonlyArray<Category | 'all'>;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: Category | 'all') => void;
  onSourceChange: (v: Source | 'all') => void;
  onAppliedOnlyChange: (v: boolean) => void;
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
  groupByCompany,
  compact,
  sources,
  categoryOptions,
  onSearchChange,
  onCategoryChange,
  onSourceChange,
  onAppliedOnlyChange,
  onGroupByCompanyChange,
  onCompactChange,
  onReset,
  onRefetch,
  isFetching,
}: JobsFiltersProps) {
  const hasActiveFilters = Boolean(search) || category !== 'all' || source !== 'all' || appliedOnly;
  return (
    <div className="filters">
      <input
        type="search"
        placeholder="Search title / company / location"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value as Category | 'all')}
      >
        {categoryOptions.map((c) => (
          <option key={c} value={c}>
            {c === 'all' ? 'All categories' : c}
          </option>
        ))}
      </select>

      <select value={source} onChange={(e) => onSourceChange(e.target.value as Source | 'all')}>
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
          onChange={(e) => onAppliedOnlyChange(e.target.checked)}
        />
        Applied only
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={groupByCompany}
          onChange={(e) => onGroupByCompanyChange(e.target.checked)}
        />
        Group by company
      </label>

      <label className="checkbox" title="Shrink row padding for higher density">
        <input
          type="checkbox"
          checked={compact}
          onChange={(e) => onCompactChange(e.target.checked)}
        />
        Compact
      </label>

      {hasActiveFilters && (
        <button type="button" className="reset" onClick={onReset}>
          Reset
        </button>
      )}

      <button
        type="button"
        className="filters-refetch"
        onClick={onRefetch}
        disabled={isFetching}
        title={isFetching ? 'A fetch run is already in flight' : 'Refetch jobs from all sources'}
      >
        {isFetching ? '⟳ Fetching…' : '⟳ Refetch'}
      </button>
    </div>
  );
}
