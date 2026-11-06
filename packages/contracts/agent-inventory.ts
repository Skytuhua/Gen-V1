import { z } from 'zod';

export const agentStatuses = ['ready', 'working', 'awaiting_input', 'stopped', 'interrupted', 'completed', 'failed', 'queued', 'cancelled', 'needs_review'] as const;
export type AgentStatus = typeof agentStatuses[number];
const id = z.string().min(1).max(500);
const cursor = z.string().min(1).max(2048);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const agentScopeSchema = z.strictObject({
  projectId: id.nullable().optional(), // Omitted: all projects. Null: unbound personal conversations.
  statuses: z.array(z.enum(agentStatuses)).max(agentStatuses.length).optional(),
  text: z.string().trim().max(200).optional(),
  includeArchived: z.boolean().default(false),
});
export const inventoryQuerySchema = agentScopeSchema.extend({ limit: z.number().int().min(1).max(100).default(40), cursor: cursor.optional() });
export const historyQuerySchema = z.strictObject({ agentId: id, includeArchived: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(40), cursor: cursor.optional() });
export const contentQuerySchema = historyQuerySchema.pick({ agentId: true, includeArchived: true }).extend({ cursor });
export const updatesQuerySchema = agentScopeSchema.extend({
  after: sequence, scopeKey: z.string().min(1).max(64), visibleAgentIds: z.array(id).max(24).default([]),
});
export type AgentScope = z.input<typeof agentScopeSchema>;
export type InventoryQuery = z.input<typeof inventoryQuerySchema>;
export type HistoryQuery = z.input<typeof historyQuerySchema>;
export type ContentQuery = z.input<typeof contentQuerySchema>;
export type UpdatesQuery = z.input<typeof updatesQuerySchema>;

/** Identity and canonical metadata only. Never an execution, account, or resource grant. */
export interface AgentSummary {
  agentId: string; parentId: string | null; rootId: string; jobId: string | null; threadId: string | null;
  projectId: string | null; projectName: string | null; title: string; status: AgentStatus;
  modelId: string | null; currentAction: string | null; reportedPercent: number | null;
  createdAt: string; updatedAt: string; orderKey: string; revision: number; archived: boolean;
  readOnly: boolean; metadata: 'thread' | 'canonical_job' | 'legacy_job' | 'child_link_unavailable';
}
export interface InventoryPage {
  authority: 'personal'; scopeKey: string; sequence: number; items: AgentSummary[];
  /** Owning containers for filtered/paged children, never extra conversation records. */
  ancestors: AgentSummary[]; nextCursor: string | null;
}
export interface MessageSlice {
  id: string; threadId: string; role: 'user' | 'assistant' | 'activity'; createdAt: string;
  runId: string | null; content: string; contentOffset: number; contentLength: number; nextContentCursor: string | null;
}
export interface HistoryPage {
  authority: 'personal'; agentId: string; threadId: string; sequence: number;
  messages: MessageSlice[]; nextCursor: string | null;
}
export interface InventoryUpdates {
  authority: 'personal'; scopeKey: string; fromSequence: number; sequence: number;
  resync: boolean; upserts: AgentSummary[]; removed: string[]; ancestors: AgentSummary[];
  /** Re-read the bounded history window only for visible conversations whose text changed. */
  transcripts: { agentId: string; sequence: number }[];
}
/** Consumers discard obsolete scopes/responses and resync rather than applying a gapped response. */
export function inventoryUpdateDisposition(current: Pick<InventoryPage, 'scopeKey' | 'sequence'>, update: InventoryUpdates): 'apply' | 'stale' | 'resync' {
  if (update.scopeKey !== current.scopeKey || update.sequence < current.sequence || (update.sequence === current.sequence && !update.resync)) return 'stale';
  if (update.resync || update.fromSequence !== current.sequence) return 'resync';
  return 'apply';
}
export interface PersonalAgentInventory {
  readonly authority: 'personal';
  inventory(query: InventoryQuery): InventoryPage;
  history(query: HistoryQuery): HistoryPage;
  content(query: ContentQuery): MessageSlice;
  updates(query: UpdatesQuery): InventoryUpdates;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
/** A private adapter must explicitly authorize its own store/account/resources. Never mounted on /api/agents. */
export interface CompanyAgentInventoryCapability {
  readonly authority: 'company'; readonly scopeId: string;
  readonly capabilities: { inventory: boolean; transcript: boolean; delegatedTranscriptReadOnly: true };
}
