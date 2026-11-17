import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import {Service, type ServiceOptions} from '../packages/core/service.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {WorkspaceRepository} from '../packages/core/workspace-layout.ts';
import {WORKSPACE_PRESETS, isSupportedWorkspacePreset} from '../packages/contracts/workspace.ts';
import {mapSelectedText} from '../apps/web/src/SourceSelectionActions.tsx';
import type {JournalRecord} from '../apps/web/src/journal';
import type {Message, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import type {LogicalOwnerV1} from '../packages/contracts/source-selection.ts';

const cleanup: (() => Promise<void>)[] = [];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
afterEach(async () => {vi.unstubAllGlobals(); vi.resetModules(); vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); try {__setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);} catch {/* The flag predates this fixture. */}});

function fixture(options: ServiceOptions = {}, seedAssistant = true) {
  const root = mkdtempSync(join(tmpdir(), 'm15-v6-')), store = new Store(join(root, 'data'));
  const starts: StartRun[] = [], followUps: StartRun[] = []; let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {configure(value) {callbacks = value;}, models: async () => [{id: 'test/model', provider: 'test', name: 'Test'}], start: async input => {starts.push(input);}, followUp: async input => {followUps.push(input);}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, options);
  cleanup.push(async () => {try {await service.dispose();} catch {/* Already disposed by a restart custody check. */} try {store.close();} catch {/* Already closed by a restart custody check. */} rmSync(root, {recursive: true, force: true});});
  const thread: Thread = {id: 'thread-a', title: 'Task', projectName: null, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null};
  const assistant: Message = {id: 'message-a', threadId: thread.id, role: 'assistant', content: 'A😀B\nSecond line', runId: null, createdAt: thread.createdAt};
  store.internal('fixture', thread.id, () => {store.put('thread', thread.id, thread.id, thread); if (seedAssistant) store.put('message', assistant.id, thread.id, assistant);});
  const owner = {threadId: thread.id, projectId: null, workspaceId: null};
  const source = {kind: 'MESSAGE' as const, sourceId: assistant.id, sourceRevision: sha(assistant.content), contentDigest: sha(assistant.content), logicalOwner: owner, capturedAt: thread.createdAt, range: {encoding: 'UTF16' as const, start: 1, end: 3, selectedTextDigest: sha('😀')}};
  const workbench = () => {expect(service, 'M15 must use a host source service').toHaveProperty('sourceWorkbench'); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); return service.sourceWorkbench;};
  const send = (id: string, sourceRefs: unknown[], sendMode = 'NOW', threadId = thread.id) => service.command({id, type: 'message.send', threadId, payload: {content: 'Explain the source', modelId: 'test/model', sourceRefs, sendMode}});
  return {root, store, service, runtime, starts, followUps, thread, assistant, owner, source, workbench, send, event: (event: Record<string, unknown>) => callbacks.onEvent(event as Parameters<RuntimeCallbacks['onEvent']>[0])};
}

/** IndexedDB boundary double matching workbench-recovery-v3.test.ts; the
 * production journal owns staging, generations and compare-and-swap. */
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

const sourceRef = (owner: LogicalOwnerV1, suffix = 'a') => ({captureId: 'capture-' + suffix, keepCaptured: false, source: {
  kind: 'MESSAGE' as const, sourceId: 'message-' + suffix, sourceRevision: 'a'.repeat(64), logicalOwner: owner,
  contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T10:00:00.000Z',
  range: {encoding: 'UTF16' as const, start: 1, end: 3, selectedTextDigest: 'b'.repeat(64)},
}});

