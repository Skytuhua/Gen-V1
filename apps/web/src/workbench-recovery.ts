import {
  WORKBENCH_LIMITS, draftContextV1Schema, logicalOwnerV1Schema, sameLogicalOwner, workbenchViewV1Schema,
  type DraftContextV1, type LogicalOwnerV1, type WorkbenchViewV1,
} from '../../../packages/contracts/source-selection';
import {journalCompareAndSwap, journalCompareAndSwapMany, journalFlush, journalHandoffState, journalNoteLocalWork, journalReadRecord, journalWrite, settleJournalHandoff} from './journal';

/** The existing composer journal remains the only active text owner. */
export const sourceDraftKey = (owner: LogicalOwnerV1) => `source-context:${[owner.threadId, owner.projectId ?? '', owner.workspaceId ?? ''].map(encodeURIComponent).join(':')}`;
export type SourceDraftState = Omit<DraftContextV1, 'text'>;
export type SourceDraftSnapshot = SourceDraftState & {generation: string | undefined};

function metadata(context: DraftContextV1): SourceDraftState {
  return {draftId: context.draftId, logicalOwner: context.logicalOwner, revision: context.revision,
    sourceRefs: context.sourceRefs, sendMode: context.sendMode, conflictState: context.conflictState};
}

export function parseSourceDraftMetadata(value: unknown, owner: LogicalOwnerV1): SourceDraftState {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'text')) throw Error('Invalid source draft metadata. The composer journal owns text.');
  const context = draftContextV1Schema.parse({...value, text: ''});
  if (!sameLogicalOwner(context.logicalOwner, owner)) throw Error('The source draft owner or workspace changed. Existing context was retained.');
  return metadata(context);
}

export async function readSourceDraft(logicalOwner: LogicalOwnerV1): Promise<SourceDraftSnapshot> {
  const owner = logicalOwnerV1Schema.parse(logicalOwner), record = await journalReadRecord(sourceDraftKey(owner));
  const state = record ? parseSourceDraftMetadata(record.value, owner) : {
    draftId: crypto.randomUUID(), logicalOwner: owner, revision: 0, sourceRefs: [], sendMode: 'NOW' as const, conflictState: 'NONE' as const,
  };
  return {...state, generation: record?.generation};
}

/** Generation checks protect a new edit from a delayed source lookup or send receipt.
 * Callers must additionally fence their async operation before invoking an edit. */
export async function updateSourceDraft(owner: LogicalOwnerV1, change: (state: SourceDraftState) => SourceDraftState): Promise<SourceDraftSnapshot> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await journalFlush();
    const [current, active] = await Promise.all([readSourceDraft(owner), journalReadRecord<string>(`draft:${owner.threadId}`)]);
    if (active && typeof active.value !== 'string') throw Error('The existing composer draft could not be read. Keep this workspace open.');
    const before = metadata({...current, text: ''});
    const proposed = change(before);
    const next = parseSourceDraftMetadata({...proposed, revision: current.revision + 1}, owner);
    // A first attachment also claims an absent canonical draft generation. A
    // legacy text-only import that previously saw no draft must then retain its
    // backup instead of silently pairing unrelated text with this new context.
    const changed = active
      ? await journalCompareAndSwap(sourceDraftKey(owner), current.generation, next, {acknowledgeHandoffRetry: true})
      : await journalCompareAndSwapMany([{key: sourceDraftKey(owner), generation: current.generation, value: next}, {key: `draft:${owner.threadId}`, generation: undefined, value: ''}], [], {acknowledgeHandoffRetry: true});
    if (changed) return readSourceDraft(owner);
  }
  throw Error('Source context changed in another window. Review the current draft before retrying.');
}

export async function clearAcceptedSourceDraft(owner: LogicalOwnerV1, generation: string | undefined): Promise<boolean> {
  const current = await readSourceDraft(owner);
  if (current.generation !== generation) return false;
  if (!current.generation) return true;
  const next = parseSourceDraftMetadata({...metadata({...current, text: ''}), revision: current.revision + 1, sourceRefs: [], conflictState: 'NONE'}, owner);
  return journalCompareAndSwap(sourceDraftKey(owner), generation, next);
}

export async function composeDraftContext(owner: LogicalOwnerV1): Promise<DraftContextV1> {
  const [source, text] = await Promise.all([readSourceDraft(owner), journalReadRecord<string>(`draft:${owner.threadId}`)]);
  if (text && typeof text.value !== 'string') throw Error('The existing composer draft could not be read. Keep this workspace open.');
  return draftContextV1Schema.parse({...metadata({...source, text: ''}), revision: Math.max(source.revision, text?.updatedAt ?? 0), text: text?.value ?? ''});
}

