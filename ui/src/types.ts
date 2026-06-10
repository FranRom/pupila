export type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

export interface AppliedEntry {
  url: string;
  status: ApplicationStatus;
  date: string;
  notes?: string;
}

// UI-side mirror of the canonical `Source` union in src/types.ts (same boundary
// pattern as WorkType / LocationProfile / QueueRow below — the client build
// stays decoupled, so we DON'T import from src/* here). Kept in sync by
// `tests/source-lists.test.ts`, which fails if this list and the backend's
// canonical `SOURCES` ever diverge. Add a source in src/types.ts, then here.
export type Source =
  | 'remoteok'
  | 'remotive'
  | 'weworkremotely'
  | 'cryptojobslist'
  | 'web3career'
  | 'aijobsnet'
  | 'hn-hiring'
  | 'hn-jobs'
  | 'greenhouse'
  | 'ashby'
  | 'lever'
  | 'aave'
  | 'ashby-private'
  | 'bluedoor';

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
  roleTitle: number;
  roleBody: number;
  locationRemote: number;
  freshness7d: number;
  freshness14d: number;
  outOfRegionPenalty: number;
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
  /**
   * IDs of the configured role interests this job's title matched, in role-list
   * order (mirror of `Job.roleMatches` in src/types.ts). Drives the role badges
   * and the Role filter. Optional — absent on pre-filter / legacy jobs.
   */
  roleMatches?: string[];
  applied?: AppliedEntry;
  _signals?: JobSignals;
}

/**
 * A target job title the candidate is interested in (UI mirror of
 * `RoleInterest` in src/types.ts). `titleMatch` / `bodyMatch` are regex
 * fragment lists; the UI edits them as plain comma-free chips by `label`.
 */
export interface RoleInterest {
  id: string;
  label: string;
  titleMatch: string[];
  bodyMatch?: string[];
}

/** Work arrangements a candidate accepts (UI mirror of WorkType in src/types.ts). */
export const WORK_TYPES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/**
 * Candidate location preferences (UI mirror of `LocationProfile` in
 * src/types.ts). Edited on the Profile tab; persisted via PUT
 * /api/profile-location. Do NOT import from src/* here.
 */
export interface LocationProfile {
  basedIn: string;
  workTypes: WorkType[];
  acceptedRegions: string[];
  excludeOutsideAcceptedRegions: boolean;
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
