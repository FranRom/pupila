import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AiReviews } from '../../types.js';
import { readJsonOrNull } from '../../utils.js';
import { safeHandler, type ToolResult, toolJson } from '../errors.js';
import { REVIEWS_PATH } from '../paths.js';
import { type GetAiReviewInput, getAiReviewInputSchema } from '../schemas/ai-reviews.js';

export interface GetAiReviewPaths {
  reviewsPath: string;
}

const DEFAULT_PATHS: GetAiReviewPaths = { reviewsPath: REVIEWS_PATH };

export async function runGetAiReview(
  input: GetAiReviewInput,
  paths: GetAiReviewPaths = DEFAULT_PATHS,
): Promise<ToolResult> {
  const reviews = (await readJsonOrNull<AiReviews>(paths.reviewsPath)) ?? {};
  return toolJson({ review: reviews[input.jobId] ?? null });
}

export function registerGetAiReview(server: McpServer): void {
  server.registerTool(
    'get_ai_review',
    {
      title: 'Get AI review for a single job',
      description:
        'Return the AI review entry from data/ai-reviews.json for a given jobId. Returns { review: AiReview | null } — null when no review exists.',
      inputSchema: getAiReviewInputSchema,
    },
    safeHandler<GetAiReviewInput>('get_ai_review', (input) => runGetAiReview(input)),
  );
}
