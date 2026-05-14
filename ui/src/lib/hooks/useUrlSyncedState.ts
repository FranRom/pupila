/*
 * useUrlSyncedState — every Jobs filter + sort + group + tab in one hook.
 *
 * Reads the URL once on mount (deserialize), then writes back to
 * `history.replaceState` whenever any value changes. replaceState (not
 * pushState) means the back button still navigates pages, not filter
 * states — the user explicitly chose this over a stack of filter history.
 *
 * Bookmark/share works: paste `/?q=react&cat=ai&src=ashby` and the
 * dashboard hydrates back to that view next time. Defaults are omitted
 * from the URL, so a "clean" view leaves you with just `/`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Category, Source } from '../../types.ts';

export type SortKey = 'fitScore' | 'salaryMax' | 'postedAt';
export type SortDir = 'asc' | 'desc';
export type Tab = 'jobs' | 'swipe' | 'profile' | 'settings';

export interface UrlSyncedFilters {
  search: string;
  category: Category | 'all';
  source: Source | 'all';
  appliedOnly: boolean;
  showSkipped: boolean;
  queuedOnly: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  groupByCompany: boolean;
  compact: boolean;
  expanded: string | null;
  expandedCompany: string | null;
  tab: Tab;
}

export interface UrlSyncedSetters {
  setSearch: (v: string) => void;
  setCategory: (v: Category | 'all') => void;
  setSource: (v: Source | 'all') => void;
  setAppliedOnly: (v: boolean) => void;
  setShowSkipped: (v: boolean) => void;
  setQueuedOnly: (v: boolean) => void;
  setSortKey: (v: SortKey) => void;
  setSortDir: (v: SortDir) => void;
  setGroupByCompany: (v: boolean) => void;
  setCompact: (v: boolean) => void;
  setExpanded: (v: string | null) => void;
  setExpandedCompany: (v: string | null) => void;
  setTab: (v: Tab) => void;
}

export type UseUrlSyncedStateResult = UrlSyncedFilters & UrlSyncedSetters;

function readUrl(): UrlSyncedFilters {
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
    showSkipped: p.get('skipped') === '1',
    queuedOnly: p.get('queued') === '1',
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

export function useUrlSyncedState(): UseUrlSyncedStateResult {
  const initial = useMemo(() => readUrl(), []);

  const [search, setSearch] = useState(initial.search);
  const [category, setCategory] = useState<Category | 'all'>(initial.category);
  const [source, setSource] = useState<Source | 'all'>(initial.source);
  const [appliedOnly, setAppliedOnly] = useState(initial.appliedOnly);
  const [showSkipped, setShowSkipped] = useState(initial.showSkipped);
  const [queuedOnly, setQueuedOnly] = useState(initial.queuedOnly);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);
  const [groupByCompany, setGroupByCompany] = useState(initial.groupByCompany);
  const [compact, setCompact] = useState(initial.compact);
  const [expanded, setExpanded] = useState<string | null>(initial.expanded);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(initial.expandedCompany);
  const [tab, setTab] = useState<Tab>(initial.tab);

  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set('q', search);
    if (category !== 'all') p.set('cat', category);
    if (source !== 'all') p.set('src', source);
    if (appliedOnly) p.set('applied', '1');
    if (showSkipped) p.set('skipped', '1');
    if (queuedOnly) p.set('queued', '1');
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
    showSkipped,
    queuedOnly,
    sortKey,
    sortDir,
    groupByCompany,
    compact,
    expanded,
    expandedCompany,
    tab,
  ]);

  return {
    search,
    category,
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
    setSource,
    setAppliedOnly,
    setShowSkipped,
    setQueuedOnly,
    setSortKey,
    setSortDir,
    setGroupByCompany,
    setCompact,
    setExpanded,
    setExpandedCompany,
    setTab,
  };
}
