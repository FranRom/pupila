import { useEffect, useRef } from 'react';

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
    <aside
      className={`streaming-panel streaming-panel-${status}`}
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <header className="streaming-panel-header">
        <span className="streaming-panel-title">
          {status === 'running' && <span className="button-spinner" aria-hidden />}
          {status === 'done' && <span aria-hidden>✓</span>}
          {status === 'error' && <span aria-hidden>✗</span>}
          {title}
        </span>
        <span className="streaming-panel-meta">
          {provider && <code>{provider}</code>}
          <span>{formatElapsed(elapsedMs)}</span>
        </span>
      </header>
      <pre ref={logRef} className="streaming-panel-log">
        {stream.trim() || (status === 'running' ? '(waiting for first token…)' : '')}
      </pre>
      {error && status === 'error' && (
        <div className="streaming-panel-error">
          <span>{error}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-primary btn-sm">
              Retry
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
