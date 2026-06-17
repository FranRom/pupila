/*
 * Typed UI → Vite middleware HTTP client.
 *
 * Every resource is grouped under `api.<resource>.<verb>(...)` for IDE
 * discoverability. All methods return Promise<Result<T>> — see ./client.ts
 * for the Result + ApiError types. Cancellation is opt-in via an
 * `{ signal }` arg on the methods that are polled or fired in effects.
 *
 * If you need to add a new endpoint:
 *   1. Add the response interface here (or in ui/src/types.ts if cross-cutting).
 *   2. Add a method to the appropriate namespace below.
 *   3. Don't write `fetch('/api/...')` at a call site — always go through here.
 */

import type { AiApplyResult } from '../../jobs/types.ts';
import type {
  CleanMode,
  CleanResult,
  DiskUsage,
  EnvInfo,
  LlmTestResult,
  PreferencesResponse,
  ProfileGenerateResult,
  ProfileGetResponse,
  Provider,
  ProviderChoice,
  RunSummary,
  SchedulerStatus,
} from '../../settings/types.ts';
import type {
  AiReviews,
  ApplicationStatus,
  AppliedEntry,
  ApplyQueueResponse,
  CategoryDef,
  Job,
  JobBodyResponse,
  LocationProfile,
  QueueRow,
  RoleInterest,
} from '../../types.ts';
import { path, request } from './client.ts';

// ── Response shapes that don't live in types.ts yet ─────────────────────────
// These were inlined in component files; centralizing them here means the
// client can type them and consumers can re-import where useful.

export type RunStatus = 'idle' | 'running' | 'done' | 'error';
export type SourceState = 'pending' | 'running' | 'done' | 'partial' | 'error';

export interface FetchJobsSourceEntry {
  name: string;
  state: SourceState;
  fetched?: number;
  errors?: number;
  message?: string;
}

export interface FetchJobsState {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  sources: FetchJobsSourceEntry[];
  exitCode: number | null;
  lastError: string | null;
}

/**
 * Server-side state for the AI Apply run, returned by GET /api/ai-apply-progress.
 * `path` + `applied` populate on success; `error` populates on failure. Mirrors
 * the shape in ui/plugins/aiApply.ts so the dock can render without massaging.
 */
export interface AiApplyState {
  jobId: string | null;
  jobTitle: string | null;
  company: string | null;
  cvPath: string | null;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  path: string | null;
  applied: AppliedEntry | null;
  provider: string | null;
  error: string | null;
}

export type SchedulerOp = 'install' | 'uninstall';

export interface SchedulerOpState {
  op: SchedulerOp | null;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
  lastError: string | null;
}

export interface LlmDetectResponse {
  available: Record<Provider, boolean>;
}

export interface BriefGetResponse {
  body: string | null;
}

export interface BriefMutateResponse {
  ok: boolean;
  body: string;
}

export interface ApplyQueueSkipsResponse {
  skips: string[];
}

export interface ApplyQueueEnqueueResponse {
  ok: true;
  row?: QueueRow;
}

export interface ProfileGenerateAccepted {
  ok: true;
}

export interface RolesResponse {
  roles: RoleInterest[];
}

export interface RolesMutateResponse {
  ok: true;
  roles: RoleInterest[];
}

export interface CategoriesResponse {
  categories: CategoryDef[];
}

export interface CategoriesMutateResponse {
  ok: true;
  categories: CategoryDef[];
}

export interface LocationResponse {
  location: LocationProfile | null;
}

export interface LocationMutateResponse {
  ok: true;
  location: LocationProfile;
}

export interface SourcesAtsView {
  key: string;
  label: string;
  note: string;
  verifySupported: boolean;
  shipped: string[];
  add: string[];
  remove: string[];
  effective: string[];
}

export interface SourcesResponse {
  ats: SourcesAtsView[];
}

export type ProbeState = 'ok' | 'not_found' | 'error';

export interface VerifyResponse {
  supported: boolean;
  state?: ProbeState;
  found: number;
}

export interface SourceHealthEntry {
  key: string;
  slug: string;
  state: ProbeState;
  found: number;
}

export interface SourceHealthResponse {
  results: SourceHealthEntry[];
}

export interface DiscoverySuggestion {
  name: string;
  ats: string;
  slug: string;
  matchCount: number;
  totalRoles: number;
  sampleTitles: string[];
  why?: string;
}

export interface DiscoverResult {
  suggestions: DiscoverySuggestion[];
  proposed: number;
  verified: number;
  errors: string[];
}

// ── Method types ────────────────────────────────────────────────────────────

interface SignalOpt {
  signal?: AbortSignal;
}

// ── Resource namespaces ─────────────────────────────────────────────────────

