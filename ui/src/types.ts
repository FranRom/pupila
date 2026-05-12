export type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

export interface AppliedEntry {
  url: string;
  status: ApplicationStatus;
  date: string;
  notes?: string;
}

export type Source =
  | 'aave'
  | 'ashby-private'
  | 'ashby'
  | 'lever'
  | 'greenhouse'
  | 'cryptojobslist'
  | 'web3career'
  | 'aijobsnet'
  | 'hn-hiring'
  | 'hn-jobs'
  | 'remotive'
  | 'weworkremotely'
  | 'remoteok';

export type Category = 'web3+ai' | 'web3' | 'ai' | 'general';

export interface JobSignals {
  web3TitleBody: number;
  web3Stack: number;
  aiTitleBody: number;
  aiStack: number;
  stackPrimary: number;
  stackRn: number;
  stackOther: number;
  leadTitle: number;
  seniorTitle: number;
  frontendTitle: number;
  frontendBody: number;
  locationRemote: number;
  freshness7d: number;
  freshness14d: number;
  usCentricPenalty: number;
  rawTotal: number;
  capped: boolean;
}

export type AiVerdict = 'strong-match' | 'match' | 'weak-match' | 'skip';

export interface AiReview {
  jobId: string;
  reviewedAt: string;
  model: string;
  summary: string;
  wants: string[];
  offers: string[];
  redFlags: string[];
  verdict: AiVerdict;
  reason: string;
}

export type AiReviews = Record<string, AiReview>;

export interface Job {
  id: string;
  source: Source;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  remote: boolean;
  /**
   * Optional first ~280 chars of the stripped JD (boilerplate removed).
   * Populated by the pipeline (`src/index.ts`) before stripping the full
   * body. Optional so older `jobs.json` files without the field still load.
   */
  bodyPreview?: string;
  tags: string[];
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null;
  fetchedAt: string;
  fitScore: number;
  category: Category;
  applied?: AppliedEntry;
  _signals?: JobSignals;
}

/* ──────────────────────────────────────────────────────────────────
   Apply queue — UI mirror of the backend queue types.
   The backend (server-side) owns the canonical shape; this is the
   UI-side boundary copy, same pattern as Job/JobSignals above.
   Do NOT import from src/* here.
   ────────────────────────────────────────────────────────────────── */

export type QueueRowStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QueueRow {
  jobId: string;
  status: QueueRowStatus;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelledAt?: string;
  attempts: number;
  error?: string;
  applicationPath?: string;
}

export interface WorkerLiveness {
  alive: boolean;
  pid: number | null;
  pidPath: string;
}

export interface ApplyQueueResponse {
  rows: QueueRow[];
  worker: WorkerLiveness;
}

/** Shape of GET /api/job-body/:jobId. */
export interface JobBodyResponse {
  jobId: string;
  body: string;
  source: 'sidecar' | 'jobs.json';
}

/**
 * Per-jobId queue status surfaced into the Jobs tab badge column. Lets
 * the Jobs table show "⏳ applying" without re-fetching the queue on every
 * row. App.tsx will build this map once per queue poll.
 */
export type QueueStatusMap = Record<string, QueueRowStatus>;

/**
 * Status emoji + visible label for queue rows. Separate from STATUS_EMOJI
 * in the jobs domain (ApplicationStatus) — different concept, different
 * lifecycle.
 */
export const QUEUE_STATUS_EMOJI: Record<QueueRowStatus, string> = {
  queued: '⏳',
  running: '⚙️',
  done: '✅',
  failed: '⚠️',
  cancelled: '🚫',
};

export const QUEUE_STATUS_LABEL: Record<QueueRowStatus, string> = {
  queued: 'queued',
  running: 'applying',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};