export interface WorkbenchOwnerToken {readonly logicalOwner: LogicalOwnerV1; readonly epoch: number}
export function createWorkbenchOwnerFence(initialOwner: LogicalOwnerV1) {
  let owner = logicalOwnerV1Schema.parse(initialOwner), epoch = 0;
  const isCurrent = (token: WorkbenchOwnerToken) => token.epoch === epoch && sameLogicalOwner(token.logicalOwner, owner);
  return {
    capture: (): WorkbenchOwnerToken => Object.freeze({logicalOwner: Object.freeze({...owner}), epoch}),
    isCurrent,
    switchOwner: (next: LogicalOwnerV1) => {owner = logicalOwnerV1Schema.parse(next); epoch++;},
    accept: (token: WorkbenchOwnerToken, apply: () => void): boolean => {if (!isCurrent(token)) return false; apply(); return true;},
  };
}

export type WorkbenchHandoffResult = {status: 'READY'; draft: DraftContextV1} | {
  status: 'CONFLICT'; reason: 'FLUSH_FAILED' | 'ACKNOWLEDGMENT_UNCERTAIN'; retained: 'JOURNAL' | 'MEMORY';
  conflictKey: string; draft: DraftContextV1; message: string;
};

/** A conflict result never authorizes navigation. Its explicit copy is recovery
 * data, not another active composer. The caller keeps the current owner mounted. */
export async function prepareWorkbenchHandoff(options: {
  draft: DraftContextV1;
  flush?: () => Promise<void>;
  acknowledge?: () => Promise<'ACKNOWLEDGED' | 'UNCERTAIN'>;
}): Promise<WorkbenchHandoffResult> {
  const snapshot = draftContextV1Schema.parse(options.draft);
  let reason: 'FLUSH_FAILED' | 'ACKNOWLEDGMENT_UNCERTAIN' | undefined;
  try {await (options.flush ?? journalFlush)();} catch {reason = 'FLUSH_FAILED';}
  if (!reason && options.acknowledge) {
    try {if (await options.acknowledge() !== 'ACKNOWLEDGED') reason = 'ACKNOWLEDGMENT_UNCERTAIN';}
    catch {reason = 'ACKNOWLEDGMENT_UNCERTAIN';}
  }
  if (!reason) return {status: 'READY', draft: snapshot};
  const draft = {...snapshot, conflictState: 'UNCERTAIN' as const};
  const conflictKey = `workbench-conflict:${draft.logicalOwner.threadId}:${draft.draftId}:${draft.revision}:${crypto.randomUUID()}`;
  let retained: 'JOURNAL' | 'MEMORY' = 'JOURNAL';
  try {await journalWrite(conflictKey, {version: 1, draft, reason, capturedAt: new Date().toISOString()});}
  catch {retained = 'MEMORY';}
  return {status: 'CONFLICT', reason, retained, conflictKey, draft,
    message: retained === 'JOURNAL' ? 'Draft and source context retained as a conflict copy. Handoff is blocked until acknowledgment is certain.' : 'Draft and source context remain in this window. Keep it open because durable recovery could not be confirmed.'};
}

/** A source action can start at the host before it reaches a local CAS. */
export function noteSourceDraftWork(logicalOwner: LogicalOwnerV1): void {
  journalNoteLocalWork([sourceDraftKey(logicalOwnerV1Schema.parse(logicalOwner))]);
}

// Logical owners on one thread share the composer and pending-send keys. Each
// invocation validates independently, in order, so concurrent guards cannot
// mistake a peer's empty IndexedDB read for newly pending local work.
const sourceHandoffs = new Map<string, Promise<void>>();

/** Shared source portion of browser and native handoff; no registry recursion. */
export async function prepareSourceOwnerHandoff(logicalOwner: LogicalOwnerV1): Promise<void> {
  const owner = logicalOwnerV1Schema.parse(logicalOwner), previous = sourceHandoffs.get(owner.threadId);
  const work = (previous?.catch(() => undefined) ?? Promise.resolve()).then(() => validateSourceOwnerHandoff(owner));
  sourceHandoffs.set(owner.threadId, work);
  try {await work;} finally {if (sourceHandoffs.get(owner.threadId) === work) sourceHandoffs.delete(owner.threadId);}
}

