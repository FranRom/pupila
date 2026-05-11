import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job, JobBodyResponse, JobSignals, QueueRow } from '../types.ts';
import { SwipeCard } from './SwipeCard.tsx';
import { SwipeControls } from './SwipeControls.tsx';
import type { SwipeAction } from './types.ts';

// SwipeDeck — the "Tik Tjob" container. Owns:
//   • the filtered + sorted deck of candidate jobs (top 50 unseen by fitScore),
//   • per-card body fetching with a small preload for the next card,
//   • exit animations + dispatch of skip/enqueue API calls,
//   • a small "Why?" toggle that exposes the positive _signals breakdown.
//
// Parent (App.tsx) keeps the source-of-truth sets (applied/queued/skipped) and
// passes them in. onQueueRefresh nudges App to re-poll /api/apply-queue after
// a successful enqueue so the Apply Queue panel stays current.

interface SwipeDeckProps {
  allJobs: Job[];
  appliedJobIds: Set<string>;
  queueRowJobIds: Set<string>;
  skippedJobIds: Set<string>;
  onQueueRefresh: () => void;
}

const DECK_CAP = 50;
const EXIT_ANIMATION_MS = 220;

// Pretty labels for the _signals fields that are interesting to show.
// We only surface positive-contributing signals; usCentricPenalty is the
// one signed field but we still include it so the user understands a
// suppressed score. rawTotal/capped are summarised separately.
const SIGNAL_LABELS: Record<keyof Omit<JobSignals, 'rawTotal' | 'capped'>, string> = {
  web3TitleBody: 'web3 in title/body',
  web3Stack: 'web3 stack match',
  aiTitleBody: 'AI in title/body',
  aiStack: 'AI stack match',
  stackPrimary: 'React/Next/TS',
  stackRn: 'RN / Expo',
  stackOther: 'GraphQL/Tailwind/Vite',
  leadTitle: 'lead/staff/principal',
  seniorTitle: 'senior/sr',
  frontendTitle: 'frontend in title',
  frontendBody: 'frontend in body',
  locationRemote: 'remote / EMEA / CET',
  freshness7d: 'posted ≤ 7d',
  freshness14d: 'posted ≤ 14d',
  usCentricPenalty: 'US-centric penalty',
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

async function safeJson<T>(res: Response): Promise<T> {
  // Narrow before parsing per the project's fetch convention.
  if (!res.ok) {
    let detail = '';
    try {
      const txt = await res.text();
      detail = txt ? ` — ${txt.slice(0, 200)}` : '';
    } catch {
      // ignore — we'll fall back to the status text.
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail}`);
  }
  return (await res.json()) as T;
}

export function SwipeDeck({
  allJobs,
  appliedJobIds,
  queueRowJobIds,
  skippedJobIds,
  onQueueRefresh,
}: SwipeDeckProps) {
  const deck = useMemo<Job[]>(
    () =>
      allJobs
        .filter((j) => !appliedJobIds.has(j.id))
        .filter((j) => !queueRowJobIds.has(j.id))
        .filter((j) => !skippedJobIds.has(j.id))
        .slice()
        .sort((a, b) => b.fitScore - a.fitScore)
        .slice(0, DECK_CAP),
    [allJobs, appliedJobIds, queueRowJobIds, skippedJobIds],
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [bodyCache, setBodyCache] = useState<Record<string, string>>({});
  const [bodyLoading, setBodyLoading] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  // If the deck shrinks below the current index (e.g. App reloaded jobs.json
  // and the current card is no longer in the candidate set), clamp.
  useEffect(() => {
    if (currentIndex > 0 && currentIndex >= deck.length) {
      setCurrentIndex(Math.max(0, deck.length - 1));
    }
  }, [deck.length, currentIndex]);

  // (Reset of the "Why?" disclosure happens inline in handleAction when
  // we advance currentIndex — keeping it there avoids a useEffect whose
  // only purpose is to react to an index change.)

  // Body fetching: load the current + next card. Cache empty string on
  // 404/error so we don't refetch repeatedly.
  const loadBody = useCallback(
    async (jobId: string) => {
      if (bodyCache[jobId] !== undefined) return;
      if (bodyLoading.has(jobId)) return;
      setBodyLoading((prev) => {
        const next = new Set(prev);
        next.add(jobId);
        return next;
      });
      try {
        const res = await fetch(`/api/job-body/${encodeURIComponent(jobId)}`);
        if (res.status === 404) {
          setBodyCache((prev) => ({ ...prev, [jobId]: '' }));
          return;
        }
        const data = await safeJson<JobBodyResponse>(res);
        setBodyCache((prev) => ({ ...prev, [jobId]: data.body ?? '' }));
      } catch {
        // Network or parse error — degrade to bodyPreview path.
        setBodyCache((prev) => ({ ...prev, [jobId]: '' }));
      } finally {
        setBodyLoading((prev) => {
          if (!prev.has(jobId)) return prev;
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [bodyCache, bodyLoading],
  );

  useEffect(() => {
    const current = deck[currentIndex];
    if (current) void loadBody(current.id);
    const next = deck[currentIndex + 1];
    if (next) void loadBody(next.id);
  }, [deck, currentIndex, loadBody]);

  // Use a ref to guard against double-firing handleAction in fast succession
  // (e.g. button click + drag commit racing). The CSS transition is short
  // enough that without this guard we'd advance twice.
  const inFlightRef = useRef(false);

  const handleAction = useCallback(
    async (action: SwipeAction) => {
      if (inFlightRef.current) return;
      const job = deck[currentIndex];
      if (!job) return;
      inFlightRef.current = true;
      setBusy(true);
      setError(null);
      setLeaving(action === 'apply' ? 'right' : 'left');

      // Wait for the CSS exit animation to play out, then make the API call.
      // We do this before advancing so a failed apply can restore the card
      // without it visually "snapping back" from off-screen.
      await new Promise<void>((resolve) => setTimeout(resolve, EXIT_ANIMATION_MS));

      try {
        if (action === 'apply') {
          const res = await fetch('/api/apply-queue/enqueue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: job.id }),
          });
          if (!res.ok) {
            // 409 (already queued) is common — friendly message.
            const txt = await res.text().catch(() => '');
            if (res.status === 409) {
              throw new Error('Already in the queue.');
            }
            throw new Error(
              `Couldn't enqueue (HTTP ${res.status})${txt ? ` — ${txt.slice(0, 160)}` : ''}`,
            );
          }
          // Parse but tolerate empty bodies.
          await safeJson<{ ok: true; row?: QueueRow }>(res).catch(() => undefined);
          onQueueRefresh();
          setLeaving(null);
          setShowWhy(false);
          setCurrentIndex((i) => i + 1);
        } else {
          const res = await fetch(`/api/apply-queue/${encodeURIComponent(job.id)}/skip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!res.ok) {
            // Skips are local-only data — surface the error but still advance.
            // Trapping the user on a card they want to skip is the wrong UX.
            const txt = await res.text().catch(() => '');
            setError(`Skip failed (HTTP ${res.status})${txt ? ` — ${txt.slice(0, 160)}` : ''}`);
          } else {
            onQueueRefresh();
          }
          setLeaving(null);
          setShowWhy(false);
          setCurrentIndex((i) => i + 1);
        }
      } catch (e: unknown) {
        if (action === 'apply') {
          // Don't advance — let the user retry or skip.
          setError(describeError(e));
          setLeaving(null);
        } else {
          setError(describeError(e));
          setLeaving(null);
          setShowWhy(false);
          setCurrentIndex((i) => i + 1);
        }
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [deck, currentIndex, onQueueRefresh],
  );

  const empty = deck.length === 0 || currentIndex >= deck.length;

  if (empty) {
    return (
      <div className="swipe-deck">
        <div
          className="swipe-card"
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <h2 className="swipe-card-title">Nothing left to swipe</h2>
          <p className="swipe-card-body" style={{ maxHeight: 'none', overflow: 'visible' }}>
            Run <code>pnpm run daily</code> or <code>pnpm run dev</code> to pull fresh jobs, or
            clear your swipe skips from Settings.
          </p>
        </div>
      </div>
    );
  }

  const job = deck[currentIndex];
  if (!job) {
    // Defensive — `empty` above should cover this, but TS narrowing.
    return null;
  }
  const body = bodyCache[job.id] ?? '';
  const signals = job._signals;

  return (
    <div className="swipe-deck">
      <div
        className="swipe-card-meta"
        style={{
          alignSelf: 'center',
          fontSize: '0.75rem',
          gap: '0.5rem',
        }}
      >
        <span>
          Card {currentIndex + 1} of {deck.length}
        </span>
        <span>·</span>
        <span>fitScore {Math.round(job.fitScore)}</span>
      </div>

      <SwipeCard job={job} body={body} onSwipe={(a) => void handleAction(a)} leaving={leaving} />

      <SwipeControls
        onSkip={() => void handleAction('skip')}
        onApply={() => void handleAction('apply')}
        disabled={busy || leaving !== null}
      />

      {signals ? (
        <button
          type="button"
          className="swipe-why"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
        >
          {showWhy ? 'Hide reasoning' : 'Why this score?'}
        </button>
      ) : null}

      {showWhy && signals ? <WhyPanel signals={signals} /> : null}

      {error ? (
        <div
          role="alert"
          style={{
            color: 'var(--badge-rejected-fg)',
            fontSize: '0.8125rem',
            textAlign: 'center',
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--bg-elevated)',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

interface WhyPanelProps {
  signals: JobSignals;
}

function WhyPanel({ signals }: WhyPanelProps) {
  const entries = (Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>)
    .map((k) => [k, signals[k]] as const)
    .filter(([, v]) => v !== 0);

  return (
    <div
      style={{
        width: '100%',
        fontSize: '0.75rem',
        color: 'var(--fg)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.75rem',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: '0.5rem', color: 'var(--muted)' }}>
        rawTotal {signals.rawTotal}
        {signals.capped ? ' · capped at 100' : ''}
      </div>
      {entries.length === 0 ? (
        <div style={{ color: 'var(--muted)' }}>No positive signals fired.</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.125rem' }}>
          {entries.map(([k, v]) => (
            <li key={k}>
              <span style={{ color: 'var(--muted)' }}>{SIGNAL_LABELS[k]}:</span>{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v > 0 ? `+${v}` : v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