/** M15-D01: no retired CodeReviewHost/ResearchHost/Custom creation path exists. */
describe('M15-D01 retired surface absence', () => {
  it('rejects creating every retired preset; only workspace and all-agents are supported', async () => {
    expect(WORKSPACE_PRESETS).toEqual(['workspace', 'all-agents', 'code-review', 'research', 'custom']);
    expect(WORKSPACE_PRESETS.filter(isSupportedWorkspacePreset)).toEqual(['workspace', 'all-agents']);
    const root = mkdtempSync(join(tmpdir(), 'm15-v6-presets-')), store = new Store(join(root, 'data'));
    cleanup.push(async () => {store.close(); rmSync(root, {recursive: true, force: true});});
    const repository = new WorkspaceRepository(store);
    for (const preset of ['code-review', 'research', 'custom'] as const) {
      let code: string | undefined;
      try {repository.command({id: 'retired-' + preset, type: 'workspace.canvas.create', threadId: 'thread-a', payload: {name: 'Retired', preset}});} catch (error) {code = (error as {code?: string}).code;}
      expect(code).toBe('PRESET_RETIRED');
    }
    for (const preset of ['workspace', 'all-agents'] as const)
      expect(repository.command({id: 'supported-' + preset, type: 'workspace.canvas.create', threadId: 'thread-a', payload: {name: 'Live', preset}})).toBeDefined();
  });
  it('restores no retired review host in the shared workspace surfaces', () => {
    for (const file of ['apps/web/src/WorkspaceSurfaceBody.tsx', 'apps/web/src/App.tsx', 'apps/web/src/WorkspaceSplitLayout.tsx', 'packages/ui-shell/ChatView.tsx', 'apps/web/src/WorkActivity.tsx']) {
      const text = readFileSync(join(__dirname, '..', file), 'utf8');
      for (const retired of ['CodeReviewHost', 'ResearchHost', 'CustomWorkspaceHost', 'VisualsHost'])
        expect(text, `${file} must not recreate ${retired}`).not.toContain(retired);
    }
  });
});

/** M15-D02: Ask populates the draft and never sends; only an explicit send submits. */
describe('M15-D02 ask versus send', () => {
  it('capturing and attaching a source changes draft state while the submit count stays zero', async () => {
    const f = fixture(), workbench = f.workbench();
    const captured = await workbench.capture({commandId: 'ask-capture', source: f.source});
    // The Ask/Attach path ends here: a captured immutable reference plus local
    // draft metadata. No outbox input and no runtime start may exist yet.
    expect(f.store.all('outbox', f.thread.id)).toEqual([]);
    expect(f.store.all<Message>('message', f.thread.id).filter(message => message.role === 'user')).toEqual([]);
    expect(f.starts).toEqual([]);
    const receipt = await f.send('explicit-send', [captured.ref]);
    expect(receipt.result).toMatchObject({inputId: 'explicit-send'});
    await vi.waitFor(() => expect(f.starts).toHaveLength(1));
    expect(f.starts[0].prompt).toContain('😀');
    expect(f.starts[0].resources).toEqual([]);
  });
  it('the Ask draft write itself never reaches the send path', async () => {
    installStorage();
    const journal = await import('../apps/web/src/journal');
    const recovery = await import('../apps/web/src/workbench-recovery');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    // SourceWorkbench 'ask' writes this exact draft sentence via CAS; it does not call send.
    await journal.journalCompareAndSwap('draft:thread-a', undefined, 'Explain this selected source.');
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef(owner)]}));
    const draft = await recovery.composeDraftContext(owner);
    expect(draft.text).toBe('Explain this selected source.');
    expect(draft.sourceRefs).toHaveLength(1);
    expect((await journal.journalReadRecord('agents-pending:thread-a'))).toBeUndefined();
  });
});

/** M15-D03: a selection/owner change completing during a pending update clears
 * only the exact original draft identity and never mutates the foreign draft. */
