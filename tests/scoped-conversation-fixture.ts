import type {ConversationContext, ConversationMessage} from '../packages/contracts/conversation-read-models';

// Synthetic Personal records; no provider, account or native acceptance evidence.
export const scopedContext: ConversationContext = {
  authority: 'personal', owner: {threadId: 'exact-owner', title: 'Synthetic conversation', projectId: 'synthetic-project', projectName: 'Synthetic', epoch: 37, runId: null, status: 'ready', modelId: 'synthetic/model'},
  scopeKey: 'a'.repeat(64), revision: 'b'.repeat(64), sequence: 10, checkpoint: 'checkpoint-10',
  readOnly: false, archived: false, includeArchived: false, researchEligible: true,
};
export const scopedSelection = {target: {authority: 'personal' as const, threadId: 'exact-owner', includeArchived: false}, navigationKey: 'canonical-admission-1'};
export function scopedMessage(id = 'm1', content = 'Synthetic message'): ConversationMessage {
  return {id, content, threadId: 'exact-owner', role: 'assistant', createdAt: '2026-11-06T00:00:00Z', runId: null, revision: 'c'.repeat(64), contentOffset: 0, contentLength: [...content].length, nextContentCursor: null};
}
export const scopedEnvelope = {authority: 'personal', threadId: 'exact-owner', scopeKey: scopedContext.scopeKey, sequence: 10};
