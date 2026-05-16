import { z } from 'zod';
import { jobIdSchema } from './_constants.js';

// All queue mutators key off a sha1-hex jobId — same as the existing UI
// middleware's defense against path-traversal payloads.
export const queueJobIdInputSchema = {
  jobId: jobIdSchema,
};

export const queueJobIdInputObject = z.object(queueJobIdInputSchema);
export type QueueJobIdInput = z.infer<typeof queueJobIdInputObject>;
