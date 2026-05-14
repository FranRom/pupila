// Two big icon buttons below the swipe card. Stateless — parent owns the
// disabled flag (e.g. while a network request is in flight or a card is
// mid-exit-animation).

import styles from './SwipeControls.module.css';

interface SwipeControlsProps {
  onSkip: () => void;
  onApply: () => void;
  disabled?: boolean;
}

export function SwipeControls({ onSkip, onApply, disabled = false }: SwipeControlsProps) {
  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={styles.skip}
        onClick={onSkip}
        disabled={disabled}
        aria-label="Skip job"
        title="Skip"
      >
        ✕
      </button>
      <button
        type="button"
        className={styles.apply}
        onClick={onApply}
        disabled={disabled}
        aria-label="Apply to job"
        title="Apply"
      >
        ✓
      </button>
    </div>
  );
}
