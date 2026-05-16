import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AiReview, AiReviews } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { REVIEWS_PATH } from '../paths.js';
import { type ListAiReviewsInput, listAiReviewsInputSchema } from '../schemas/ai-reviews.js';

export interface ListAiReviewsPaths {
  reviewsPath: string;
}

const DEFAULT_PATHS: ListAiReviewsPaths = { reviewsPath: REVIEWS_PATH };

export async function runListAiReviews(
  input: ListAiReviewsInput,
  paths: ListAiReviewsPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const reviews = (await readJsonOrNull<AiReviews>(paths.reviewsPath)) ?? {};
  let entries: AiReview[] = Object.values(reviews);
  if (input.verdict) entries = entries.filter((r) => r.verdict === input.verdict);
  // Deterministic order — sort by jobId asc so paged responses are stable.
  entries.sort((a, b) => a.jobId.localeCompare(b.jobId));
  return toolJson({
    total: Object.keys(reviews).length,
    matched: entries.length,
    returned: Math.min(entries.length, input.limit),
    reviews: entries.slice(0, input.limit),
  });
}

export function registerListAiReviews(server: McpServer): void {
  server.registerTool(
    'list_ai_reviews',
    {
      title: 'List AI reviews',
      description:
        'List all AI review entries from data/ai-reviews.json. Optional `verdict` filter (strong-match | match | weak-match | skip). Limit 1-200 default 50. Sorted by jobId for stable paging.',
      inputSchema: listAiReviewsInputSchema,
    },
    safeHandler<ListAiReviewsInput>('list_ai_reviews', (input) => runListAiReviews(input)),
  );
}
