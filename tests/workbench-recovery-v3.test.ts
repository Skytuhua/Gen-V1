import {afterEach, describe, expect, it, vi} from 'vitest';
import type {JournalRecord} from '../apps/web/src/journal';
import type {WorkbenchViewV1} from '../packages/contracts/source-selection';

const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
const otherOwner = {...owner, threadId: 'thread-b'};
const sourceRef = {captureId: 'capture-a', keepCaptured: false, source: {
  kind: 'MESSAGE' as const, sourceId: 'message-a', sourceRevision: 'a'.repeat(64), logicalOwner: owner,
  contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T10:00:00.000Z',
  range: {encoding: 'UTF16' as const, start: 1, end: 3, selectedTextDigest: 'b'.repeat(64)},
}};
const draft = {draftId: 'draft-a', logicalOwner: owner, revision: 3, text: 'Keep unsent work', sourceRefs: [sourceRef], sendMode: 'AFTER_CURRENT' as const, conflictState: 'NONE' as const};

afterEach(() => {vi.unstubAllGlobals(); vi.resetModules();});

/** IndexedDB boundary double; the production journal owns staging, generations and CAS. */
function installStorage(rows = new Map<string, JournalRecord>()) {
  const staged = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => staged.get(key) ?? null, setItem: (key: string, value: string) => staged.set(key, value), removeItem: (key: string) => staged.delete(key)});
  const database = {transaction: () => {
    let pending = 0, aborted = false;
    const writes = new Map<string, JournalRecord>();
    const tx = {error: Error('Storage failed'), oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined,
      abort: () => {aborted = true;}, objectStore: () => ({
        get: (key: string) => {
          pending++;
          const request = {result: rows.get(key), onsuccess: undefined as (() => void) | undefined};
          queueMicrotask(() => {request.onsuccess?.(); if (--pending === 0) queueMicrotask(() => {if (aborted) tx.onabort?.(); else {for (const [key, value] of writes) rows.set(key, value); tx.oncomplete?.();}});});
          return request;
        },
        put: (value: JournalRecord, key: string) => {writes.set(key, value);},
      }),
    };
    return tx;
  }};
  vi.stubGlobal('indexedDB', {open: () => {const request = {result: database, onsuccess: undefined as (() => void) | undefined}; queueMicrotask(() => request.onsuccess?.()); return request;}});
  return {rows, staged};
}

