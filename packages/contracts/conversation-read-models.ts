import {z} from 'zod';

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursor = z.string().min(1).max(2048);
export const conversationTargetSchema = z.strictObject({authority: z.literal('personal'), threadId: id, includeArchived: z.boolean().default(false)});
export const conversationScopeSchema = conversationTargetSchema.extend({scopeKey: hash});
export const conversationHistoryQuerySchema = conversationScopeSchema.extend({limit: z.number().int().min(1).max(50).default(30), cursor: cursor.optional()});
export const conversationContentQuerySchema = conversationScopeSchema.extend({cursor});
export const conversationUpdatesQuerySchema = conversationScopeSchema.extend({checkpoint: cursor});
export const conversationOwnerSchema = z.strictObject({
  threadId: id, title: z.string().max(160), projectId: id.nullable(), projectName: z.string().max(160).nullable(),
  epoch: sequence, runId: id.nullable(), status: z.enum(['ready', 'working', 'awaiting_input', 'stopped', 'interrupted', 'completed', 'failed']), modelId: z.string().min(1).max(300).nullable(),
});
export type ConversationOwner = z.infer<typeof conversationOwnerSchema>;
export const conversationContextSchema = z.strictObject({
  authority: z.literal('personal'), owner: conversationOwnerSchema, scopeKey: hash, revision: hash, sequence,
  /** Side conversations remain text-only: no file, mutation or delegation authority. Reads grant no commands. */
  readOnly: z.boolean(), archived: z.boolean(), includeArchived: z.boolean(), researchEligible: z.boolean(), checkpoint: cursor,
});
export type ConversationContext = z.infer<typeof conversationContextSchema>;
export const conversationMessageSchema = z.strictObject({
  id, threadId: id, role: z.enum(['user', 'assistant', 'activity']), createdAt: z.string().max(100), runId: id.nullable(), revision: hash,
  content: z.string().max(8192),
  /** Half-open Unicode code-point offsets, matching SQLite substr; not UTF-16 offsets. */
  contentOffset: sequence, contentLength: sequence, nextContentCursor: cursor.nullable(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export const conversationHistoryPageSchema = z.strictObject({authority: z.literal('personal'), threadId: id, scopeKey: hash, sequence, messages: z.array(conversationMessageSchema).max(50), nextCursor: cursor.nullable()});
export type ConversationHistoryPage = z.infer<typeof conversationHistoryPageSchema>;
export const conversationContentPageSchema = z.strictObject({authority: z.literal('personal'), threadId: id, scopeKey: hash, sequence, message: conversationMessageSchema});
export type ConversationContentPage = z.infer<typeof conversationContentPageSchema>;
export const conversationUpdatesSchema = z.strictObject({authority: z.literal('personal'), threadId: id, scopeKey: hash, fromSequence: sequence, sequence, owner: conversationContextSchema.nullable(), transcriptChanged: z.boolean(), checkpoint: cursor});
export type ConversationUpdates = z.infer<typeof conversationUpdatesSchema>;
export type ConversationTarget = z.input<typeof conversationTargetSchema>;
export type ConversationScope = z.input<typeof conversationScopeSchema>;
export type ConversationHistoryQuery = z.input<typeof conversationHistoryQuerySchema>;
export type ConversationContentQuery = z.input<typeof conversationContentQuerySchema>;
export type ConversationUpdatesQuery = z.input<typeof conversationUpdatesQuerySchema>;
