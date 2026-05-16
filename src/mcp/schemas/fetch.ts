import { z } from 'zod';

// trigger_fetch has no input — it kicks off a single global run.
export const triggerFetchInputSchema = {};

// `runId` is a sha1 hex returned by trigger_fetch. Same regex shape as
// JOB_ID_REGEX but kept independent so a future change to either side
// doesn't bleed into the other.
export const getFetchStatusInputSchema = {
  runId: z.string().regex(/^[a-f0-9]{40}$/, 'runId must be a 40-char lowercase sha1 hex string'),
};

export const getFetchStatusInputObject = z.object(getFetchStatusInputSchema);
export type GetFetchStatusInput = z.infer<typeof getFetchStatusInputObject>;
