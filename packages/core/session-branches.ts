import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HarnessError, type Message, type Thread } from '../contracts/index.ts';
import {
  SESSION_CAPTURE_LIMITS,
  adapterCapabilityV1Schema,
  branchModelBindingV1Schema,
  sessionBranchV1Schema,
  sessionCaptureV1Schema,
  type AdapterCapabilityV1,
  type BranchIntent,
  type BranchModelBindingV1,
  type SessionBranchV1,
  type SessionCaptureMessageV1,
  type SessionCaptureV1,
  type SourceCutV1,
} from '../contracts/session-branch.ts';
import { digest, type Store } from '../storage/store.ts';
import { listImportedConversations } from './history-import.ts';
import type { ImportedConversationV1 } from '../contracts/session-branch.ts';

/** M14 session branching. Source history stays immutable: Inspect copies a
 * bounded frozen view, START_NEW_WITH_QUOTE creates an ordinary new task with
 * fresh authorization, and FORK_CONVERSATION is refused until an adapter
 * proves a tested native fork API. None of these paths replays tool calls,
 * restores approvals or changes files. */

const error = (code: string, message: string, details?: unknown) => new HarnessError(code, message, details);

/* ------------------------------------------------------------------ */
/* Adapter capability matrix (M14-S01), tested against the actual       */
/* runtimes: hermes sessions are owner-bound (sessionOwner refuses a    */
/* foreign threadId and forking by copying session files is prohibited  */
/* by the spec), pi exposes only agent.start/agent.followUp, and the    */
/* official-* adapters are scripted model transports with no fork call. */
/* No adapter exposes a tested fork API, and RuntimeAdapter .history    */
/* returns delivery receipt IDs, never a transcript.                    */
/* ------------------------------------------------------------------ */

export const M14_ADAPTER_CAPABILITIES: readonly AdapterCapabilityV1[] = [
  { adapterId: 'hermes', receiptHistory: true, fixedCutInspect: 'UNSUPPORTED', nativeFork: 'UNSUPPORTED' },
  { adapterId: 'pi', receiptHistory: true, fixedCutInspect: 'UNSUPPORTED', nativeFork: 'UNSUPPORTED' },
  { adapterId: 'official-claude', receiptHistory: true, fixedCutInspect: 'UNSUPPORTED', nativeFork: 'UNSUPPORTED' },
  { adapterId: 'official-gemini', receiptHistory: true, fixedCutInspect: 'UNSUPPORTED', nativeFork: 'UNSUPPORTED' },
  { adapterId: 'official-cursor', receiptHistory: true, fixedCutInspect: 'UNSUPPORTED', nativeFork: 'UNSUPPORTED' },
].map(entry => adapterCapabilityV1Schema.parse(entry));

export function adapterForkCapability(): 'SUPPORTED' | 'UNSUPPORTED' | 'UNPROVEN' {
  return M14_ADAPTER_CAPABILITIES.some(item => item.nativeFork === 'SUPPORTED') ? 'SUPPORTED'
    : M14_ADAPTER_CAPABILITIES.every(item => item.nativeFork === 'UNSUPPORTED') ? 'UNSUPPORTED' : 'UNPROVEN';
}

/* ------------------------------------------------------------------ */
/* Inspect point — owner-bound immutable capture (M14-S02, M14-C03).    */
/* ------------------------------------------------------------------ */

const captureRevision = (message: Message) => digest(message);

function sourceCut(store: Store, selected: readonly Message[]): SourceCutV1 {
  return {
    sequence: store.sequence,
    messageCount: selected.length,
    revisionDigest: digest(selected.map(message => `${message.id}:${captureRevision(message)}`)),
  };
}

/** Inside a host transaction: copies a bounded frozen view of the source
 * thread's projected messages. New events can never move this cut. */
