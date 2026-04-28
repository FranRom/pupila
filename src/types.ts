export type Source =
  | 'remoteok'
  | 'remotive'
  | 'weworkremotely'
  | 'cryptojobslist'
  | 'web3career'
  | 'aijobsnet'
  | 'hn-hiring'
  | 'hn-jobs'
  | 'greenhouse';

export type Category = 'web3' | 'ai' | 'web3+ai' | 'general';

export interface Job {
  id: string;
  source: Source;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  remote: boolean;
  body: string;
  tags: string[];
  postedAt: string | null;
  fetchedAt: string;
  fitScore: number;
  category: Category;
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

export interface FetcherResult<T> {
  source: Source;
  items: T[];
  errors: string[];
}
