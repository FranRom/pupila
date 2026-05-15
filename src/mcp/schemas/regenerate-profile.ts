import { z } from 'zod';
import { SUPPORTED_PROVIDERS } from '../../lib/llm.js';

// LLM provider enum — same union as src/lib/llm.ts:SUPPORTED_PROVIDERS, with
// 'auto' allowed (the default — LLM CLI is auto-detected). Tuple cast keeps
// z.enum happy with the readonly-array shape.
const providerValues = [...SUPPORTED_PROVIDERS, 'auto'] as const;

export const regenerateProfileInputSchema = {
  provider: z.enum(providerValues).optional(),
};

export const regenerateProfileInputObject = z.object(regenerateProfileInputSchema);
export type RegenerateProfileInput = z.infer<typeof regenerateProfileInputObject>;