export function captureThreadHistory(store: Store, thread: Thread): SessionCaptureV1 {
  const all = store.all<Message>('message', thread.id).filter(message => message.threadId === thread.id);
  const selected: Message[] = [];
  let bytes = 0;
  for (let index = all.length - 1; index >= 0 && selected.length < SESSION_CAPTURE_LIMITS.maxMessages; index--) {
    const message = all[index]!;
    const size = Buffer.byteLength(message.content ?? '', 'utf8');
    if (selected.length && bytes + size > SESSION_CAPTURE_LIMITS.maxContentBytes) break;
    bytes += size;
    selected.unshift(message);
  }
  const cut = sourceCut(store, selected);
  const truncated = all.length - selected.length;
  const incompleteSource: SessionCaptureV1['incompleteSource'] = ['NATIVE_TRANSCRIPT_UNAVAILABLE', 'ATTACHMENTS_NOT_CAPTURED'];
  if (truncated > 0) incompleteSource.unshift('TRUNCATED_HISTORY');
  return sessionCaptureV1Schema.parse({
    version: 1,
    captureId: randomUUID(),
    sourceThreadId: thread.id,
    owner: {
      threadId: thread.id,
      projectId: thread.projectId ?? null,
      accountId: thread.accountId ?? null,
      kind: thread.sideParentId || thread.kind === 'side' ? 'side' : 'main',
      sideParentId: thread.sideParentId ?? null,
    },
    sourceCut: cut,
    coverage: truncated > 0 ? 'TRUNCATED' : 'COMPLETE',
    truncated,
    incompleteSource,
    messages: selected.map<SessionCaptureMessageV1>(message => ({
      id: message.id, role: message.role, createdAt: message.createdAt, runId: message.runId ?? null,
      revision: captureRevision(message), content: message.content ?? '',
    })),
    createdAt: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* session.branch command body (inside Store.command).                  */
/* ------------------------------------------------------------------ */

export interface BranchCommandDeps { accountExists?: (accountId: string) => boolean }

export interface BranchOutcome {
  intent: BranchIntent;
  capture: Pick<SessionCaptureV1, 'captureId' | 'sourceCut' | 'coverage' | 'truncated' | 'incompleteSource' | 'owner'> | null;
  branch: SessionBranchV1 | null;
  thread: Thread | null;
  capabilities: { inspect: 'SUPPORTED'; quote: 'SUPPORTED'; nativeFork: 'SUPPORTED' | 'UNSUPPORTED' | 'UNPROVEN' };
}

const bounded = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max)
    throw error('INVALID_INPUT', 'A bounded nonempty string is required');
  return value;
};

function parseIntent(value: unknown): BranchIntent {
  if (value !== 'INSPECT' && value !== 'START_NEW_WITH_QUOTE' && value !== 'FORK_CONVERSATION')
    throw error('INVALID_INPUT', 'Unknown session.branch intent');
  return value;
}

function parseBinding(value: unknown): BranchModelBindingV1 | null {
  if (value === undefined || value === null) return null;
  return branchModelBindingV1Schema.parse(value);
}

/** Runs inside Store.command on the source thread. */
export function applySessionBranch(store: Store, source: Thread, payload: Record<string, unknown>, deps: BranchCommandDeps = {}): BranchOutcome {
  const intent = parseIntent(payload.intent);
  const capabilities: BranchOutcome['capabilities'] = { inspect: 'SUPPORTED', quote: 'SUPPORTED', nativeFork: adapterForkCapability() };
  if (source.kind === 'delegate') throw error('CAPABILITY_DENIED', 'Delegated transcripts cannot be branched.');

  if (intent === 'INSPECT') {
    const capture = captureThreadHistory(store, source);
    store.put('sessionCapture', capture.captureId, source.id, capture);
    const { captureId, sourceCut: cut, coverage, truncated, incompleteSource, owner } = capture;
    return { intent, capture: { captureId, sourceCut: cut, coverage, truncated, incompleteSource, owner }, branch: null, thread: null, capabilities };
  }

  if (intent === 'FORK_CONVERSATION') {
    // A native fork needs a tested adapter fork API plus platform proof;
    // testing found none (see M14_ADAPTER_CAPABILITIES). An account
    // mismatch or revoked source would also refuse a live fork — surface
    // that reason when it applies.
    const requested = parseBinding(payload.requestedModelBinding);
    if (requested?.accountId && source.accountId && requested.accountId !== source.accountId)
      throw error('FORK_UNSUPPORTED', 'Native fork refused: the requested account does not match the source binding.');
    throw error('FORK_UNSUPPORTED', 'Native conversation fork is not supported: no tested adapter fork API exists. Use Inspect point or Start new task with quoted context instead.');
  }

  // START_NEW_WITH_QUOTE — a distinct, explicitly labeled new task. Source
  // history stays immutable; new live work uses new identity and fresh grants.
  const messageIds = payload.quoteMessageIds;
  if (!Array.isArray(messageIds) || !messageIds.length || messageIds.length > 8 || messageIds.some(id => typeof id !== 'string' || !id))
    throw error('INVALID_INPUT', 'Select between 1 and 8 source messages to quote.');
  const binding = parseBinding(payload.requestedModelBinding);
  if (binding?.accountId && deps.accountExists && !deps.accountExists(binding.accountId))
    throw error('INVALID_INPUT', 'The requested account is unavailable.');
  const nativeCheckpointRef = payload.nativeCheckpointRef === undefined ? null
    : payload.nativeCheckpointRef === null ? null : bounded(payload.nativeCheckpointRef, 512);
  const excerpts = messageIds.map(id => {
    const message = store.get<Message>('message', String(id));
    if (!message || message.threadId !== source.id)
      throw error('INVALID_INPUT', `Message "${String(id).slice(0, 80)}" is not part of the source conversation.`);
    return { id: message.id, role: message.role, excerpt: (message.content ?? '').slice(0, 2000) };
  });
  const sourceMessages = store.all<Message>('message', source.id).filter(message => message.threadId === source.id);
  const title = payload.title === undefined ? 'New task (quoted context)' : bounded(payload.title, 140);
  const now = new Date().toISOString();
  const child: Thread = {
    id: randomUUID(), kind: 'main', title, createdAt: now, updatedAt: now,
    status: 'ready', epoch: 0, runId: null, modelId: binding?.modelId ?? null,
    accountId: binding?.accountId ?? null, sessionPath: null,
    projectName: source.projectId ? (source.projectName ?? null) : null,
    ...(source.projectId ? { projectId: source.projectId } : {}),
  };
  const branch = sessionBranchV1Schema.parse({
    version: 1,
    branchId: randomUUID(),
    intent,
    parentThreadId: source.id,
    childThreadId: child.id,
    sourceCut: sourceCut(store, sourceMessages),
    quote: { messageIds: messageIds.map(String), excerpts },
    requestedModelBinding: binding,
    nativeCheckpointRef,
    forkCapability: adapterForkCapability(),
    createdAt: now,
  });
  store.put('thread', child.id, child.id, child);
  store.put('sessionBranch', branch.branchId, child.id, branch);
  return { intent, capture: null, branch, thread: child, capabilities };
}

/* ------------------------------------------------------------------ */
/* Owner-fenced readers for captures, lineage and archives.            */
/* ------------------------------------------------------------------ */

interface PageInput { cursor?: string | null; limit?: number }

const denied = () => error('CAPABILITY_DENIED', 'The historical record is unavailable for this owner.');
const invalidCursor = () => error('INVALID_CURSOR', 'The cursor is invalid for this historical record.');

export class SessionBranchReadModels {
  private readonly secret = randomBytes(32);
  constructor(private readonly store: Store) {}

  private encode(position: number, identity: string): string {
    const payload = `${position}.${identity}`;
    return payload + '.' + createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
  private decode(token: string, identity: string): number {
    const parts = token.split('.');
    if (parts.length !== 3) throw invalidCursor();
    const [position, id, signature] = parts;
    if (id !== identity || !/^\d+$/.test(position ?? '')) throw invalidCursor();
    const supplied = Buffer.from(signature ?? '', 'base64url');
    const expected = createHmac('sha256', this.secret).update(`${position}.${id}`).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
    return Number(position);
  }

  private sourceThread(capture: SessionCaptureV1): Thread {
    const thread = this.store.get<Thread>('thread', capture.sourceThreadId);
    // Re-fence the captured owner: deletion, account revocation or a project
    // reassignment leaves the pointer unresolved — never substitute evidence.
    if (!thread || thread.kind === 'delegate') throw denied();
    if ((thread.projectId ?? null) !== capture.owner.projectId || (thread.accountId ?? null) !== capture.owner.accountId) throw denied();
    if ((thread.sideParentId ?? null) !== capture.owner.sideParentId) throw denied();
    if (capture.owner.accountId && !this.store.get('account', capture.owner.accountId)) throw denied();
    return thread;
  }

  private capture(captureId: string): SessionCaptureV1 {
    const capture = this.store.get<SessionCaptureV1>('sessionCapture', captureId);
    if (!capture || capture.version !== 1) throw denied();
    this.sourceThread(capture);
    return capture;
  }

  overview(threadId: string) {
    const thread = this.store.get<Thread>('thread', threadId);
    if (!thread || thread.kind === 'delegate') throw denied();
    const captures = this.store.all<SessionCaptureV1>('sessionCapture', threadId)
      .filter(capture => capture.sourceThreadId === threadId)
      .map(({ messages: _messages, ...summary }) => summary);
    const branch = this.store.all<SessionBranchV1>('sessionBranch', threadId).find(item => item.childThreadId === threadId) ?? null;
    const children = this.store.all<SessionBranchV1>('sessionBranch')
      .filter(item => item.parentThreadId === threadId)
      .map(({ quote: _quote, ...summary }) => summary);
    const imports = listImportedConversations(this.store, { threadId, projectId: thread.projectId ?? null })
      .map(({ messages: _messages, ...summary }) => summary);
    return {
      capabilities: { inspect: 'SUPPORTED', quote: 'SUPPORTED', nativeFork: adapterForkCapability(), adapters: M14_ADAPTER_CAPABILITIES },
      captures, branch, children, imports,
    };
  }

  captureMessages(captureId: string, input: PageInput = {}) {
    const capture = this.capture(captureId);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const before = input.cursor ? this.decode(input.cursor, captureId) : capture.messages.length;
    if (before < 0 || before > capture.messages.length) throw invalidCursor();
    const start = Math.max(0, before - limit);
    const page = capture.messages.slice(start, before);
    return {
      captureId,
      sourceThreadId: capture.sourceThreadId,
      sourceCut: capture.sourceCut,
      coverage: capture.coverage,
      truncated: capture.truncated,
      incompleteSource: capture.incompleteSource,
      snapshotUpperSequence: capture.sourceCut.sequence,
      messages: page,
      nextCursor: start > 0 ? this.encode(start, captureId) : null,
    };
  }

  private importOwner(record: ImportedConversationV1): void {
    const thread = this.store.get<Thread>('thread', record.owner.threadId);
    if (!thread || (thread.projectId ?? null) !== record.owner.projectId) throw denied();
  }

  importedMessages(conversationId: string, input: PageInput = {}) {
    const record = this.store.get<ImportedConversationV1>('importedConversation', conversationId);
    if (!record || record.version !== 1) throw denied();
    this.importOwner(record);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const before = input.cursor ? this.decode(input.cursor, conversationId) : record.messages.length;
    if (before < 0 || before > record.messages.length) throw invalidCursor();
    const start = Math.max(0, before - limit);
    return {
      conversationId,
      importId: record.importId,
      externalId: record.externalId,
      sourceProduct: record.sourceProduct,
      exportedAt: record.exportedAt,
      attachmentOmissions: record.attachmentOmissions,
      importWarnings: record.importWarnings ?? [],
      messages: record.messages.slice(start, before),
      nextCursor: start > 0 ? this.encode(start, conversationId) : null,
    };
  }
}
