import { z } from 'zod';
import { jobIdSchema } from './_constants.js';

// `get_job_detail` returns the full job record + the boilerplate-stripped
// body from the sidecar (or its `jobs.json` fallback) + AI review + applied
// entry. The body is what powers the UI's expandable row and Jinder card.
export const getJobDetailInputSchema = {
  jobId: jobIdSchema,
};

export const getJobDetailInputObject = z.object(getJobDetailInputSchema);
export type GetJobDetailInput = z.infer<typeof getJobDetailInputObject>;
