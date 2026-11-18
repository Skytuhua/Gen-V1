import { authenticated, command, read } from './api.ts';
import type { AdapterCapabilityV1, ForkCapability, ImportPreviewV1, ImportReceiptV1, ImportedConversationV1, SessionBranchV1, SessionCaptureV1 } from '../../../packages/contracts/session-branch.ts';

export interface SessionBranchOverview {
  enabled: { branch: boolean; import: boolean };
  capabilities: {
    inspect: 'SUPPORTED';
    quote: 'SUPPORTED';
    nativeFork: ForkCapability;
    adapters: readonly AdapterCapabilityV1[];
  };
  captures: readonly Omit<SessionCaptureV1, 'messages'>[];
  branch: SessionBranchV1 | null;
  children: readonly Omit<SessionBranchV1, 'quote'>[];
  imports: readonly Omit<ImportedConversationV1, 'messages'>[];
}

export interface CapturePage {
  captureId: string;
  sourceThreadId: string;
  sourceCut: SessionCaptureV1['sourceCut'];
  coverage: SessionCaptureV1['coverage'];
  truncated: number;
  incompleteSource: SessionCaptureV1['incompleteSource'];
  snapshotUpperSequence: number;
  messages: readonly SessionCaptureV1['messages'][number][];
  nextCursor: string | null;
}

export interface ImportedPage {
  conversationId: string;
  importId: string;
  externalId: string;
  sourceProduct: string;
  exportedAt: string;
  attachmentOmissions: number;
  importWarnings: readonly string[];
  messages: readonly ImportedConversationV1['messages'][number][];
  nextCursor: string | null;
}

const get = <T>(path: string, signal?: AbortSignal) =>
  authenticated(() => fetch(path, { credentials: 'same-origin', cache: 'no-store', signal })).then(read<T>);

export const getSessionBranchOverview = (threadId: string, signal?: AbortSignal) =>
  get<SessionBranchOverview>(`/api/session-branches/${encodeURIComponent(threadId)}`, signal);

export const getCaptureMessages = (captureId: string, cursor?: string, signal?: AbortSignal) =>
  get<CapturePage>(`/api/session-branches/captures/${encodeURIComponent(captureId)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);

export const getImportedMessages = (conversationId: string, cursor?: string, signal?: AbortSignal) =>
  get<ImportedPage>(`/api/session-branches/imports/${encodeURIComponent(conversationId)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);

export interface BranchCommandResult {
  intent: 'INSPECT' | 'START_NEW_WITH_QUOTE' | 'FORK_CONVERSATION';
  capture: Pick<SessionCaptureV1, 'captureId' | 'sourceCut' | 'coverage' | 'truncated' | 'incompleteSource' | 'owner'> | null;
  branch: SessionBranchV1 | null;
  thread: { id: string } | null;
  capabilities: { inspect: 'SUPPORTED'; quote: 'SUPPORTED'; nativeFork: ForkCapability };
}

const result = <T>(receipt: Promise<{ result: unknown }>) => receipt.then(item => item.result as T);

export const inspectPoint = (threadId: string) =>
  result<BranchCommandResult>(command('session.branch', { intent: 'INSPECT' }, threadId));

export const startQuotedTask = (threadId: string, input: { quoteMessageIds: string[]; title?: string; modelId?: string; accountId?: string | null }) =>
  result<BranchCommandResult>(command('session.branch', {
    intent: 'START_NEW_WITH_QUOTE',
    quoteMessageIds: input.quoteMessageIds,
    ...(input.title ? { title: input.title } : {}),
    ...(input.modelId ? { requestedModelBinding: { modelId: input.modelId, accountId: input.accountId ?? null } } : {}),
  }, threadId));

export const forkConversation = (threadId: string, requestedModelBinding?: { modelId: string; accountId: string | null }) =>
  result<BranchCommandResult>(command('session.branch', { intent: 'FORK_CONVERSATION', ...(requestedModelBinding ? { requestedModelBinding } : {}) }, threadId));

export interface StageOutcome { staged: { importId: string } | null; preview: ImportPreviewV1; deduplicated: ImportReceiptV1 | null }
export interface CommitOutcome { receipt: ImportReceiptV1; conversations: string[]; deduplicated: boolean }
export interface CancelOutcome { outcome: 'STAGED_REMOVED' | 'ALREADY_COMMITTED'; importId: string; receipt: ImportReceiptV1 | null }

export const stageImport = (threadId: string, archive: string) =>
  result<StageOutcome>(command('historyImport.stage', { archive }, threadId));
export const commitImport = (threadId: string, importId: string) =>
  result<CommitOutcome>(command('historyImport.commit', { importId }, threadId));
export const cancelImport = (threadId: string, importId: string) =>
  result<CancelOutcome>(command('historyImport.cancel', { importId }, threadId));