describe('M15 owner-fenced recovery', () => {
  it('rejects delayed old-owner reads including an A to B to A transition', async () => {
    const {createWorkbenchOwnerFence} = await import('../apps/web/src/workbench-recovery');
    const fence = createWorkbenchOwnerFence(owner), old = fence.capture();
    let visible = 'A';
    const result = Promise.resolve('late A response').then(value => fence.accept(old, () => {visible = value;}));
    fence.switchOwner(otherOwner); visible = 'B';
    expect(await result).toBe(false);
    expect(visible).toBe('B');
    fence.switchOwner(owner);
    expect(fence.isCurrent(old)).toBe(false);
    expect(fence.accept(fence.capture(), () => {visible = 'current A';})).toBe(true);
    expect(visible).toBe('current A');
  });

  it('keeps canonical text in the existing journal while source metadata survives reload', async () => {
    const storage = installStorage();
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    await journal.journalWrite('draft:thread-a', 'Canonical composer text');
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef], sendMode: 'AFTER_CURRENT'}));
    expect(storage.rows.get(recovery.sourceDraftKey(owner))?.value).not.toHaveProperty('text');
    expect(storage.rows.get('draft:thread-a')?.value).toBe('Canonical composer text');
    vi.resetModules();
    const reloaded = await import('../apps/web/src/workbench-recovery');
    const restored = await reloaded.composeDraftContext(owner);
    expect(restored.text).toBe('Canonical composer text');
    expect(restored.sourceRefs).toEqual([sourceRef]);
    expect(restored.sendMode).toBe('AFTER_CURRENT');
    expect(restored.logicalOwner).toEqual(owner);
  });

  it('clears accepted attachments only for the exact submitted generation', async () => {
    installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    const submitted = await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef]}));
    const nextRef = {...sourceRef, captureId: 'capture-b'};
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [...state.sourceRefs, nextRef]}));
    expect(await recovery.clearAcceptedSourceDraft(owner, submitted.generation)).toBe(false);
    const current = await recovery.readSourceDraft(owner);
    expect(current.sourceRefs).toEqual([sourceRef, nextRef]);
    expect(await recovery.clearAcceptedSourceDraft(owner, current.generation)).toBe(true);
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toEqual([]);
  });

  it('prevents a pending legacy text-only import from joining a newly attached source', async () => {
    const storage = installStorage();
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const importObserved = await journal.journalReadRecord('draft:thread-a');
    expect(importObserved).toBeUndefined();
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef]}));
    expect(await journal.journalCompareAndSwap('draft:thread-a', importObserved?.generation, 'Unrelated imported text')).toBe(false);
    expect(storage.rows.get('draft:thread-a')?.value).toBe('');
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toEqual([sourceRef]);
  });

  it('keeps old workspace context while a replacement workspace starts with an empty companion', async () => {
    const storage = installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef]}));
    const before = storage.rows.get(recovery.sourceDraftKey(owner));
    expect((await recovery.readSourceDraft({...owner, workspaceId: 'replacement'})).sourceRefs).toEqual([]);
    expect(storage.rows.get(recovery.sourceDraftKey(owner))).toBe(before);
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toEqual([sourceRef]);
  });

  it('refuses a forged foreign-owner record stored under the destination companion key', async () => {
    const storage = installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef]}));
    const foreignOwner = {...owner, workspaceId: 'foreign'};
    const before = storage.rows.get(recovery.sourceDraftKey(owner))!;
    storage.rows.set(recovery.sourceDraftKey(foreignOwner), before);
    await expect(recovery.readSourceDraft(foreignOwner)).rejects.toThrow(/owner|workspace/i);
    expect(storage.rows.get(recovery.sourceDraftKey(foreignOwner))).toBe(before);
  });

  it('retains the source context and text on failed flush instead of permitting owner handoff', async () => {
    installStorage();
    const {prepareWorkbenchHandoff} = await import('../apps/web/src/workbench-recovery');
    const {journalRead} = await import('../apps/web/src/journal');
    const result = await prepareWorkbenchHandoff({draft, flush: async () => {throw Error('Disconnected storage');}});
    expect(result.status).toBe('CONFLICT');
    if (result.status !== 'CONFLICT') throw Error('Expected retained conflict');
    expect(result.reason).toBe('FLUSH_FAILED');
    expect(result.retained).toBe('JOURNAL');
    expect(result.draft).toMatchObject({...draft, conflictState: 'UNCERTAIN'});
    expect(await journalRead(result.conflictKey)).toMatchObject({draft: {...draft, conflictState: 'UNCERTAIN'}, reason: 'FLUSH_FAILED'});
  });

  it('waits for flush before handoff acknowledgment and preserves uncertain acknowledgments', async () => {
    installStorage();
    const {prepareWorkbenchHandoff} = await import('../apps/web/src/workbench-recovery');
    let release!: () => void;
    const order: string[] = [];
    const flushing = new Promise<void>(resolve => {release = resolve;});
    const pending = prepareWorkbenchHandoff({draft, flush: async () => {order.push('flush-start'); await flushing; order.push('flush-end');}, acknowledge: async () => {order.push('acknowledge'); return 'UNCERTAIN';}});
    expect(order).toEqual(['flush-start']);
    release();
    const result = await pending;
    expect(order).toEqual(['flush-start', 'flush-end', 'acknowledge']);
    expect(result.status).toBe('CONFLICT');
    if (result.status !== 'CONFLICT') throw Error('Expected retained conflict');
    expect(result.reason).toBe('ACKNOWLEDGMENT_UNCERTAIN');
    expect(result.draft.sourceRefs).toEqual([sourceRef]);
    expect((await prepareWorkbenchHandoff({draft, flush: async () => {}, acknowledge: async () => 'ACKNOWLEDGED'})).status).toBe('READY');
  });

  it('reports memory-only retention when both durable storage and handoff fail', async () => {
    vi.stubGlobal('indexedDB', {open: () => {throw Error('Unavailable');}});
    vi.stubGlobal('localStorage', {getItem: () => null, setItem: () => {throw Error('Unavailable');}, removeItem: () => {}});
    const {prepareWorkbenchHandoff} = await import('../apps/web/src/workbench-recovery');
    const result = await prepareWorkbenchHandoff({draft, flush: async () => {throw Error('Unavailable');}});
    expect(result.status).toBe('CONFLICT');
    if (result.status !== 'CONFLICT') throw Error('Expected retained conflict');
    expect(result.retained).toBe('MEMORY');
    expect(result.draft.text).toBe('Keep unsent work');
    expect(result.draft.sourceRefs).toEqual([sourceRef]);
  });
});

describe('M15 local presentation cache', () => {
  const view = (index: number) => ({logicalOwner: {...owner, threadId: `thread-${index}`}, revision: index, viewType: 'CONVERSATION' as const,
    selectedItem: `message-${index}`, scrollAnchor: {itemId: `message-${index}`, offset: 17}, deviceId: 'device-a', updatedAt: new Date(Date.UTC(2026, 10, 15, 10, 0, index)).toISOString()});

  it('caps owner/view entries at 64 without storing canonical task fields', async () => {
    const {updateWorkbenchViewCache} = await import('../apps/web/src/workbench-recovery');
    let entries: WorkbenchViewV1[] = [];
    for (let index = 0; index < 500; index++) entries = updateWorkbenchViewCache(entries, view(index));
    expect(entries).toHaveLength(64);
    expect(entries.some(item => item.logicalOwner.threadId === 'thread-0')).toBe(false);
    expect(entries.some(item => item.logicalOwner.threadId === 'thread-499')).toBe(true);
    expect(() => updateWorkbenchViewCache(entries, {...view(500), taskStatus: 'verified'})).toThrow();
    expect(entries).toHaveLength(64);
  });

  it('keeps a newer revision and restores scroll anchors after journal reload', async () => {
    installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    const current = view(5);
    await recovery.saveWorkbenchView(current);
    await recovery.saveWorkbenchView({...current, revision: 4, scrollAnchor: {itemId: 'late-old-row', offset: 0}});
    vi.resetModules();
    const reloaded = await import('../apps/web/src/workbench-recovery');
    expect(await reloaded.loadWorkbenchViews('device-a')).toEqual([current]);
    expect(await reloaded.loadWorkbenchViews('device-b')).toEqual([]);
  });
});
