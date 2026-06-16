import slugs from '../../config/slugs.json' with { type: 'json' };
import { loadSlugOverlay, resolveSlugs } from '../lib/slugs.js';
import type {
  FetcherResult,
  RawAshbyPrivateBrief,
  RawAshbyPrivateDetail,
  RawAshbyPrivateJob,
  RawAshbyPrivateJobWithSlug,
} from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const GRAPHQL_URL = 'https://jobs.ashbyhq.com/api/non-user-graphql';

const LIST_QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    teams { id name }
    jobPostings { id title teamId locationName employmentType workplaceType secondaryLocations { locationId locationName } }
  }
}`;

const DETAIL_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id title locationName employmentType workplaceType descriptionHtml compensationTierSummary publishedDate secondaryLocationNames teamNames departmentName
  }
}`;

interface ListResponse {
  data?: { jobBoard?: { jobPostings?: RawAshbyPrivateBrief[] } | null };
  errors?: { message: string }[];
}

interface DetailResponse {
  data?: { jobPosting?: RawAshbyPrivateDetail | null };
  errors?: { message: string }[];
}

export function parseListResponse(json: ListResponse): RawAshbyPrivateBrief[] {
  if (json.errors?.length) return [];
  return json.data?.jobBoard?.jobPostings ?? [];
}

export function parseDetailResponse(json: DetailResponse): RawAshbyPrivateDetail | null {
  if (json.errors?.length) return null;
  return json.data?.jobPosting ?? null;
}

async function gql<T>(operationName: string, query: string, variables: object): Promise<T> {
  return fetchJson<T>(`${GRAPHQL_URL}?op=${operationName}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName, query, variables }),
  });
}

async function fetchSlug(slug: string): Promise<{ items: RawAshbyPrivateJob[]; errors: string[] }> {
  const errors: string[] = [];
  let briefs: RawAshbyPrivateBrief[] = [];
  try {
    const listResp = await gql<ListResponse>('ApiJobBoardWithTeams', LIST_QUERY, {
      organizationHostedJobsPageName: slug,
    });
    briefs = parseListResponse(listResp);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[ashby-private:${slug}:list]`, message);
    return { items: [], errors: [`list: ${message}`] };
  }

  const detailed = await Promise.all(
    briefs.map(async (b): Promise<RawAshbyPrivateJob> => {
      try {
        const resp = await gql<DetailResponse>('ApiJobPosting', DETAIL_QUERY, {
          organizationHostedJobsPageName: slug,
          jobPostingId: b.id,
        });
        return { ...b, detail: parseDetailResponse(resp) };
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[ashby-private:${slug}:detail]`, b.id, message);
        errors.push(`detail ${b.id}: ${message}`);
        return { ...b, detail: null };
      }
    }),
  );

  return { items: detailed, errors };
}

export async function fetchAshbyPrivate(): Promise<FetcherResult<RawAshbyPrivateJobWithSlug>> {
  const slugList = resolveSlugs(slugs.ashbyPrivate, (await loadSlugOverlay()).ashbyPrivate);
  const results = await Promise.all(
    slugList.map(async (slug) => {
      const r = await fetchSlug(slug);
      return {
        items: r.items.map((j): RawAshbyPrivateJobWithSlug => ({ ...j, __slug: slug })),
        errors: r.errors.map((e) => `${slug}: ${e}`),
      };
    }),
  );
  return {
    items: results.flatMap((r) => r.items),
    errors: results.flatMap((r) => r.errors),
  };
}
