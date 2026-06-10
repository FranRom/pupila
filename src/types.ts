// SINGLE SOURCE OF TRUTH for source names. Every other source list — dedup
// priority (`Record<Source, …>`), render display order, the MCP enum, the
// fetch-progress panels (`KNOWN_SOURCES` in `src/lib/fetch-runner.ts` and the UI
// plugin), and the UI client's `Source` — derives from or is compile-checked
// against this tuple. Adding a source is a one-line edit here.
export const SOURCES = [
  'remoteok',
  'remotive',
  'weworkremotely',
  'cryptojobslist',
  'web3career',
  'aijobsnet',
  'hn-hiring',
  'hn-jobs',
  'greenhouse',
  'ashby',
  'lever',
  'aave',
  'ashby-private',
  'bluedoor',
] as const;

export type Source = (typeof SOURCES)[number];

export type Category = 'web3' | 'ai' | 'web3+ai' | 'general';

/** The work arrangements a candidate will accept (and a job can offer). */
export const WORK_TYPES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/**
 * The candidate's location preferences — where they live, the work
 * arrangements they accept, and the regions a job may be tied to. Drives the
 * persona-neutral geo filter (`hard_location_incompatible`) and the location
 * scoring in `src/filters.ts`, and (separately) location-scoped fetch queries.
 * Lives in `config/profile.json` under `location`. Editable on the Profile tab.
 */
export interface LocationProfile {
  /** Where the candidate lives — a single country (or free-text) anchor. */
  basedIn: string;
  /** Accepted work arrangements. A job whose only arrangement is excluded drops. */
  workTypes: WorkType[];
  /**
   * Region/location terms the candidate will work in (e.g. "Europe", "EMEA",
   * "Remote"). Used as the rescue list for region-locked jobs — the
   * persona-neutral replacement for the old hardcoded non-US rescue.
   */
  acceptedRegions: string[];
  /**
   * When true, a job region-locked to somewhere outside `acceptedRegions`
   * (and not worldwide-remote) is hard-dropped. When false, it's only
   * soft-penalized so it can still surface lower down.
   */
  excludeOutsideAcceptedRegions: boolean;
}

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
  /** Bonus when the title matches any configured role interest (see `Job.roleMatches`). */
  roleTitle: number;
  /** Tiered bonus for role-specific phrases in the body, across all role interests. */
  roleBody: number;
  locationRemote: number;
  freshness7d: number;
  freshness14d: number;
  /**
   * Negative penalty for a job region-locked outside the candidate's accepted
   * regions (persona-neutral; replaces the old US-centric penalty). Only fires
   * when the candidate hasn't opted into hard-excluding such jobs.
   */
  outOfRegionPenalty: number;
  rawTotal: number;
  capped: boolean;
}

// Source of truth for application-status values. Both the UI (`ui/plugins/_shared.ts`
// for HTTP validation) and the MCP server (`src/mcp/schemas/_constants.ts` for
// Zod enum) import from here so the literal list lives in one place.
export const APPLICATION_STATUSES = [
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

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

export interface AppliedEntry {
  url: string;
  status: ApplicationStatus;
  date: string;
  notes?: string;
}

export interface Job {
  id: string;
  source: Source;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  remote: boolean;
  body: string;
  /**
   * First ~280 chars of the boilerplate-stripped body, derived in
   * `src/index.ts` before `body` is dropped from the slim `data/jobs.json`.
   * Optional so existing jobs.json files without the field still load.
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
   * IDs of the configured role interests whose `titleMatch` fired on this job's
   * title (see `RoleInterest`), in role-list order. Empty when the title matches
   * none. Set at the filter stage (like `_signals`); absent on pre-filter jobs.
   * Drives the role badges and the Role filter in the UI.
   */
  roleMatches?: string[];
  _signals?: JobSignals;
  applied?: AppliedEntry;
}

/**
 * A target job title the candidate is interested in (e.g. "Senior Frontend
 * Engineer", "Product Engineer"). A job is tagged with a role when its title
 * matches `titleMatch`; `bodyMatch` phrases contribute to the role-body score.
 * Lives in `config/profile.json` under `roles[]`; per-match point values are
 * the shared `weights.roleTitle` / `weights.roleBody`.
 */
export interface RoleInterest {
  id: string;
  label: string;
  titleMatch: string[];
  bodyMatch?: string[];
}

export interface RawRemoteOk {
  id?: string | number;
  slug?: string;
  url?: string;
  apply_url?: string;
  position?: string;
  company?: string;
  location?: string;
  tags?: string[];
  description?: string;
  date?: string;
  epoch?: number;
}

export interface RawRemotive {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  tags: string[];
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
  company_logo?: string;
}

export interface RawRssItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string; '@_isPermaLink'?: string };
  description?: string;
  pubDate?: string;
  category?: string | string[];
  'dc:creator'?: string;
  author?: string;
}

