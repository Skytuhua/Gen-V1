import {afterEach, describe, expect, it, vi} from 'vitest';
import type {JournalRecord} from '../apps/web/src/journal';
import type {SourceDraftState} from '../apps/web/src/workbench-recovery';

const owner = {threadId: 'thread-a', projectId: 'project-a', workspaceId: 'copy-a'};
const otherOwner = {...owner, threadId: 'thread-b'};
const sourceKey = 'source-context:thread-a:project-a:copy-a';
const keys = [sourceKey, 'draft:thread-a', 'agents-pending:thread-a'];
const sourceRef = {captureId: 'capture-a', keepCaptured: false, source: {
  kind: 'MESSAGE' as const, sourceId: 'message-a', sourceRevision: 'revision-a', logicalOwner: owner,
  contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T10:00:00.000Z',
  range: {encoding: 'UTF16' as const, start: 1, end: 3, selectedTextDigest: 'b'.repeat(64)},
}};
const metadata: SourceDraftState = {draftId: 'draft-a', logicalOwner: owner, revision: 3,
  sourceRefs: [sourceRef], sendMode: 'AFTER_CURRENT', conflictState: 'NONE'};
const contextFields = {draftId: metadata.draftId, logicalOwner: metadata.logicalOwner, sourceRefs: metadata.sourceRefs, sendMode: metadata.sendMode, conflictState: metadata.conflictState};
const references = {threads: [{id: owner.threadId}], skills: [], userStates: [], requests: []};
const backup = JSON.stringify({app: 'generative-harness-drafts', version: 2, entries: [
  {key: 'draft:thread-a', record: {value: 'Imported prompt', generation: 'backup-text', updatedAt: 1}},
  {key: sourceKey, record: {value: metadata, generation: 'backup-source', updatedAt: 1}},
]});

