import { z } from 'zod';
import { categoryEnum, listJobsSortEnum, sourceEnum } from './_constants.js';

// `list_jobs` mirrors the UI's filter chips + sort dropdown. All filters are
// AND-composed; an unset filter is treated as "no constraint." `q` does a
// case-insensitive substring search over title + company + location + tags.
//
// `limit` is capped server-side at 500 — the MCP framing of an unbounded
// response can be several megabytes for a fresh aggregator run. Clients that
// need more should page (post-v1 feature).
export const listJobsInputSchema = {
  category: categoryEnum.optional(),
  source: sourceEnum.optional(),
  applied: z.boolean().optional(),
  q: z.string().min(1).max(200).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  // `.default()` already accepts undefined input; `.optional()` would be
  // redundant. Output type is always defined after parse.
  sort: listJobsSortEnum.default('fitScore'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(500).default(50),
};

export const listJobsInputObject = z.object(listJobsInputSchema);
export type ListJobsInput = z.infer<typeof listJobsInputObject>;
