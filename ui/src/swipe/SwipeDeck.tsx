import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatError } from '../lib/api/index.ts';
import type { Job, JobSignals } from '../types.ts';
import { SwipeCard } from './SwipeCard.tsx';
import { SwipeControls } from './SwipeControls.tsx';
import styles from './SwipeDeck.module.css';
import type { SwipeAction } from './types.ts';

// SwipeDeck — the "Jinder" container. Owns:
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
  roleTitle: 'target role in title',
  roleBody: 'target role in body',
  locationRemote: 'remote / EMEA / CET',
  freshness7d: 'posted ≤ 7d',
  freshness14d: 'posted ≤ 14d',
  usCentricPenalty: 'US-centric penalty',
};

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
  // Ref instead of state: bodyLoading is only used as an in-flight guard inside
  // loadBody — never rendered. Using state caused a stale-closure edge where
  // both the current-card and next-card preloads, scheduled in the same effect
  // tick, read the pre-update Set and both fired fetches for the same id.
  const bodyLoadingRef = useRef<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Mutually-exclusive disclosures: opening one closes the other.
  const [openPanel, setOpenPanel] = useState<'why' | 'help' | null>(null);
  const showWhy = openPanel === 'why';
  const showHelp = openPanel === 'help';
  const [lastSkippedJob, setLastSkippedJob] = useState<Job | null>(null);

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
  // 404/error so we don't refetch repeatedly. The in-flight guard reads from
  // a ref (bodyLoadingRef) so concurrent preload+current calls in the same
  // effect tick see the up-to-date Set.
  const loadBody = useCallback(
    async (jobId: string) => {
      if (bodyCache[jobId] !== undefined) return;
      if (bodyLoadingRef.current.has(jobId)) return;
      bodyLoadingRef.current.add(jobId);
      const r = await api.jobBody.get(jobId);
      bodyLoadingRef.current.delete(jobId);
      // 404 and any non-ok response collapse to empty — the SwipeCard
      // falls back to bodyPreview when the cached body is empty.
      if (!r.ok) {
        setBodyCache((prev) => ({ ...prev, [jobId]: '' }));
        return;
      }
      setBodyCache((prev) => ({ ...prev, [jobId]: r.value.body ?? '' }));
    },
    [bodyCache],
  );

  useEffect(() => {
    const current = deck[currentIndex];
    if (current) void loadBody(current.id);
    const next = deck[currentIndex + 1];
    if (next) void loadBody(next.id);
  }, [deck, currentIndex, loadBody]);

  const clearUndo = useCallback(() => {
    setLastSkippedJob(null);
  }, []);

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
      clearUndo();

      // Confirm with the API BEFORE starting the CSS exit animation. Previously
      // setLeaving fired immediately and a 4xx made the card snap back from
      // off-screen, which looked like a glitch. Now: fetch first, then animate
      // only on success. The `busy` state already disables the swipe controls
      // so the user knows something is happening.
      if (action === 'apply') {
        const r = await api.applyQueue.enqueue(job.id);
        if (!r.ok) {
          // 409 = backend dedup already has this job in flight; everyone else
          // gets a "couldn't enqueue" line with the formatted error body.
          if (r.error.kind === 'http' && r.error.status === 409) {
            setError('Already in the queue.');
          } else {
            setError(`Couldn't enqueue — ${formatError(r.error)}`);
          }
          inFlightRef.current = false;
          setBusy(false);
          return;
        }
        onQueueRefresh();
        // Confirmed — play exit animation, then advance.
        setLeaving('right');
        await new Promise<void>((resolve) => setTimeout(resolve, EXIT_ANIMATION_MS));
        setLeaving(null);
        setOpenPanel(null);
        setCurrentIndex((i) => i + 1);
      } else {
        const r = await api.applyQueue.addSkip(job.id);
        if (!r.ok) {
          // Skips are local-only — surface the error but still advance.
          // Trapping the user on a card they want to skip is the wrong UX.
          setError(`Skip failed — ${formatError(r.error)}`);
        } else {
          onQueueRefresh();
          setLastSkippedJob(job);
        }
        setLeaving('left');
        await new Promise<void>((resolve) => setTimeout(resolve, EXIT_ANIMATION_MS));
        setLeaving(null);
        setOpenPanel(null);
        setCurrentIndex((i) => i + 1);
      }
      inFlightRef.current = false;
      setBusy(false);
    },
    [deck, currentIndex, onQueueRefresh, clearUndo],
  );

  const handleUndo = useCallback(async () => {
    if (!lastSkippedJob) return;
    const job = lastSkippedJob;
    clearUndo();
    const r = await api.applyQueue.removeSkip(job.id);
    if (!r.ok) {
      setError(`Undo failed — ${formatError(r.error)}`);
      return;
    }
    onQueueRefresh();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, [lastSkippedJob, onQueueRefresh, clearUndo]);

  const empty = deck.length === 0 || currentIndex >= deck.length;

  if (empty) {
    return (
      <div className={styles.deck}>
        <div className={styles.emptyCard}>
          <h2 className={styles.emptyTitle}>Nothing left to swipe</h2>
          <p className={styles.emptyBody}>
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
    <div className={styles.deck}>
      <div className={styles.deckMeta}>
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

      <div className={styles.disclosureRow}>
        {signals ? (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setOpenPanel((p) => (p === 'why' ? null : 'why'))}
            aria-expanded={showWhy}
          >
            {showWhy ? 'Hide reasoning' : 'Why this score?'}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpenPanel((p) => (p === 'help' ? null : 'help'))}
          aria-expanded={showHelp}
        >
          {showHelp ? 'Hide intro' : 'How does Jinder work?'}
        </button>
      </div>

      {showWhy && signals ? <WhyPanel signals={signals} /> : null}
      {showHelp ? <HelpPanel /> : null}

      {lastSkippedJob ? (
        <button type="button" className={styles.undo} onClick={() => void handleUndo()}>
          ↩ Undo last skip
        </button>
      ) : null}

      {error ? (
        <div role="alert" className={styles.error}>
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
    <aside className={styles.panel}>
      <header>
        <strong>Score breakdown</strong>
      </header>
      <p className={styles.panelMeta}>
        rawTotal {signals.rawTotal}
        {signals.capped ? ' · capped at 100' : ''}
      </p>
      {entries.length === 0 ? (
        <p className={styles.panelMeta}>No positive signals fired.</p>
      ) : (
        <ul className={styles.panelList}>
          {entries.map(([k, v]) => (
            <li key={k}>
              <span className={styles.panelListMuted}>{SIGNAL_LABELS[k]}:</span>{' '}
              {v > 0 ? `+${v}` : v}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function HelpPanel() {
  return (
    <aside className={styles.panel}>
      <header>
        <strong>Welcome to Jinder</strong>
      </header>
      <p>
        Speed-triage your top-scoring jobs one card at a time. Each card is a posting from{' '}
        <code>data/jobs.json</code>, ranked by <code>fitScore</code>. Decide fast, move on.
      </p>
      <ul className={styles.helpActions}>
        <li>
          <span className={styles.helpGlyphRight}>→</span>
          <div>
            <strong>Swipe right · Apply</strong>
            <span>
              Queues an <em>AI Apply</em> task. A background worker (
              <code>pnpm run apply-worker</code>) drafts a tailored cover-letter package, then marks
              the job <em>applied</em>.
            </span>
          </div>
        </li>
        <li>
          <span className={styles.helpGlyphLeft}>←</span>
          <div>
            <strong>Swipe left · Skip</strong>
            <span>
              Hides the card from this deck and adds a <em>SKIPPED</em> badge in the Jobs tab.
              Reversible via <em>Undo last skip</em> or the <em>skip</em> pill in the table.
            </span>
          </div>
        </li>
      </ul>
      <p className={styles.helpFoot}>
        Deck = top 50 unseen jobs, refreshed when you re-run the pipeline. The buttons below the
        card do the same thing if you prefer clicking.
      </p>
    </aside>
  );
}
