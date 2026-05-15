// Shared schema bits for the three applied-table mutators: mark_applied,
// update_status, clear_applied. The three tools accept the same job
// identifier shapes (`url` OR `jobId`) and differ only in which fields
// they require.

import { z } from 'zod';
import { applicationStatusEnum, jobIdSchema } from './_constants.js';

// Used by all three mutators — at runtime the handler checks that at least
// one is provided. Zod's `.refine` would also work, but the JSON-Schema
// projection is cleaner without conditional logic, and the runtime check
// lets us emit a useful error message.
const jobIdentifier = {
  url: z.string().url().max(2000).optional(),
  jobId: jobIdSchema.optional(),
};

const notesField = z.string().max(2000).optional();
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .optional();

export const markAppliedInputSchema = {
  ...jobIdentifier,
  status: applicationStatusEnum.default('applied'),
  date: dateField,
  notes: notesField,
};

export const markAppliedInputObject = z.object(markAppliedInputSchema);
export type MarkAppliedInput = z.infer<typeof markAppliedInputObject>;

export const updateStatusInputSchema = {
  ...jobIdentifier,
  // update_status REQUIRES status — that's the whole point. mark_applied
  // defaults to 'applied' for the first-time-marking case.
  status: applicationStatusEnum,
  date: dateField,
  notes: notesField,
};

export const updateStatusInputObject = z.object(updateStatusInputSchema);
export type UpdateStatusInput = z.infer<typeof updateStatusInputObject>;

export const clearAppliedInputSchema = {
  ...jobIdentifier,
};

export const clearAppliedInputObject = z.object(clearAppliedInputSchema);
export type ClearAppliedInput = z.infer<typeof clearAppliedInputObject>;