describe('M15-D03 delayed selection and owner custody', () => {
  it('rejects a delayed old-owner capture write while the newer foreign owner draft stays intact', async () => {
    installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    const otherOwner = {threadId: 'thread-b', projectId: null, workspaceId: null};
    const fence = recovery.createWorkbenchOwnerFence(owner), token = fence.capture();
    // The selection changes while the old-owner write is still pending.
    fence.switchOwner(otherOwner);
    await recovery.updateSourceDraft(otherOwner, state => ({...state, sourceRefs: [sourceRef(otherOwner, 'b')], sendMode: 'AFTER_CURRENT'}));
    // The delayed completion must not run its mutation; its accept fails.
    let applied = false;
    expect(fence.accept(token, () => {applied = true;})).toBe(false);
    expect(applied).toBe(false);
    expect(fence.isCurrent(token)).toBe(false);
    const foreign = await recovery.readSourceDraft(otherOwner);
    expect(foreign.sourceRefs.map(ref => ref.captureId)).toEqual(['capture-b']);
    expect(foreign.sendMode).toBe('AFTER_CURRENT');
    const original = await recovery.readSourceDraft(owner);
    expect(original.sourceRefs).toEqual([]);
  });
  it('clears only the exact original generation; a stale generation can clear nothing', async () => {
    installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    const first = await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef(owner, 'a')]}));
    const second = await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [...state.sourceRefs, sourceRef(owner, 'c')]}));
    expect(await recovery.clearAcceptedSourceDraft(owner, first.generation)).toBe(false);
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toHaveLength(2);
    expect(await recovery.clearAcceptedSourceDraft(owner, second.generation)).toBe(true);
    expect((await recovery.readSourceDraft(owner)).sourceRefs).toEqual([]);
  });
});

/** M15-D04: a source kind whose exact capture cannot be reproduced is reported
 * unsupported and can never materialize a valid-looking chip. */
describe('M15-D04 unsupported exact capture', () => {
  const diffHunk = (owner: LogicalOwnerV1) => ({kind: 'DIFF_HUNK' as const, sourceId: 'd'.repeat(64), path: 'src/a.ts', comparison: {kind: 'local' as const, scope: 'worktree' as const}, sourceRevision: 'a'.repeat(64), contentDigest: 'a'.repeat(64), logicalOwner: owner, capturedAt: '2026-11-15T10:00:00.000Z', range: {encoding: 'DIFF_LINES_1_BASED' as const, startLine: 1, endLine: 2}});
  it('reports DIFF_HUNK unsupported and refuses capture before any chip can exist', async () => {
    const f = fixture(), workbench = f.workbench();
    const capabilities = (await workbench.list(f.thread.id)).sourceCapabilities;
    const diff = capabilities.find(item => item.kind === 'DIFF_HUNK');
    expect(diff?.state).toBe('UNSUPPORTED');
    expect(diff?.reason).toBeTruthy();
    const artifact = capabilities.find(item => item.kind === 'ARTIFACT_REGION');
    expect(artifact?.state).toBe('AVAILABLE');
    const fileRange = capabilities.find(item => item.kind === 'FILE_RANGE');
    expect(fileRange?.state).toBe(process.platform === 'win32' ? 'AVAILABLE' : 'UNSUPPORTED');
    await expect(workbench.capture({commandId: 'diff-capture', source: diffHunk(f.owner)})).rejects.toMatchObject({code: 'SOURCE_UNSUPPORTED'});
    // No capture was retained; nothing valid-looking can be quoted or sent.
    expect(f.store.all('sourceCapture', f.thread.id)).toEqual([]);
    const fakeRef = {captureId: 'forged', keepCaptured: false, source: diffHunk(f.owner)};
    await expect(f.send('send-forged', [fakeRef])).rejects.toThrow();
    expect(f.store.all('outbox', f.thread.id)).toEqual([]);
  });
  it('returns no reference when rendered text cannot be mapped to canonical source', () => {
    expect(mapSelectedText('# Title\n**bold** text', 'Title bold')).toBeNull();
    expect(mapSelectedText('repeat repeat', 'repeat')).toBeNull();
    expect(mapSelectedText('A😀B', '😀')).toEqual({start: 1, end: 3, text: '😀'});
  });
});

