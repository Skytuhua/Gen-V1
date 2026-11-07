import {z} from 'zod';
import {
  conversationTargetSchema, conversationHistoryQuerySchema, conversationContextSchema, conversationHistoryPageSchema,
  conversationContentPageSchema, conversationUpdatesSchema, conversationMessageSchema,
  type ConversationContext, type ConversationTarget, type ConversationHistoryPage, type ConversationContentPage, type ConversationMessage, type ConversationUpdates,
} from '../../../packages/contracts/conversation-read-models.ts';
import {ApiError, authenticated, read} from './api.ts';

const invalid = () => new ApiError('INVALID_RESPONSE', 'The conversation response changed scope or revision. Reload its context.');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value); if (!parsed.success) throw invalid(); return parsed.data;
}
function checkedContext(value: unknown) {
  const context = parse(conversationContextSchema, value);
  if (context.researchEligible !== (!context.readOnly && !context.archived) || context.archived && !context.includeArchived) throw invalid();
  return context;
}
const scope = (context: ConversationContext) => ({authority: context.authority, threadId: context.owner.threadId, includeArchived: context.includeArchived, scopeKey: context.scopeKey});
function checkEnvelope(context: ConversationContext, value: {threadId: string; scopeKey: string; sequence: number}) {
  if (value.threadId !== context.owner.threadId || value.scopeKey !== context.scopeKey || value.sequence < context.sequence) throw invalid();
}
function checkMessage(context: ConversationContext, message: ConversationMessage) {
  const size = [...message.content].length, end = message.contentOffset + size;
  if (message.threadId !== context.owner.threadId || size > 4096 || end > message.contentLength ||
    (message.nextContentCursor === null) !== (end === message.contentLength) || !size && message.contentLength > 0) throw invalid();
}
const get = async (threadId: string, suffix: string, input: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) => {
  const query = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return authenticated(() => fetch('/api/conversations/' + encodeURIComponent(threadId) + suffix + '?' + query, {method: 'GET', credentials: 'same-origin', cache: 'no-store', signal})).then(read<unknown>);
};

export async function getConversationContext(input: ConversationTarget, signal?: AbortSignal): Promise<ConversationContext> {
  const {threadId, ...target} = conversationTargetSchema.parse(input), context = checkedContext(await get(threadId, '', target, signal));
  if (context.owner.threadId !== threadId || context.includeArchived !== target.includeArchived) throw invalid();
  return context;
}
export async function getConversationHistory(input: ConversationContext, query: {limit?: number; cursor?: string} = {}, signal?: AbortSignal): Promise<ConversationHistoryPage> {
  const context = checkedContext(input), options = conversationHistoryQuerySchema.pick({limit: true, cursor: true}).parse(query);
  const {threadId, ...target} = {...scope(context), ...options};
  const page = parse(conversationHistoryPageSchema, await get(threadId, '/transcript', target, signal)); checkEnvelope(context, page);
  const ids = new Set<string>();
  for (const message of page.messages) {
    checkMessage(context, message);
    if (message.contentOffset !== 0 || ids.has(message.id)) throw invalid(); ids.add(message.id);
  }
  return page;
}
export async function getConversationContent(input: ConversationContext, previous: ConversationMessage, signal?: AbortSignal): Promise<ConversationContentPage> {
  const context = checkedContext(input), message = parse(conversationMessageSchema, previous); checkMessage(context, message);
  if (!message.nextContentCursor) throw new ApiError('INVALID_INPUT', 'This message has no remaining content.');
  const {threadId, ...target} = scope(context);
  const page = parse(conversationContentPageSchema, await get(threadId, '/content', {...target, cursor: message.nextContentCursor}, signal)); checkEnvelope(context, page);
  const next = page.message; checkMessage(context, next);
  if (next.id !== message.id || next.revision !== message.revision || next.contentLength !== message.contentLength ||
    next.runId !== message.runId || next.role !== message.role || next.createdAt !== message.createdAt ||
    next.contentOffset !== message.contentOffset + [...message.content].length) throw invalid();
  return page;
}
export async function getConversationUpdates(input: ConversationContext, signal?: AbortSignal): Promise<ConversationUpdates> {
  const context = checkedContext(input), {threadId, ...target} = scope(context);
  const update = parse(conversationUpdatesSchema, await get(threadId, '/updates', {...target, checkpoint: context.checkpoint}, signal)); checkEnvelope(context, update);
  if (update.fromSequence !== context.sequence) throw invalid();
  if (update.owner) {
    const next = checkedContext(update.owner); checkEnvelope(context, {...next, threadId: next.owner.threadId});
    if (next.sequence !== update.sequence || next.checkpoint !== update.checkpoint || next.owner.epoch !== context.owner.epoch ||
      next.owner.projectId !== context.owner.projectId || next.owner.modelId !== context.owner.modelId ||
      next.readOnly !== context.readOnly || next.archived !== context.archived || next.includeArchived !== context.includeArchived) throw invalid();
  }
  return update;
}