export const api = {
  // ── Job data ─────────────────────────────────────────────────────────────
  jobs: {
    list: (opt: SignalOpt = {}) => request<Job[]>('/api/jobs', opt),
  },
  reviews: {
    list: (opt: SignalOpt = {}) => request<AiReviews>('/api/reviews', opt),
  },
  jobBody: {
    get: (jobId: string, opt: SignalOpt = {}) =>
      request<JobBodyResponse>(path('/api/job-body', jobId), opt),
  },

  // ── Apply queue ──────────────────────────────────────────────────────────
  applyQueue: {
    list: (opt: SignalOpt = {}) => request<ApplyQueueResponse>('/api/apply-queue', opt),
    listSkips: (opt: SignalOpt = {}) =>
      request<ApplyQueueSkipsResponse>('/api/apply-queue/skips', opt),
    enqueue: (jobId: string, opt: SignalOpt = {}) =>
      request<ApplyQueueEnqueueResponse>('/api/apply-queue/enqueue', {
        method: 'POST',
        json: { jobId },
        ...opt,
      }),
    cancel: (jobId: string, opt: SignalOpt = {}) =>
      request<void>(path('/api/apply-queue', jobId), {
        method: 'DELETE',
        expectJson: false,
        ...opt,
      }),
    addSkip: (jobId: string, opt: SignalOpt = {}) =>
      request<{ ok: true }>(`${path('/api/apply-queue', jobId)}/skip`, {
        method: 'POST',
        expectJson: false,
        ...opt,
      }),
    removeSkip: (jobId: string, opt: SignalOpt = {}) =>
      request<void>(`${path('/api/apply-queue', jobId)}/skip`, {
        method: 'DELETE',
        expectJson: false,
        ...opt,
      }),
  },

  // ── Applied tracking ─────────────────────────────────────────────────────
  applied: {
    list: (opt: SignalOpt = {}) => request<AppliedEntry[]>('/api/applied', opt),
    set: (
      input: { url: string; status: ApplicationStatus; date: string; notes?: string },
      opt: SignalOpt = {},
    ) =>
      request<AppliedEntry>('/api/applied', {
        method: 'POST',
        json: input,
        ...opt,
      }),
    clear: (url: string, opt: SignalOpt = {}) =>
      request<void>('/api/applied', {
        method: 'DELETE',
        json: { url },
        expectJson: false,
        ...opt,
      }),
  },

  // ── AI Apply (per-job LLM run) ───────────────────────────────────────────
  aiApply: {
    run: (jobId: string, opt: SignalOpt = {}) =>
      request<AiApplyResult>('/api/ai-apply', {
        method: 'POST',
        json: { jobId },
        ...opt,
      }),
    progress: (opt: SignalOpt = {}) => request<AiApplyState>('/api/ai-apply-progress', opt),
  },

  // ── Fetch jobs (aggregator run trigger) ──────────────────────────────────
  fetchJobs: {
    status: (opt: SignalOpt = {}) => request<FetchJobsState>('/api/fetch-jobs', opt),
    trigger: (opt: SignalOpt = {}) =>
      request<{ ok: true }>('/api/fetch-jobs', {
        method: 'POST',
        ...opt,
      }),
  },

  // ── Preferences (provider + onboarding stamp) ────────────────────────────
  preferences: {
    get: (opt: SignalOpt = {}) => request<PreferencesResponse>('/api/preferences', opt),
    set: (input: { provider?: ProviderChoice; onboardedAt?: string | null }, opt: SignalOpt = {}) =>
      request<PreferencesResponse>('/api/preferences', {
        method: 'POST',
        json: input,
        ...opt,
      }),
  },

  // ── LLM CLI detect + test ────────────────────────────────────────────────
  llm: {
    detect: (opt: SignalOpt = {}) => request<LlmDetectResponse>('/api/llm-detect', opt),
    test: (opt: SignalOpt = {}) =>
      request<LlmTestResult>('/api/llm-test', { method: 'POST', ...opt }),
  },

  // ── Candidate brief + CV ─────────────────────────────────────────────────
  brief: {
    get: (opt: SignalOpt = {}) => request<BriefGetResponse>('/api/brief', opt),
    /**
     * Persist hand-edited markdown. Server expects `{ markdown }`; the
     * field name predates this client and isn't worth renaming on the
     * backend to match `body`.
     */
    set: (markdown: string, opt: SignalOpt = {}) =>
      request<BriefMutateResponse>('/api/brief', {
        method: 'POST',
        json: { markdown },
        ...opt,
      }),
  },
  cv: {
    /**
     * Upload a CV (or pasted text) to regenerate the candidate brief. The
     * server lives at POST /api/cv and accepts `{ format, data, source? }` —
     * `data` is either base64 (pdf/docx) or utf-8 text (md/txt). `source`
     * defaults to 'cv'; pass 'linkedin' for a LinkedIn "Save to PDF" export so
     * the LLM uses the LinkedIn-tuned prompt. Returns the freshly generated
     * brief in `body` (NOT just `{ ok: true }`).
     */
    upload: (
      input: {
        format: 'pdf' | 'docx' | 'md' | 'txt';
        data: string;
        source?: 'cv' | 'linkedin';
      },
      opt: SignalOpt = {},
    ) =>
      request<BriefMutateResponse>('/api/cv', {
        method: 'POST',
        json: input,
        ...opt,
      }),
  },

  // ── Scoring profile ──────────────────────────────────────────────────────
  profile: {
    get: (opt: SignalOpt = {}) => request<ProfileGetResponse>('/api/profile', opt),
    generate: (opt: SignalOpt = {}) =>
      request<ProfileGenerateResult | ProfileGenerateAccepted>('/api/profile-generate', {
        method: 'POST',
        ...opt,
      }),
  },

  // ── Role interests (target job titles) ───────────────────────────────────
  roles: {
    get: (opt: SignalOpt = {}) => request<RolesResponse>('/api/profile-roles', opt),
    set: (roles: RoleInterest[], opt: SignalOpt = {}) =>
      request<RolesMutateResponse>('/api/profile-roles', {
        method: 'PUT',
        json: { roles },
        ...opt,
      }),
  },

  // ── Job categories (user-defined taxonomy) ───────────────────────────────
  categories: {
    get: (opt: SignalOpt = {}) => request<CategoriesResponse>('/api/profile-categories', opt),
    set: (categories: CategoryDef[], opt: SignalOpt = {}) =>
      request<CategoriesMutateResponse>('/api/profile-categories', {
        method: 'PUT',
        json: { categories },
        ...opt,
      }),
  },

  // ── Location preferences (where + how the candidate works) ───────────────
  location: {
    get: (opt: SignalOpt = {}) => request<LocationResponse>('/api/profile-location', opt),
    set: (location: LocationProfile, opt: SignalOpt = {}) =>
      request<LocationMutateResponse>('/api/profile-location', {
        method: 'PUT',
        json: { location },
        ...opt,
      }),
  },

  // ── Job sources (per-company ATS slug overlay) ───────────────────────────
  sources: {
    get: (opt: SignalOpt = {}) => request<SourcesResponse>('/api/sources', opt),
    set: (input: { key: string; add: string[]; remove: string[] }, opt: SignalOpt = {}) =>
      request<SourcesResponse>('/api/sources', { method: 'PUT', json: input, ...opt }),
    verify: (input: { key: string; slug: string }, opt: SignalOpt = {}) =>
      request<VerifyResponse>('/api/sources/verify', { method: 'POST', json: input, ...opt }),
    health: (opt: SignalOpt = {}) =>
      request<SourceHealthResponse>('/api/sources/health', { method: 'POST', ...opt }),
    discover: (opt: SignalOpt = {}) =>
      request<DiscoverResult>('/api/sources/discover', { method: 'POST', ...opt }),
  },

  // ── Scheduler (launchd / cron) ───────────────────────────────────────────
  scheduler: {
    status: (opt: SignalOpt = {}) => request<SchedulerStatus>('/api/scheduler-status', opt),
    install: (input: { skipReview?: boolean }, opt: SignalOpt = {}) =>
      request<{ ok: true }>('/api/scheduler-install', {
        method: 'POST',
        json: input,
        ...opt,
      }),
    uninstall: (opt: SignalOpt = {}) =>
      request<{ ok: true }>('/api/scheduler-uninstall', { method: 'POST', ...opt }),
    progress: (opt: SignalOpt = {}) => request<SchedulerOpState>('/api/scheduler-progress', opt),
  },

  // ── Maintenance / clean ──────────────────────────────────────────────────
  clean: (input: { mode: CleanMode }, opt: SignalOpt = {}) =>
    request<CleanResult>('/api/clean', {
      method: 'POST',
      json: input,
      ...opt,
    }),

  // ── Diagnostics / read-only ──────────────────────────────────────────────
  runSummary: {
    get: (opt: SignalOpt = {}) => request<RunSummary>('/api/run-summary', opt),
  },
  diskUsage: {
    get: (opt: SignalOpt = {}) => request<DiskUsage>('/api/disk-usage', opt),
  },
  env: {
    get: (opt: SignalOpt = {}) => request<EnvInfo>('/api/env', opt),
  },
} as const;

// Re-export client primitives so consumers don't need two import sources.
export { type ApiError, formatError, ok, type Result } from './client.ts';
