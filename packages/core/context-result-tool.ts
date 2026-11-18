import { z } from 'zod';

export const contextResultReadArgs = z.strictObject({
  handle: z.uuid(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().min(1).max(1024 * 1024),
});
export const CONTEXT_RESULT_READ = {
  name: 'context_result_read',
  description: 'Read a bounded range of a captured tool result from the current run. Original resource authority must still hold. A handle grants no access; captured bytes are historical, not a fresh source read.',
  parameters: z.toJSONSchema(contextResultReadArgs) as Record<string, unknown>,
};