const releases = new Set<() => void>();
function gate() {
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  const pending = new Promise<void>(resolve => {finish = resolve;});
  const release = () => {finish(); releases.delete(release);};
  releases.add(release);
  return {entered, enter, pending, release};
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function watch<T>(promise: Promise<T>) {
  let settled = false;
  const result = promise.then(value => {settled = true; return {ok: true as const, value};},
    error => {settled = true; return {ok: false as const, error};});
  return {result, get settled() {return settled;}};
}
afterEach(() => {for (const release of [...releases]) release(); vi.unstubAllGlobals(); vi.resetModules();});

/** Only IndexedDB, staging and broadcast are scripted. The actual journal,
 * source parsing, generations, CAS, recovery and import functions execute. */
function storage(options: {broadcast?: boolean} = {}) {
  const rows = new Map<string, JournalRecord>(), staged = new Map<string, string>();
  const state: {unavailable?: Error; opens: number; failCommit?: Error} = {opens: 0};
  const reads: {key: string; gate: ReturnType<typeof gate>}[] = [];
  const commits: ReturnType<typeof gate>[] = [];
  const channels: {onmessage?: (event: {data: unknown}) => void}[] = [];
  vi.stubGlobal('localStorage', {getItem: (key: string) => staged.get(key) ?? null,
    setItem: (key: string, value: string) => staged.set(key, value), removeItem: (key: string) => staged.delete(key)});
  vi.stubGlobal('window', options.broadcast ? {} : undefined);
  vi.stubGlobal('BroadcastChannel', class {
    onmessage?: (event: {data: unknown}) => void;
    constructor() {channels.push(this);}
    postMessage() {}
  });
  const database = {transaction: (_name: string, mode?: string) => {
    if (state.unavailable) throw state.unavailable;
    const commitGate = mode === 'readwrite' ? commits.shift() : undefined;
    const commitFailure = mode === 'readwrite' ? state.failCommit : undefined;
    if (mode === 'readwrite') state.failCommit = undefined;
    const writes = new Map<string, JournalRecord>();
    let pending = 0, finished = false, aborted = false;
    const finish = () => {
      if (pending || finished) return;
      finished = true;
      queueMicrotask(() => {void (async () => {
        commitGate?.enter();
        if (commitGate) await commitGate.pending;
        if (aborted || commitFailure) {tx.error = commitFailure ?? tx.error; tx.onabort?.();}
        else {for (const [key, record] of writes) rows.set(key, structuredClone(record)); tx.oncomplete?.();}
      })();});
    };
    const request = (read: () => unknown, key?: string) => {
      pending++;
      const selected = reads.findIndex(item => item.key === key);
      const readGate = selected < 0 ? undefined : reads.splice(selected, 1)[0].gate;
      const item: {result: unknown; error: Error | null; onsuccess?: () => void; onerror?: () => void} = {result: undefined, error: null};
      queueMicrotask(() => {void (async () => {
        readGate?.enter();
        if (readGate) await readGate.pending;
        try {item.result = structuredClone(read()); item.onsuccess?.();}
        catch (cause) {tx.error = cause instanceof Error ? cause : Error(String(cause)); item.error = tx.error; aborted = true; item.onerror?.();}
        pending--; finish();
      })();});
      return item;
    };
    const tx = {error: Error('Controlled transaction aborted'), oncomplete: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined,
      abort: () => {aborted = true;}, objectStore: () => ({
        get: (key: string) => request(() => rows.get(key), key),
        getAllKeys: () => request(() => [...rows.keys()]), getAll: () => request(() => [...rows.values()]),
        put: (record: JournalRecord, key: string) => {writes.set(key, structuredClone(record));},
      }),
    };
    return tx;
  }};
  vi.stubGlobal('indexedDB', {open: () => {
    state.opens++;
    if (state.unavailable) throw state.unavailable;
    const request = {result: database, onsuccess: undefined as (() => void) | undefined};
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }});
  return {rows, staged, state,
    put: (key: string, value: unknown) => {const record = {value, generation: crypto.randomUUID(), updatedAt: Date.now()}; rows.set(key, record); return record;},
    holdRead: (key: string) => {const value = gate(); reads.push({key, gate: value}); return value;},
    holdCommit: () => {const value = gate(); commits.push(value); return value;},
    broadcast: (key: string, generation: string) => {for (const channel of channels) channel.onmessage?.({data: {key, generation, sender: 'other-renderer'}});},
  };
}

async function failedInitialRecovery(journal: typeof import('../apps/web/src/journal'), names = keys) {
  const results = await Promise.allSettled(names.map(key => journal.journalReadRecord(key)));
  expect(results.map(result => result.status)).toEqual(names.map(() => 'rejected'));
}

describe('M15 source handoff recovery obligations', () => {
  it('acknowledges only an untouched owner whose source, text and pending recovery all failed', async () => {
    const local = storage(), failure = Error('IDB unavailable'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await failedInitialRecovery(journal);
    const opens = local.state.opens;
    await expect(recovery.prepareSourceOwnerHandoff(owner)).resolves.toBeUndefined();
    expect(local.state.opens).toBe(opens);
    expect(local.rows.size).toBe(0); expect(local.staged.size).toBe(0);
  });

  it('does not treat an unobserved owner as a failed, untouched recovery', async () => {
    const local = storage(), failure = Error('No recovery result'); local.state.unavailable = failure;
    const recovery = await import('../apps/web/src/workbench-recovery');
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.size).toBe(0);
  });

  it('retains the strict read after an earlier successful empty recovery', async () => {
    const local = storage();
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    expect(await Promise.all(keys.map(key => journal.journalReadRecord(key)))).toEqual([undefined, undefined, undefined]);
    const failure = Error('Storage disappeared after recovery'); local.state.unavailable = failure;
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
  });

  it('keeps a locally begun source action blocking before its first journal write', async () => {
    const local = storage(), failure = Error('Capture has not reached local CAS'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await failedInitialRecovery(journal);
    recovery.noteSourceDraftWork(owner);
    expect(journal.journalGeneration(sourceKey)).toBeUndefined();
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
  });

  it('does not reset attempted source work across an A to B to A owner transition', async () => {
    const local = storage(), failure = Error('Owner recovery unavailable'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await failedInitialRecovery(journal);
    await failedInitialRecovery(journal, [recovery.sourceDraftKey(otherOwner), 'draft:thread-b', 'agents-pending:thread-b']);
    recovery.noteSourceDraftWork(owner);
    const fence = recovery.createWorkbenchOwnerFence(owner), first = fence.capture();
    fence.switchOwner(otherOwner);
    await expect(recovery.prepareSourceOwnerHandoff(otherOwner)).resolves.toBeUndefined();
    fence.switchOwner(owner);
    expect(fence.isCurrent(first)).toBe(false);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
  });

  it('drains pending source hydration before judging an independently recovered pending send', async () => {
    const local = storage(); local.put(sourceKey, metadata); local.put('draft:thread-a', 'Unsent exact prompt'); local.put('agents-pending:thread-a', {inputId: 'uncertain-input'});
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const held = local.holdRead(sourceKey), hydrating = journal.journalReadRecord(sourceKey);
    await held.entered;
    await journal.journalReadRecord('agents-pending:thread-a');
    const handing = watch(recovery.prepareSourceOwnerHandoff(owner));
    try {await turn(); expect(handing.settled).toBe(false);}
    finally {held.release(); await hydrating;}
    const result = await handing.result;
    expect(result.ok).toBe(false);
    if (result.ok) throw Error('An uncertain send must retain this owner.');
    expect(String(result.error)).toMatch(/acknowledgment|conflict/i);
    expect((await recovery.composeDraftContext(owner))).toMatchObject({...contextFields, text: 'Unsent exact prompt'});
    expect([...local.rows].filter(([key]) => key.startsWith('workbench-conflict:')).map(([, record]) => record.value)).toEqual([
      expect.objectContaining({draft: expect.objectContaining({text: 'Unsent exact prompt', sourceRefs: [sourceRef], logicalOwner: owner})}),
    ]);
  });

  it.each(['single', 'many'] as const)('waits for a first %s CAS before a generation exists', async kind => {
    const local = storage(); if (kind === 'single') local.put('draft:thread-a', 'Original prompt');
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const held = local.holdCommit();
    const writing = kind === 'single' ? journal.journalCompareAndSwap(sourceKey, undefined, metadata)
      : journal.journalCompareAndSwapMany([{key: sourceKey, generation: undefined, value: metadata}, {key: 'draft:thread-a', generation: undefined, value: 'Atomic prompt'}]);
    await held.entered;
    expect(journal.journalGeneration(sourceKey)).toBeUndefined(); expect(local.rows.has(sourceKey)).toBe(false);
    const handing = watch(recovery.prepareSourceOwnerHandoff(owner));
    try {await turn(); expect(handing.settled).toBe(false);}
    finally {held.release(); expect(await writing).toBe(true);}
    expect(await handing.result).toEqual({ok: true, value: undefined});
    expect(await recovery.composeDraftContext(owner)).toMatchObject({...contextFields, text: kind === 'single' ? 'Original prompt' : 'Atomic prompt'});
    expect(local.rows.get(sourceKey)?.value).not.toHaveProperty('text');
  });

  it('retains a failed first source CAS even when an empty read and false retry succeed', async () => {
    const local = storage(), failure = Error('First source commit failed'); local.state.failCommit = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await expect(journal.journalCompareAndSwap(sourceKey, undefined, metadata)).rejects.toBe(failure);
    expect(await journal.journalReadRecord(sourceKey)).toBeUndefined();
    expect(await journal.journalCompareAndSwap(sourceKey, 'missing-generation', metadata, {acknowledgeHandoffRetry: true})).toBe(false);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.size).toBe(0);
  });

  it('does not let accepted old-source cleanup retire a failed newer attachment', async () => {
    const local = storage(); local.put(sourceKey, metadata); local.put('draft:thread-a', 'Keep prompt');
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const submitted = await recovery.readSourceDraft(owner);
    const failure = Error('New attachment failed'); local.state.failCommit = failure;
    await expect(recovery.updateSourceDraft(owner, value => ({...value, sourceRefs: [...value.sourceRefs, {...sourceRef, captureId: 'capture-new'}]}))).rejects.toBe(failure);
    expect(await recovery.clearAcceptedSourceDraft(owner, submitted.generation)).toBe(true);
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toEqual([]);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.get('draft:thread-a')?.value).toBe('Keep prompt');
    expect(journal.journalGeneration(sourceKey)).not.toBe(submitted.generation);
  });

  it('retires an earlier failed attachment only after an explicit source edit commits', async () => {
    const local = storage(); local.put(sourceKey, metadata); local.put('draft:thread-a', 'Keep exact text');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const nextRef = {...sourceRef, captureId: 'capture-retry'}, failure = Error('Attachment commit rejected');
    local.state.failCommit = failure;
    await expect(recovery.updateSourceDraft(owner, value => ({...value, sourceRefs: [nextRef]}))).rejects.toBe(failure);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    await recovery.updateSourceDraft(owner, value => ({...value, sourceRefs: [nextRef]}));
    await expect(recovery.prepareSourceOwnerHandoff(owner)).resolves.toBeUndefined();
    expect(await recovery.composeDraftContext(owner)).toMatchObject({logicalOwner: owner, text: 'Keep exact text', sourceRefs: [nextRef], sendMode: 'AFTER_CURRENT'});
  });

  it('does not let an older explicit commit acknowledge a newer failed source operation', async () => {
    const local = storage(), journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const held = local.holdCommit();
    const older = journal.journalCompareAndSwap(sourceKey, undefined, metadata, {acknowledgeHandoffRetry: true});
    await held.entered;
    const failure = Error('Newer source operation failed to start'); local.state.unavailable = failure;
    await expect(journal.journalCompareAndSwap(sourceKey, undefined, {...metadata, revision: 9})).rejects.toBe(failure);
    local.state.unavailable = undefined; held.release(); expect(await older).toBe(true);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.get(sourceKey)?.value).toEqual(metadata);
  });

  it('keeps failed source imports blocked until an atomic import retry commits the exact bundle', async () => {
    const local = storage(), failure = Error('Source import transaction failed'); local.state.failCommit = failure;
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await expect(importDraftTransfer(backup, references)).rejects.toBe(failure);
    expect(local.rows.size).toBe(0);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect((await importDraftTransfer(backup, references)).map(row => row.status)).toEqual(['imported', 'imported']);
    await expect(recovery.prepareSourceOwnerHandoff(owner)).resolves.toBeUndefined();
    expect(await recovery.composeDraftContext(owner)).toMatchObject({...contextFields, text: 'Imported prompt'});
  });

  it.each([false, true])('waits through import preprocessing before the same registry handoff (commit fails: %s)', async fails => {
    const local = storage(), journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const {prepareEditorHandoff, registerEditorHandoff} = await import('../apps/web/src/editor-handoff');
    await Promise.all(keys.map(key => journal.journalReadRecord(key)));
    const file = gate(), failure = Error('Imported source commit failed after preprocessing');
    const importing = watch(journal.journalRecoveryOperation(async () => {
      file.enter(); await file.pending;
      return importDraftTransfer(backup, references);
    }));
    await file.entered;
    const removeSource = registerEditorHandoff('source-owner', () => recovery.prepareSourceOwnerHandoff(owner));
    const removeTransfer = registerEditorHandoff('draft-transfer', () => journal.settleJournalHandoff([]));
    const handing = watch(prepareEditorHandoff());
    try {
      await turn(); expect(handing.settled).toBe(false); expect(local.rows.size).toBe(0);
      if (fails) local.state.failCommit = failure;
      file.release();
      const imported = await importing.result, result = await handing.result;
      if (fails) {
        expect(imported).toEqual({ok: false, error: failure});
        expect(result).toEqual({ok: false, error: failure});
        expect(local.rows.size).toBe(0);
      } else {
        expect(imported.ok).toBe(true); expect(result).toEqual({ok: true, value: undefined});
        expect(await recovery.composeDraftContext(owner)).toMatchObject({...contextFields, text: 'Imported prompt'});
      }
    } finally {file.release(); await Promise.all([importing.result, handing.result]); removeSource(); removeTransfer();}
  });

  it('retains an ordinary failed draft write until its exact staged generation persists', async () => {
    const local = storage(), failure = Error('Draft storage unavailable'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await expect(journal.journalWrite('draft:thread-a', 'Locally authored text')).rejects.toBe(failure);
    const generation = journal.journalGeneration('draft:thread-a');
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect((await journal.journalReadRecord('draft:thread-a'))?.value).toBe('Locally authored text');
    local.state.unavailable = undefined;
    await expect(recovery.prepareSourceOwnerHandoff(owner)).resolves.toBeUndefined();
    expect(local.rows.get('draft:thread-a')).toMatchObject({value: 'Locally authored text', generation});
    expect(local.staged.size).toBe(0);
  });

  it('does not classify a recovered staging record with failed replay as cold', async () => {
    const local = storage(), failure = Error('Staged replay unavailable'); local.state.unavailable = failure;
    const record = {value: metadata, generation: 'staged-source', updatedAt: 1};
    local.staged.set('harness:journal-pending:' + encodeURIComponent(sourceKey), JSON.stringify(record));
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    expect(await journal.journalReadRecord(sourceKey)).toEqual(record);
    await turn();
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(await journal.journalReadRecord(sourceKey)).toEqual(record);
    expect(local.staged.size).toBe(1);
  });

  it('retains the obligation of source metadata acquired through broadcast after initial failure', async () => {
    const local = storage({broadcast: true}), failure = Error('Storage offline again'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await failedInitialRecovery(journal);
    local.state.unavailable = undefined;
    const record = local.put(sourceKey, metadata); local.broadcast(sourceKey, record.generation);
    await journal.settleJournalHandoff(keys);
    await turn();
    expect(journal.journalGeneration(sourceKey)).toBe(record.generation);
    local.state.unavailable = failure;
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.get(sourceKey)).toEqual(record);
  });

  it('retains a record observed by entry enumeration even without a cached generation', async () => {
    const local = storage(), failure = Error('Enumeration was the only successful recovery'); local.state.unavailable = failure;
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await failedInitialRecovery(journal);
    local.state.unavailable = undefined; const record = local.put(sourceKey, metadata);
    expect(await journal.journalEntries()).toEqual([{key: sourceKey, record}]);
    expect(journal.journalGeneration(sourceKey)).toBeUndefined();
    local.state.unavailable = failure;
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toBe(failure);
    expect(local.rows.get(sourceKey)).toEqual(record);
  });

  it('rejects a foreign-owner source record instead of granting the cold-owner allowance', async () => {
    const local = storage();
    const foreign = {...metadata, logicalOwner: {...owner, workspaceId: 'wrong-copy'}, sourceRefs: []};
    const before = local.put(sourceKey, foreign);
    const recovery = await import('../apps/web/src/workbench-recovery');
    await expect(recovery.prepareSourceOwnerHandoff(owner)).rejects.toThrow(/owner|workspace/i);
    expect(local.rows.get(sourceKey)).toEqual(before);
  });
});
