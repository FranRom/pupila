import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUrlSyncedState } from './useUrlSyncedState.ts';

// readUrl on mount, writer effect on every change. test-setup.ts resets the
// URL between tests so each case starts from `/`.

describe('useUrlSyncedState', () => {
  describe('readUrl on mount', () => {
    it('returns defaults when URL is empty', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      expect(result.current.search).toBe('');
      expect(result.current.category).toBe('all');
      expect(result.current.source).toBe('all');
      expect(result.current.appliedOnly).toBe(false);
      expect(result.current.showSkipped).toBe(false);
      expect(result.current.queuedOnly).toBe(false);
      expect(result.current.sortKey).toBe('fitScore');
      expect(result.current.sortDir).toBe('desc');
      expect(result.current.groupByCompany).toBe(true);
      expect(result.current.compact).toBe(false);
      expect(result.current.expanded).toBe(null);
      expect(result.current.expandedCompany).toBe(null);
      expect(result.current.tab).toBe('jobs');
    });

    it('hydrates each param from the URL', () => {
      window.history.replaceState(
        null,
        '',
        '/?q=react&cat=ai&src=ashby&applied=1&skipped=1&queued=1&sort=salaryMax&dir=asc&group=0&compact=1&expanded=abc&co=openai&tab=swipe',
      );
      const { result } = renderHook(() => useUrlSyncedState());
      expect(result.current.search).toBe('react');
      expect(result.current.category).toBe('ai');
      expect(result.current.source).toBe('ashby');
      expect(result.current.appliedOnly).toBe(true);
      expect(result.current.showSkipped).toBe(true);
      expect(result.current.queuedOnly).toBe(true);
      expect(result.current.sortKey).toBe('salaryMax');
      expect(result.current.sortDir).toBe('asc');
      expect(result.current.groupByCompany).toBe(false);
      expect(result.current.compact).toBe(true);
      expect(result.current.expanded).toBe('abc');
      expect(result.current.expandedCompany).toBe('openai');
      expect(result.current.tab).toBe('swipe');
    });

    it('falls back to defaults for invalid values', () => {
      window.history.replaceState(null, '', '/?cat=nonsense&sort=bogus&dir=BOGUS&tab=invalid');
      const { result } = renderHook(() => useUrlSyncedState());
      expect(result.current.category).toBe('all');
      expect(result.current.sortKey).toBe('fitScore');
      expect(result.current.sortDir).toBe('desc');
      expect(result.current.tab).toBe('jobs');
    });
  });

  describe('writer effect', () => {
    it('omits defaults from the URL (clean view = bare /)', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      // No state changes — defaults stay defaults. Effect should not write
      // any query params.
      act(() => {
        // Nudge a re-render path by setting a default value.
        result.current.setSortKey('fitScore');
      });
      expect(window.location.search).toBe('');
    });

    it('serializes non-default state to the URL', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      act(() => {
        result.current.setSearch('react');
        result.current.setCategory('ai');
        result.current.setAppliedOnly(true);
      });
      const params = new URLSearchParams(window.location.search);
      expect(params.get('q')).toBe('react');
      expect(params.get('cat')).toBe('ai');
      expect(params.get('applied')).toBe('1');
    });

    it('round-trips: state → URL → state', () => {
      const { result: first } = renderHook(() => useUrlSyncedState());
      act(() => {
        first.current.setCategory('web3');
        first.current.setSortKey('postedAt');
        first.current.setTab('swipe');
      });
      // Pretend a page reload happened — fresh hook reads from the URL.
      const { result: second } = renderHook(() => useUrlSyncedState());
      expect(second.current.category).toBe('web3');
      expect(second.current.sortKey).toBe('postedAt');
      expect(second.current.tab).toBe('swipe');
    });
  });

  describe('toggle helpers', () => {
    it('toggleExpanded flips the value (set → set again clears)', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      expect(result.current.expanded).toBeNull();
      act(() => {
        result.current.toggleExpanded('jobA');
      });
      expect(result.current.expanded).toBe('jobA');
      act(() => {
        result.current.toggleExpanded('jobA');
      });
      expect(result.current.expanded).toBeNull();
    });

    it('toggleExpanded switches between two different ids', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      act(() => {
        result.current.toggleExpanded('jobA');
      });
      act(() => {
        result.current.toggleExpanded('jobB');
      });
      expect(result.current.expanded).toBe('jobB');
    });

    it('toggleExpandedCompany mirrors the row toggle', () => {
      const { result } = renderHook(() => useUrlSyncedState());
      act(() => {
        result.current.toggleExpandedCompany('acme');
      });
      expect(result.current.expandedCompany).toBe('acme');
      act(() => {
        result.current.toggleExpandedCompany('acme');
      });
      expect(result.current.expandedCompany).toBeNull();
    });

    it('toggle callbacks have stable identity across re-renders', () => {
      // This is the load-bearing property: React.memo on the ~1k FragmentRow
      // instances relies on `onToggle` keeping the same reference whenever
      // any unrelated state changes (e.g. typing in the search box).
      const { result, rerender } = renderHook(() => useUrlSyncedState());
      const firstToggle = result.current.toggleExpanded;
      const firstCompanyToggle = result.current.toggleExpandedCompany;
      act(() => {
        result.current.setSearch('react');
      });
      rerender();
      expect(result.current.toggleExpanded).toBe(firstToggle);
      expect(result.current.toggleExpandedCompany).toBe(firstCompanyToggle);
    });
  });
});
