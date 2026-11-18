import { createHash } from 'node:crypto';
import { HarnessError, type StartRun } from '../contracts/index.ts';
import { projectContextGrantDigest } from '../core/approved-project-context.ts';

/** The native system prefix receives only host-admitted, exactly bound bytes. */
export function projectContextSystemPrompt(input: StartRun, systemPrompt: string): string {
  const context = input.approvedProjectContext;
  if (!context) return systemPrompt;
  if (context.version !== 1 || !context.owner || context.owner.threadId !== input.threadId || context.owner.runId !== input.runId || context.owner.epoch !== input.epoch ||
    context.owner.modelId !== input.modelId || context.owner.accountId !== (input.accountId ?? null) || typeof context.instructionText !== 'string' || Buffer.byteLength(context.instructionText) > 65536 ||
    createHash('sha256').update(context.instructionText).digest('hex') !== context.instructionDigest || projectContextGrantDigest(input.resources) !== context.grantDigest)
    throw new HarnessError('STALE_REQUEST_CONTEXT', 'Approved project instructions no longer match native admission.');
  return systemPrompt + context.instructionText;
}
