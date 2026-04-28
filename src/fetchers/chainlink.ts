import type {
  FetcherResult,
  RawChainlinkBrief,
  RawChainlinkDetail,
  RawChainlinkJob,
} from '../types.js';
import { fetchJson, JSON_HEADERS } from '../utils.js';

const ORG_SLUG = 'chainlink-labs';
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
  data?: { jobBoard?: { jobPostings?: RawChainlinkBrief[] } };
  errors?: { message: string }[];
}

interface DetailResponse {
  data?: { jobPosting?: RawChainlinkDetail | null };
  errors?: { message: string }[];
}

export function parseListResponse(json: ListResponse): RawChainlinkBrief[] {
  if (json.errors?.length) return [];
  return json.data?.jobBoard?.jobPostings ?? [];
}

export function parseDetailResponse(json: DetailResponse): RawChainlinkDetail | null {
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

export async function fetchChainlink(): Promise<FetcherResult<RawChainlinkJob>> {
  const errors: string[] = [];
  let briefs: RawChainlinkBrief[] = [];
  try {
    const listResp = await gql<ListResponse>('ApiJobBoardWithTeams', LIST_QUERY, {
      organizationHostedJobsPageName: ORG_SLUG,
    });
    briefs = parseListResponse(listResp);
  } catch (err) {
    const message = (err as Error).message;
    console.error('[chainlink:list]', message);
    return { items: [], errors: [`list: ${message}`] };
  }

  const detailed = await Promise.all(
    briefs.map(async (b): Promise<RawChainlinkJob> => {
      try {
        const resp = await gql<DetailResponse>('ApiJobPosting', DETAIL_QUERY, {
          organizationHostedJobsPageName: ORG_SLUG,
          jobPostingId: b.id,
        });
        return { ...b, detail: parseDetailResponse(resp) };
      } catch (err) {
        const message = (err as Error).message;
        console.error('[chainlink:detail]', b.id, message);
        errors.push(`detail ${b.id}: ${message}`);
        return { ...b, detail: null };
      }
    }),
  );

  return { items: detailed, errors };
}
