// MED-4: confirm modal with a real focus trap (no new deps).
// - On open: store the previously-focused element, focus the confirm
//   button (the primary action), and stamp `data-modal-open` on body so
//   global styles can dim background interactivity if desired.
// - On close: restore the previously-focused element and clear the body
//   marker.
// - Tab key cycles focus between the close (×) button and the confirm
//   button. Shift+Tab from the first wraps to the last and vice versa.

import { useEffect, useRef } from 'react';
import type { ConfirmDialog } from './types.ts';

interface ConfirmModalProps {
  dialog: ConfirmDialog | null;
  onClose: () => void;
}

export function ConfirmModal({ dialog, onClose }: ConfirmModalProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusableRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.setAttribute('data-modal-open', 'true');
    // The confirm button is the primary action — focus it so Enter
    // confirms immediately.
    lastFocusableRef.current?.focus();
    return () => {
      document.body.removeAttribute('data-modal-open');
      previousFocusRef.current?.focus();
    };
  }, [dialog]);

  if (!dialog) return null;

  // Click-outside-to-dismiss: only fires when the click target is the
  // overlay itself, not a bubbled click from inside the modal. Avoids
  // needing a stopPropagation handler on the inner div.
  const onOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Local keyboard handler on the overlay implementing the Tab trap +
  // Esc dismissal. Standalone — no global listener needed.
  const onOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // MED-4 fix: removed the `target === currentTarget` guard on Esc.
    // The focus trap moves focus INSIDE the modal on open, so Esc events
    // bubble from inner buttons — they'll never have target === overlay.
    // Esc must dismiss regardless of which child holds focus.
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === firstFocusableRef.current) {
      e.preventDefault();
      lastFocusableRef.current?.focus();
    } else if (!e.shiftKey && document.activeElement === lastFocusableRef.current) {
      e.preventDefault();
      firstFocusableRef.current?.focus();
    }
  };

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      tabIndex={-1}
      onMouseDown={onOverlayMouseDown}
      onKeyDown={onOverlayKeyDown}
    >
      <div className={`confirm-modal ${dialog.destructive ? 'confirm-modal-danger' : ''}`}>
        <header className="confirm-modal-header">
          <h3 id="confirm-modal-title">{dialog.title}</h3>
          <button
            ref={firstFocusableRef}
            type="button"
            className="confirm-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p className="confirm-modal-body">{dialog.body}</p>
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={lastFocusableRef}
            type="button"
            className={`btn ${dialog.destructive ? 'btn-danger' : 'btn-secondary'}`}
            onClick={dialog.onConfirm}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
