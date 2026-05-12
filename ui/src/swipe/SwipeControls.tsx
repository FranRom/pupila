// Two big icon buttons below the swipe card. Stateless — parent owns the
// disabled flag (e.g. while a network request is in flight or a card is
// mid-exit-animation).

interface SwipeControlsProps {
  onSkip: () => void;
  onApply: () => void;
  disabled?: boolean;
}

export function SwipeControls({ onSkip, onApply, disabled = false }: SwipeControlsProps) {
  return (
    <div className="swipe-controls">
      <button
        type="button"
        className="swipe-btn swipe-btn-skip"
        onClick={onSkip}
        disabled={disabled}
        aria-label="Skip job"
        title="Skip"
      >
        ✕
      </button>
      <button
        type="button"
        className="swipe-btn swipe-btn-apply"
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
