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

export interface Job {
  id: string;
  source: Source;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  remote: boolean;
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
}