async function validateSourceOwnerHandoff(owner: LogicalOwnerV1): Promise<void> {
  const keys = [sourceDraftKey(owner), `draft:${owner.threadId}`, `agents-pending:${owner.threadId}`];
  for (;;) {
    await settleJournalHandoff(keys);
    const beforeFlush = journalHandoffState(keys);
    await journalFlush();
    const observed = journalHandoffState(keys);
    if (observed.some((state, index) => state.pending || state.revision !== beforeFlush[index].revision)) continue;
    const failed = observed[0];
    // Source CAS failures have no staged value to retry through journalFlush.
    // Ordinary composer persistence remains owned by journalFlush.
    if (failed.failure) throw failed.failure.cause;
    // Only an untouched renderer whose original reads all failed is cold.
    // Successful empty recovery, any acquired record, a source action or a CAS
    // permanently removes this allowance for the same journal owner.
    if (observed.every(state => state.readFailures > 0 && !state.readSucceeded && !state.recordSeen && !state.localWorkAttempted)) return;
    const source = await readSourceDraft(owner);
    if (source.sourceRefs.length) {
      const result = await prepareWorkbenchHandoff({draft: await composeDraftContext(owner),
        acknowledge: async () => (await journalReadRecord(`agents-pending:${owner.threadId}`))?.value ? 'UNCERTAIN' : 'ACKNOWLEDGED'});
      if (result.status !== 'READY') throw Error(result.message);
    }
    const afterRead = journalHandoffState(keys);
    // A new local write or acquired generation can arrive during an await.
    if (afterRead.some((state, index) => state.pending || state.changeRevision !== observed[index].changeRevision)) continue;
    return;
  }
}

const ownerKey = (owner: LogicalOwnerV1) => JSON.stringify([owner.threadId, owner.projectId, owner.workspaceId]);
const viewKey = (view: WorkbenchViewV1) => JSON.stringify([ownerKey(view.logicalOwner), view.viewType]);
const cacheKey = (deviceId: string) => `workbench-views:${deviceId}`;

/** Device-local presentation only. Eviction cannot remove host task facts. */
export function updateWorkbenchViewCache(entries: readonly WorkbenchViewV1[], proposed: unknown): WorkbenchViewV1[] {
  const next = workbenchViewV1Schema.parse(proposed), parsed = entries.map(entry => workbenchViewV1Schema.parse(entry));
  if (parsed.some(entry => entry.deviceId !== next.deviceId)) throw Error('Workbench views belong to different local devices.');
  const byKey = new Map<string, WorkbenchViewV1>();
  for (const entry of [...parsed, next]) {
    const previous = byKey.get(viewKey(entry));
    if (!previous || entry.revision > previous.revision || entry.revision === previous.revision && entry.updatedAt >= previous.updatedAt) byKey.set(viewKey(entry), entry);
  }
  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, WORKBENCH_LIMITS.maxViewEntries);
}

function parseViewCache(value: unknown, deviceId: string): WorkbenchViewV1[] {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['version', 'deviceId', 'entries'].includes(key))) throw Error('Invalid workbench view cache.');
  const cache = value as {version?: unknown; deviceId?: unknown; entries?: unknown};
  if (cache.version !== 1 || cache.deviceId !== deviceId || !Array.isArray(cache.entries) || cache.entries.length > WORKBENCH_LIMITS.maxViewEntries) throw Error('Invalid local workbench view cache.');
  const parsed = cache.entries.map(entry => workbenchViewV1Schema.parse(entry));
  if (parsed.some(entry => entry.deviceId !== deviceId) || new Set(parsed.map(viewKey)).size !== parsed.length) throw Error('Invalid workbench view ownership.');
  return parsed;
}

export async function loadWorkbenchViews(deviceId: string): Promise<WorkbenchViewV1[]> {
  return parseViewCache((await journalReadRecord(cacheKey(deviceId)))?.value, deviceId);
}

async function commitWorkbenchView(view: WorkbenchViewV1): Promise<WorkbenchViewV1[]> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await journalFlush();
    const key = cacheKey(view.deviceId), record = await journalReadRecord(key);
    const entries = updateWorkbenchViewCache(parseViewCache(record?.value, view.deviceId), view);
    if (await journalCompareAndSwap(key, record?.generation, {version: 1, deviceId: view.deviceId, entries})) return entries;
  }
  throw Error('Workbench presentation changed in another window. The current draft remains unchanged.');
}

// Scroll events can enqueue many updates before the first IDB transaction
// commits. Serialize one local device's writes so they do not spend every CAS
// retry contending with themselves. CAS still fences other browser windows.
const viewSaves = new Map<string, Promise<WorkbenchViewV1[]>>();
export async function saveWorkbenchView(proposed: WorkbenchViewV1): Promise<WorkbenchViewV1[]> {
  const view = workbenchViewV1Schema.parse(proposed), previous = viewSaves.get(view.deviceId);
  const work = (previous?.catch(() => undefined) ?? Promise.resolve()).then(() => commitWorkbenchView(view));
  viewSaves.set(view.deviceId, work);
  try {return await work;} finally {if (viewSaves.get(view.deviceId) === work) viewSaves.delete(view.deviceId);}
}
