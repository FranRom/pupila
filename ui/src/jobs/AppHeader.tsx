import type { Category } from '../types.ts';

type Tab = 'jobs' | 'swipe' | 'profile' | 'settings';

interface AppHeaderProps {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  dataLoading: boolean;
  totalJobs: number;
  totals: Record<Category, number>;
  appliedCount: number;
  visibleCount: number;
}

export function AppHeader({
  tab,
  onTabChange,
  dataLoading,
  totalJobs,
  totals,
  appliedCount,
  visibleCount,
}: AppHeaderProps) {
  return (
    <header>
      <div>
        <h1>Job hunt</h1>
        <p className="subtitle">
          {dataLoading ? (
            'loading…'
          ) : (
            <>
              {totalJobs} jobs · {totals['web3+ai']} web3+ai · {totals.web3} web3 · {totals.ai} ai ·{' '}
              {totals.general} general · {appliedCount} applied
            </>
          )}
        </p>
      </div>
      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'jobs' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('jobs')}
        >
          Jobs
        </button>
        <button
          type="button"
          className={`tab ${tab === 'swipe' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('swipe')}
        >
          Tik Tjob
        </button>
        <button
          type="button"
          className={`tab ${tab === 'profile' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('profile')}
        >
          Profile
        </button>
        <button
          type="button"
          className={`tab ${tab === 'settings' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('settings')}
        >
          Settings
        </button>
      </div>
      {tab === 'jobs' && (
        <div className="counts">
          showing <strong>{visibleCount}</strong>
        </div>
      )}
    </header>
  );
}
