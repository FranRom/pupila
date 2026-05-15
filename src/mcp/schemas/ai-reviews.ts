import { z } from 'zod';
import { jobIdSchema, verdictEnum } from './_constants.js';

export const getAiReviewInputSchema = {
  jobId: jobIdSchema,
};

export const getAiReviewInputObject = z.object(getAiReviewInputSchema);
export type GetAiReviewInput = z.infer<typeof getAiReviewInputObject>;

export const listAiReviewsInputSchema = {
  verdict: verdictEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
};

export const listAiReviewsInputObject = z.object(listAiReviewsInputSchema);
export type ListAiReviewsInput = z.infer<typeof listAiReviewsInputObject>;