export interface RawHnHit {
  objectID: string;
  title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  author?: string;
  created_at: string;
  num_comments?: number;
  points?: number;
}

export interface RawHnComment {
  id: number;
  parent_id?: number | null;
  author?: string | null;
  text?: string | null;
  created_at?: string;
  children?: RawHnComment[];
}

export interface RawHnHiringPost {
  storyId: number;
  commentId: number;
  text: string;
  createdAt: string;
}

export interface RawGreenhouseJob {
  id: number;
  internal_job_id?: number;
  title: string;
  updated_at: string;
  location?: { name?: string };
  absolute_url: string;
  content: string;
  company_name?: string;
  metadata?: unknown;
  departments?: { id: number; name: string }[];
  offices?: { id: number; name: string; location?: string }[];
}

export interface RawGreenhouseJobWithSlug extends RawGreenhouseJob {
  __slug: string;
}

export interface RawWeb3Career {
  jobid: string;
  url: string;
  title: string;
  company: string | null;
  postedAt: string | null;
  postedRelative: string | null;
  location: string | null;
  salary: string | null;
  tags: string[];
  category: string;
}

export interface RawAshbyJob {
  id: string;
  title: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  secondaryLocations?: { location?: string }[];
  publishedAt?: string;
  isRemote?: boolean;
  workplaceType?: string | null;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string | null;
    scrapeableCompensationSalarySummary?: string | null;
  };
}

export interface RawAshbyJobWithSlug extends RawAshbyJob {
  __slug: string;
}

export interface RawLeverJob {
  id: string;
  text: string;
  categories?: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string;
    allLocations?: string[];
  };
  tags?: string[];
  workplaceType?: string;
  createdAt?: number;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  additional?: string;
  lists?: { text: string; content: string }[];
  country?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  salaryDescriptionPlain?: string;
}

export interface RawLeverJobWithSlug extends RawLeverJob {
  __slug: string;
}

export interface RawAiJobs {
  id: string;
  url: string;
  title: string;
  salary: string | null;
  tags: string[];
  seniority: string | null;
  companyAndLocation: string | null;
  postedRelative: string | null;
}

export interface RawAshbyPrivateBrief {
  id: string;
  title: string;
  teamId?: string | null;
  locationName?: string | null;
  employmentType?: string | null;
  workplaceType?: string | null;
  secondaryLocations?: { locationId?: string; locationName?: string }[];
}

export interface RawAshbyPrivateDetail {
  id: string;
  title: string;
  locationName?: string | null;
  employmentType?: string | null;
  workplaceType?: string | null;
  descriptionHtml?: string | null;
  compensationTierSummary?: string | null;
  publishedDate?: string | null;
  secondaryLocationNames?: string[];
  teamNames?: string[];
  departmentName?: string | null;
}

export interface RawAshbyPrivateJob extends RawAshbyPrivateBrief {
  detail: RawAshbyPrivateDetail | null;
}

export interface RawAshbyPrivateJobWithSlug extends RawAshbyPrivateJob {
  __slug: string;
}

export interface RawAavePost {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
  description?: string | null;
  team?: string | null;
  department?: string | null;
  location?: string | null;
  commitment?: string | null;
  workplaceType?: string | null;
}

/**
 * A job posting from the bluedoor Job Postings API (`/v1/jobs/search`). bluedoor
 * aggregates ~1.6M postings across 31 ATS providers but ships **no company
 * name** — only `org_id` (a UUID) and the ATS `provider`. The employer is
 * recovered from the ATS slug in `source_url`/`apply_url` (see `parseAtsUrl`),
 * falling back to `org_id`. `location_text` is free-text and can cram many
 * regions into one string — normalize defensively, prefer it over `country`
 * (which reflects company HQ, not the role's region).
 */
export interface RawBluedoorJob {
  job_id: string;
  org_id?: string | null;
  provider?: string | null;
  title: string;
  location_text?: string | null;
  workplace_type?: string | null;
  remote_policy?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  department?: string | null;
  team?: string | null;
  employment_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  /** year | month | week | day | hour — used to annualize min/max for sorting. */
  salary_period?: string | null;
  source_url?: string | null;
  apply_url?: string | null;
  source_posted_at?: string | null;
  first_seen_at?: string | null;
  description_text?: string | null;
}

export interface FetcherResult<T> {
  items: T[];
  errors: string[];
}
