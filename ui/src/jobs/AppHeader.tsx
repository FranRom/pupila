import logoUrl from '../../../assets/logo.svg';
import asciiTitleUrl from '../../../assets/pupila-ascii.svg';
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
        <div className="app-brand">
          <img src={logoUrl} alt="" className="app-logo" aria-hidden />
          <h1 className="app-title">
            <img src={asciiTitleUrl} alt="pupila" className="app-title-ascii" />
          </h1>
        </div>
        <p className="subtitle">
          {dataLoading ? (
            'loading…'
          ) : (
            <>
              {totalJobs} jobs · {totals['web3+ai']} web3+ai · {totals.web3} web3 · {totals.ai} ai ·{' '}
              {totals.general} general · {appliedCount} applied
              {tab === 'jobs' && (
                <>
                  {' — '}
                  <span className="subtitle-emphasis">
                    Showing <strong>{visibleCount}</strong>
                  </span>
                </>
              )}
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
          Jinder
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
    </header>
  );
}