/** M15-D05: real App custody — cross-owner denial, queued send, restart, handoff. */
describe('M15-D05 actual-app custody', () => {
  it('denies a foreign-owner send, queues AFTER_CURRENT until settle, and retains the capture across restart', async () => {
    const f = fixture(), workbench = f.workbench();
    const captured = await workbench.capture({commandId: 'custody-capture', source: f.source});
    // A second thread is a different logical owner; it can never send A's source.
    const threadB: Thread = {...f.thread, id: 'thread-b', title: 'Other'};
    f.store.internal('fixture', threadB.id, () => f.store.put('thread', threadB.id, threadB.id, threadB));
    await expect(f.send('foreign-send', [captured.ref], 'NOW', threadB.id)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    expect(f.store.all('outbox', threadB.id)).toEqual([]);
    // Queued send behind a running native epoch starts only after settlement.
    await f.send('first-send', []);
    await vi.waitFor(() => expect(f.starts).toHaveLength(1));
    await f.send('queued-send', [captured.ref], 'AFTER_CURRENT');
    expect(f.starts).toHaveLength(1);
    expect(f.store.get('outbox', 'queued-send')).toMatchObject({status: 'persisted', sendMode: 'AFTER_CURRENT'});
    const active = f.starts[0];
    f.event({...active, type: 'input.processing', inputIds: ['first-send']});
    await f.service.tool({name: 'task_finish', args: {summary: 'First input complete'}}, active);
    f.event({...active, type: 'settled'});
    await vi.waitFor(() => expect(f.starts).toHaveLength(2));
    expect(f.starts[1]).toMatchObject({inputId: 'queued-send', epoch: active.epoch + 1});
    expect(f.starts[1].prompt).toContain('😀');
    // Restart custody: a brand-new Store + Service on the same directory can
    // still open the retained capture — durable custody, not process state.
    await f.service.dispose(); f.store.close();
    const store2 = new Store(join(f.root, 'data'));
    const runtime2: RuntimeAdapter = {...f.runtime, configure: () => {}, start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}, models: async () => []};
    const service2 = new Service(store2, runtime2, {});
    cleanup.push(async () => {await service2.dispose(); store2.close(); rmSync(f.root, {recursive: true, force: true});});
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
    const opened = await service2.sourceWorkbench.open({logicalOwner: f.owner, ref: captured.ref});
    expect(opened.text).toContain('😀');
    expect(opened.state).toBe('CURRENT');
  });
  it('prepares the desktop handoff through the real recovery chain', async () => {
    installStorage();
    const recovery = await import('../apps/web/src/workbench-recovery');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef(owner)]}));
    await expect(recovery.prepareSourceOwnerHandoff(owner)).resolves.toBeUndefined();
  });
});

/** M15-D06: performance scope — bounded mounted rows, full authorized read,
 * retained search/copy, and drafts surviving a module reload. */
describe('M15-D06 performance scope', () => {
  it('mounts at most 300 rows while the authorized full model stays complete', async () => {
    const {windowWorkbenchItems, readAuthorizedOutput, fullOutputText, searchOutputRows} = await import('../apps/web/src/workbench-window');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    const identity = {logicalOwner: owner, sourceId: 'tool-output-a', sourceRevision: 'revision-a'};
    const texts = Array.from({length: 100_000}, (_, index) => `Output line ${index}`);
    for (const scrollTop of [0, 400_000, 800_007, 1_999_999])
      expect(windowWorkbenchItems(texts, {scrollTop, viewportHeight: 800, rowHeight: 20, overscan: 12}).items.length).toBeLessThanOrEqual(300);
    const rows = texts.map((text, index) => ({id: `line:${index}`, text}));
    const readFull = async () => ({identity, rows, complete: true as const, trailingNewline: true});
    const copy = await readAuthorizedOutput(identity, readFull);
    expect(copy.rows).toHaveLength(100_000);
    expect(fullOutputText(copy).endsWith('Output line 99999\n')).toBe(true);
    const searched = await readAuthorizedOutput(identity, readFull);
    expect(searchOutputRows(searched, 'line 42424')).toEqual([{itemId: 'line:42424', index: 42424, offset: 7}]);
  });
  it('retains draft and source metadata across a module reload', async () => {
    installStorage();
    const journal = await import('../apps/web/src/journal');
    let recovery = await import('../apps/web/src/workbench-recovery');
    const owner = {threadId: 'thread-a', projectId: null, workspaceId: null};
    await journal.journalWrite('draft:thread-a', 'Survives reload');
    await recovery.updateSourceDraft(owner, state => ({...state, sourceRefs: [sourceRef(owner)]}));
    vi.resetModules();
    recovery = await import('../apps/web/src/workbench-recovery');
    const draft = await recovery.composeDraftContext(owner);
    expect(draft.text).toBe('Survives reload');
    expect(draft.sourceRefs.map(ref => ref.captureId)).toEqual(['capture-a']);
  });
});
