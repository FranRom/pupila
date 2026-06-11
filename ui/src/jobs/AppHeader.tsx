import logoUrl from '../../../assets/logo.svg';
import asciiTitleUrl from '../../../assets/pupila-ascii.svg';
import tabStyles from '../styles/Tab.module.css';
import styles from './AppHeader.module.css';

type Tab = 'jobs' | 'swipe' | 'profile' | 'settings';

interface AppHeaderProps {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  dataLoading: boolean;
  totalJobs: number;
  /** Kept-job counts keyed by category id (plus 'other' for uncategorized). */
  totals: Record<string, number>;
  appliedCount: number;
  visibleCount: number;
}

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'swipe', label: 'Jinder' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'Settings' },
];

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
    <header className={styles.header}>
      <div>
        <div className={styles.brand}>
          <img src={logoUrl} alt="" className={styles.logo} aria-hidden />
          <h1 className={styles.title}>
            <img src={asciiTitleUrl} alt="pupila" className={styles.titleAscii} />
          </h1>
        </div>
        <p className={styles.subtitle}>
          {dataLoading ? (
            'loading…'
          ) : (
            <>
              {totalJobs} jobs
              {Object.entries(totals)
                .filter(([, n]) => n > 0)
                .map(([id, n]) => ` · ${n} ${id}`)
                .join('')}{' '}
              · {appliedCount} applied
              {tab === 'jobs' && (
                <>
                  {' · '}
                  <span className={styles.subtitleEmphasis}>
                    Showing <strong>{visibleCount}</strong>
                  </span>
                </>
              )}
            </>
          )}
        </p>
      </div>
      <div className={tabStyles.strip}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? tabStyles.tabActive : tabStyles.tab}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}
