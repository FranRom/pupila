import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import styles from './StreamingPanel.module.css';
import buttonStyles from './styles/Button.module.css';
import spinnerStyles from './styles/Spinner.module.css';

// Inline streaming-log panel used by the onboarding wizard while an LLM is
// running. Lives inside the active wizard step (not as a fixed-position dock
// like FetchProgress/AiApplyProgress) because the user has no other UI to
// interact with during onboarding — putting it bottom-right would feel
// disconnected from what they just did.

export type StreamingStatus = 'idle' | 'running' | 'done' | 'error';

interface StreamingPanelProps {
  title: string;
  stream: string;
  status: StreamingStatus;
  elapsedMs: number;
  provider?: string | null;
  error?: string | null;
  onRetry?: () => void;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '0s';
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

const PANEL_VARIANT = {
  running: styles.panelRunning,
  done: styles.panelDone,
  error: styles.panelError,
} as const;

export function StreamingPanel({
  title,
  stream,
  status,
  elapsedMs,
  provider,
  error,
  onRetry,
}: StreamingPanelProps) {
  const logRef = useRef<HTMLPreElement>(null);

  // Autoscroll to bottom on every new chunk so the freshest tokens stay
  // visible. Only when already near the bottom — if the user has scrolled up
  // to read earlier output, don't yank them back down. We read stream.length
  // inside the effect so biome's exhaustive-deps rule sees the dependency.
  const streamLen = stream.length;
  useEffect(() => {
    const el = logRef.current;
    if (!el || streamLen === 0) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [streamLen]);

  if (status === 'idle') return null;

  return (
    <aside className={PANEL_VARIANT[status]} role="status" aria-live="polite" aria-atomic="false">
      <header className={styles.header}>
        <span className={styles.title}>
          {status === 'running' && <span className={spinnerStyles.spinner} aria-hidden />}
          {status === 'done' && <span aria-hidden>✓</span>}
          {status === 'error' && <span aria-hidden>✗</span>}
          {title}
        </span>
        <span className={styles.meta}>
          {provider && <code>{provider}</code>}
          <span>{formatElapsed(elapsedMs)}</span>
        </span>
      </header>
      <pre ref={logRef} className={styles.log}>
        {stream.trim() || (status === 'running' ? '(waiting for first token…)' : '')}
      </pre>
      {error && status === 'error' && (
        <div className={styles.error}>
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={clsx(buttonStyles.primary, buttonStyles.sm)}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
