import { useCallback, useEffect, useRef, useState } from 'react';
import { streamNdjson } from '../../../src/lib/stream-ndjson.js';
import type { StreamingStatus } from '../StreamingPanel.tsx';

// Encapsulates the per-phase streaming state that used to live inline in
// Onboarding.tsx: visible stream text, status, stage label, elapsed ms,
// terminal error. One hook instance per LLM phase. The component reads
// `stream/status/stage/elapsedMs/error` for display and calls `start()`
// to kick off a streaming POST.

const DEFAULT_CAP = 12_000;
const TICK_MS = 250;

export interface UseLlmStreamOptions {
  /** Endpoint URL — must support `Accept: application/x-ndjson`. */
  url: string;
  /**
   * Visible stream is capped to the last N chars so a chatty LLM doesn't
   * grow the DOM string unboundedly. Defaults to 12,000.
   */
  cap?: number;
}

export interface LlmStreamHandle<TDone> {
  /** Token stream as it arrived (capped, never the final cleaned body). */
  stream: string;
  status: StreamingStatus;
  /** Latest `stage` value sent by the server (e.g. 'parsing-cv'). */
  stage: string | null;
  elapsedMs: number;
  /** Terminal error message after a failed `start()`. */
  error: string | null;
  /**
   * Kick off the streaming POST. Resolves with the server's `done` event
   * payload on success, or `null` when the run failed (`error` will be
   * populated and `status` will be 'error').
   */
  start: (body: unknown) => Promise<TDone | null>;
  /** Wipe state back to idle. Mostly useful before a retry. */
  reset: () => void;
}

export function useLlmStream<TDone extends Record<string, unknown>>(
  options: UseLlmStreamOptions,
): LlmStreamHandle<TDone> {
  const { url, cap = DEFAULT_CAP } = options;
  const [stream, setStream] = useState('');
  const [status, setStatus] = useState<StreamingStatus>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<number | null>(null);

  // Elapsed-time ticker — bumps `elapsedMs` while a run is active.
  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => {
      if (startRef.current !== null) {
        setElapsedMs(Date.now() - startRef.current);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status]);

  const reset = useCallback(() => {
    setStream('');
    setStage(null);
    setElapsedMs(0);
    setError(null);
    setStatus('idle');
    startRef.current = null;
  }, []);

  const start = useCallback(
    async (body: unknown): Promise<TDone | null> => {
      setStream('');
      setStage(null);
      setElapsedMs(0);
      setError(null);
      startRef.current = Date.now();
      setStatus('running');
      try {
        const done = await streamNdjson<TDone>(url, body, (event) => {
          if (event.type === 'chunk') {
            setStream((s) => (s + event.data).slice(-cap));
          } else if (event.type === 'start' || event.type === 'stage') {
            setStage(event.stage);
          }
        });
        setStatus('done');
        return done;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
        return null;
      }
    },
    [url, cap],
  );

  return { stream, status, stage, elapsedMs, error, start, reset };
}
