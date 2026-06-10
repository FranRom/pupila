import { type ReactNode, useId } from 'react';
import styles from './InfoTooltip.module.css';

interface InfoTooltipProps {
  /** Explanatory text shown in the tooltip on hover / focus. */
  content: ReactNode;
  /** Accessible name for the trigger button. */
  ariaLabel?: string;
  /** Which side of the trigger the bubble opens on. Defaults to "top". */
  side?: 'top' | 'bottom';
}

/**
 * A small "ⓘ" trigger that reveals a tooltip on hover or keyboard focus.
 * Reusable across the app for inline help next to a label or control.
 *
 * Accessibility: the bubble is always in the DOM with `role="tooltip"` and is
 * linked to the trigger via `aria-describedby`, so screen readers announce it;
 * sighted users see it on `:hover` / `:focus-within` (pure CSS, no JS state).
 */
export function InfoTooltip({
  content,
  ariaLabel = 'More information',
  side = 'top',
}: InfoTooltipProps) {
  const tipId = useId();
  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-describedby={tipId}
      >
        i
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={side === 'bottom' ? styles.bubbleBottom : styles.bubble}
      >
        {content}
      </span>
    </span>
  );
}
