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
  | 'ashby-private';

export type Category = 'web3' | 'ai' | 'web3+ai' | 'general';

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

export type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

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
  _signals?: JobSignals;
  applied?: AppliedEntry;
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

export interface FetcherResult<T> {
  items: T[];
  errors: string[];
}
