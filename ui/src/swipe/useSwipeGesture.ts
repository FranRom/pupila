import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { SwipeAction } from './types.ts';

// Pointer-event-based drag hook for the swipe card. Tracks dragX in state
// so the wrapper can render a live transform, captures the pointer so the
// gesture follows past the card edge, and snaps back when the user lifts
// without crossing the threshold. The released ref guards against double
// firing if a stray pointerup arrives after we already committed.

interface UseSwipeGestureArgs {
  onSwipe: (action: SwipeAction) => void;
  threshold?: number;
  enabled?: boolean;
}

interface CardProps {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  style: CSSProperties;
  className: string;
}

interface UseSwipeGestureResult {
  cardProps: CardProps;
}

const DEFAULT_THRESHOLD = 100;

export function useSwipeGesture({
  onSwipe,
  threshold = DEFAULT_THRESHOLD,
  enabled = true,
}: UseSwipeGestureArgs): UseSwipeGestureResult {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const releasedRef = useRef(false);

  const reset = useCallback(() => {
    setDragX(0);
    setDragging(false);
    pointerIdRef.current = null;
    releasedRef.current = false;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Ignore non-primary buttons on mouse — left-click only.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      releasedRef.current = false;
      startXRef.current = e.clientX;
      pointerIdRef.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already released
        // (rare race in some browsers). Ignore — the gesture still works
        // via plain pointer events.
      }
      setDragging(true);
      setDragX(0);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging || releasedRef.current) return;
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      setDragX(e.clientX - startXRef.current);
    },
    [dragging],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging || releasedRef.current) return;
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      releasedRef.current = true;
      const offset = e.clientX - startXRef.current;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may already be released by the browser.
      }
      if (Math.abs(offset) >= threshold) {
        // Commit — let SwipeCard handle the exit class and advance.
        setDragging(false);
        setDragX(0);
        pointerIdRef.current = null;
        onSwipe(offset > 0 ? 'apply' : 'skip');
        return;
      }
      // Below threshold — snap back via the natural CSS transition.
      reset();
    },
    [dragging, threshold, onSwipe, reset],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      reset();
    },
    [reset],
  );

  const style: CSSProperties =
    dragX !== 0 ? { transform: `translateX(${dragX}px) rotate(${dragX * 0.06}deg)` } : {};

  // Direction class only kicks in past a small deadzone so a tap or a few
  // pixels of jitter don't flash the danger border.
  const DIRECTION_DEADZONE = 20;
  const direction = Math.abs(dragX) > DIRECTION_DEADZONE ? (dragX > 0 ? 'right' : 'left') : null;
  const className = [
    dragging ? 'is-swiping' : null,
    direction ? `swipe-direction-${direction}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    cardProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      style,
      className,
    },
  };
}
