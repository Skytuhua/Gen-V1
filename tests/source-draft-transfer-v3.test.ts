import {afterEach, describe, expect, it, vi} from 'vitest';
import type {JournalRecord} from '../apps/web/src/journal';
import type {SourceDraftState} from '../apps/web/src/workbench-recovery';

const logicalOwner = {threadId: 'thread-a', projectId: 'project-a', workspaceId: 'copy-a'};
const owner = {profileId: 'profile-a', accountId: 'account-a', threadId: 'thread-a', projectId: 'project-a', workingCopyId: 'copy-a'};
const sourceKey = 'source-context:thread-a:project-a:copy-a';
const context: SourceDraftState = {draftId: 'draft-a', logicalOwner, revision: 7, sendMode: 'AFTER_CURRENT', conflictState: 'NONE', sourceRefs: [{
  captureId: 'capture-a', keepCaptured: true, source: {kind: 'MESSAGE', sourceId: 'message-a', sourceRevision: 'revision-a', logicalOwner,
    contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T10:00:00.000Z', range: {encoding: 'UTF16', start: 1, end: 4, selectedTextDigest: 'b'.repeat(64)}},
}]};
const refs = {threads: [{id: 'thread-a'}], skills: [], userStates: [], requests: []};
const row = (key: string, value: unknown) => ({key, record: {value, generation: 'backup-generation', updatedAt: 1}});
const backup = (entries = [row('draft:thread-a', 'Imported prompt'), row(sourceKey, context)]) => JSON.stringify({app: 'generative-harness-drafts', version: 1, entries});

afterEach(() => {vi.unstubAllGlobals(); vi.resetModules();});

/** Only the IndexedDB/localStorage boundary is replaced. The journal owns CAS,
 * staging, transactions, subscriptions, and the values visible to consumers. */
function storage() {
  const rows = new Map<string, JournalRecord>(), staged = new Map<string, string>();
  const controls: {beforeGet?: (key: string, mode?: string) => void; beforePut?: (key: string) => void} = {};
  vi.stubGlobal('localStorage', {get length() {return staged.size;}, key: (index: number) => [...staged.keys()][index] ?? null,
    getItem: (key: string) => staged.get(key) ?? null, setItem: (key: string, value: string) => staged.set(key, value), removeItem: (key: string) => staged.delete(key)});
  const database = {transaction: (_name: string, mode?: string) => {
    let pending = 0, aborted = false;
    const writes = new Map<string, JournalRecord>();
    const request = <T,>(result: T) => {
      pending++;
      const item = {result, onsuccess: undefined as (() => void) | undefined};
      queueMicrotask(() => {item.onsuccess?.(); if (--pending === 0) queueMicrotask(() => {
        if (aborted) tx.onabort?.(); else {for (const [key, value] of writes) rows.set(key, value); tx.oncomplete?.();}
      });});
      return item;
    };
    const tx = {error: Error('Storage transaction aborted'), oncomplete: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined,
      abort: () => {aborted = true;}, objectStore: () => ({
        get: (key: string) => {controls.beforeGet?.(key, mode); return request(rows.get(key));},
        getAllKeys: () => request([...rows.keys()]), getAll: () => request([...rows.values()]),
        put: (value: JournalRecord, key: string) => {controls.beforePut?.(key); writes.set(key, value);},
      }),
    };
    return tx;
  }};
  vi.stubGlobal('indexedDB', {open: () => {const request = {result: database, onsuccess: undefined as (() => void) | undefined}; queueMicrotask(() => request.onsuccess?.()); return request;}});
  const put = (key: string, value: unknown) => rows.set(key, {value, generation: crypto.randomUUID(), updatedAt: Date.now()});
  return {rows, controls, put};
}

describe('M15 source-aware draft backups', () => {
  it('uses a new format version for source bundles so older clients cannot import their text alone', async () => {
    const local = storage(); local.put('draft:thread-a', 'Saved prompt');
    const {exportDraftTransfer} = await import('../apps/web/src/draft-transfer');
    expect(JSON.parse(await exportDraftTransfer(refs)).version).toBe(1);
    local.put(sourceKey, context);
    expect(JSON.parse(await exportDraftTransfer(refs)).version).toBe(2);
  });

  it('imports version two source bundles atomically while accepting legacy version one text backups', async () => {
    const local = storage();
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const value = JSON.parse(backup()); value.version = 2;
    expect((await importDraftTransfer(JSON.stringify(value), refs)).map(item => item.status)).toEqual(['imported', 'imported']);
    expect(local.rows.get(sourceKey)?.value).toEqual(context);
    const legacy = backup([row('draft:new', 'Legacy text')]);
    expect((await importDraftTransfer(legacy, refs))[0].status).toBe('imported');
    expect(local.rows.get('draft:new')?.value).toBe('Legacy text');
  });

  it('exports exact source identity and send mode alongside the single text owner', async () => {
    const local = storage(); local.put('draft:thread-a', 'Saved prompt'); local.put(sourceKey, context);
    const {exportDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const saved = JSON.parse(await exportDraftTransfer(refs));
    expect(saved.entries.find((entry: {key: string}) => entry.key === sourceKey)?.record.value).toEqual(context);
    expect(saved.entries.find((entry: {key: string}) => entry.key === 'draft:thread-a')?.record.value).toBe('Saved prompt');
    expect(saved.entries).toHaveLength(2);
  });

  it('exports a source-only draft with an explicit empty text record for atomic restoration', async () => {
    const local = storage(); local.put(sourceKey, context);
    const {exportDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const saved = JSON.parse(await exportDraftTransfer(refs));
    expect(saved.entries.find((entry: {key: string}) => entry.key === 'draft:thread-a')?.record.value).toBe('');
    expect(saved.entries.find((entry: {key: string}) => entry.key === sourceKey)?.record.value).toEqual(context);
    expect(local.rows.has('draft:thread-a')).toBe(false);
  });

  it('refuses to export a corrupt source companion as a deceptively complete text backup', async () => {
    const local = storage(); local.put('draft:thread-a', 'Keep prompt'); local.put(sourceKey, {...context, text: 'Second text owner'});
    const {exportDraftTransfer} = await import('../apps/web/src/draft-transfer');
    await expect(exportDraftTransfer(refs)).rejects.toThrow(/source/i);
    expect(local.rows.get('draft:thread-a')?.value).toBe('Keep prompt');
  });

  it.each([false, true])('imports text and its exact full-owner source metadata together (reverse order: %s)', async reverse => {
    const local = storage();
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const entries = [row('draft:thread-a', 'Imported prompt'), row(sourceKey, context)];
    const report = await importDraftTransfer(backup(reverse ? entries.reverse() : entries), refs);
    expect(report.map(item => item.status)).toEqual(['imported', 'imported']);
    expect(local.rows.get('draft:thread-a')?.value).toBe('Imported prompt');
    expect(local.rows.get(sourceKey)?.value).toEqual(context);
  });

  it.each([
    {key: 'source-context:thread-a:project-a:other-copy', value: context},
    {key: sourceKey, value: {...context, sourceRefs: [{...context.sourceRefs[0], source: {...context.sourceRefs[0].source, logicalOwner: {...logicalOwner, workspaceId: 'other-copy'}}}]}},
    {key: sourceKey, value: {...context, sourceRefs: Array.from({length: 9}, (_, i) => ({...context.sourceRefs[0], captureId: 'capture-' + i}))}},
    {key: sourceKey, value: {...context, grant: {token: 'private'}}},
  ])('blocks the entire text/source group when source identity or bounds are invalid', async bad => {
    const local = storage();
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const report = await importDraftTransfer(backup([row('draft:thread-a', 'Imported prompt'), row(bad.key, bad.value)]), refs);
    expect(report.every(item => item.status === 'blocked')).toBe(true);
    expect(local.rows.size).toBe(0);
  });

  it('blocks an unpaired source companion instead of attaching it to an unrelated local prompt', async () => {
    const local = storage(); local.put('draft:thread-a', 'Local prompt');
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    expect((await importDraftTransfer(backup([row(sourceKey, context)]), refs))[0].status).toBe('blocked');
    expect(local.rows.get('draft:thread-a')?.value).toBe('Local prompt'); expect(local.rows.has(sourceKey)).toBe(false);
  });

  it.each([true, false])('retains local orphan source context when importing a prompt (source in backup: %s)', async withSource => {
    const local = storage(); local.put(sourceKey, {...context, revision: 99});
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const report = await importDraftTransfer(backup(withSource ? undefined : [row('draft:thread-a', 'Imported prompt')]), refs);
    expect(report.every(item => item.status === 'retained')).toBe(true);
    expect(local.rows.has('draft:thread-a')).toBe(false); expect(local.rows.get(sourceKey)?.value).toMatchObject({revision: 99});
  });

  it('keeps both imported records absent when source context arrives in another window during CAS', async () => {
    const local = storage();
    local.controls.beforeGet = (key, mode) => {if (key === sourceKey && mode === 'readwrite') {local.controls.beforeGet = undefined; local.put(sourceKey, {...context, revision: 99});}};
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    const report = await importDraftTransfer(backup(), refs);
    expect(report.every(item => item.status === 'retained')).toBe(true);
    expect(local.rows.has('draft:thread-a')).toBe(false); expect(local.rows.get(sourceKey)?.value).toMatchObject({revision: 99});
  });

  it('rolls back imported text when the source metadata write fails', async () => {
    const local = storage(); local.controls.beforePut = key => {if (key === sourceKey) throw Error('Source context quota exhausted');};
    const {importDraftTransfer} = await import('../apps/web/src/draft-transfer');
    await expect(importDraftTransfer(backup(), refs)).rejects.toThrow(/quota/);
    expect(local.rows.size).toBe(0);
  });
});

describe('M15 source-aware named drafts', () => {
  it('saves bounded source identity and send mode while retaining the active source selection', async () => {
    const local = storage(); local.put('draft:thread-a', 'Save prompt'); local.put(sourceKey, context);
    const {saveNamedDraft, loadSavedDrafts} = await import('../apps/web/src/saved-drafts');
    const saved = await saveNamedDraft(owner, 'Review sources');
    expect(saved.sourceContext).toEqual(context);
    expect((await loadSavedDrafts(owner)).library.records[0].sourceContext).toEqual(context);
    expect(local.rows.get(sourceKey)?.value).toEqual(context);
  });

  it('keeps a source-only named draft inspectable after the active selection is gone', async () => {
    const local = storage(); local.put(sourceKey, context);
    const {saveNamedDraft, loadSavedDrafts} = await import('../apps/web/src/saved-drafts');
    const saved = await saveNamedDraft(owner, 'Source only');
    const {journalWrite} = await import('../apps/web/src/journal'); await journalWrite(sourceKey, {...context, sourceRefs: []});
    expect(saved.text).toBe(''); expect((await loadSavedDrafts(owner)).library.records[0].sourceContext?.sourceRefs).toEqual(context.sourceRefs);
  });

  it('rejects a named save when another window changes its source selection before the commit', async () => {
    const local = storage(); local.put('draft:thread-a', 'Save prompt'); local.put(sourceKey, context);
    local.controls.beforeGet = (key, mode) => {if (key === sourceKey && mode === 'readwrite') {local.controls.beforeGet = undefined; local.put(sourceKey, {...context, revision: 99});}};
    const {saveNamedDraft, savedDraftLibraryKey} = await import('../apps/web/src/saved-drafts');
    await expect(saveNamedDraft(owner, 'Racing save')).rejects.toThrow(/changed/);
    expect(local.rows.has(savedDraftLibraryKey(owner))).toBe(false);
    expect(local.rows.get('draft:thread-a')?.value).toBe('Save prompt');
  });

  it('rejects foreign-owner, oversized and extra source fields in saved metadata', async () => {
    storage();
    const {createSavedDraft, readSavedDraftLibrary} = await import('../apps/web/src/saved-drafts');
    const good = createSavedDraft(owner, 'Valid', 'Prompt', {sourceContext: context});
    for (const bad of [
      {...context, text: 'Second text owner'}, {...context, secret: 'private'},
      {...context, logicalOwner: {...logicalOwner, workspaceId: 'other-copy'}, sourceRefs: []},
      {...context, sourceRefs: Array.from({length: 9}, (_, i) => ({...context.sourceRefs[0], captureId: 'capture-' + i}))},
    ]) expect(() => readSavedDraftLibrary({version: 1, owner, records: [{...good, sourceContext: bad}]}, owner)).toThrow();
    expect(good.sourceContext?.sourceRefs).toEqual(context.sourceRefs);
  });

  it('text-only replacement retains active sources and stores their identity with the recovery copy', async () => {
    const local = storage(); local.put('draft:thread-a', 'Saved prompt'); local.put(sourceKey, context);
    const saved = await import('../apps/web/src/saved-drafts');
    const record = await saved.saveNamedDraft(owner, 'Restore prompt');
    const journal = await import('../apps/web/src/journal');
    const current = {...context, revision: 8, sendMode: 'NOW' as const, sourceRefs: [{...context.sourceRefs[0], captureId: 'capture-current'}]};
    await journal.journalWrite('draft:thread-a', 'Current prompt'); await journal.journalWrite(sourceKey, current);
    const plan = await saved.planDraftRestore(owner, record.id);
    await saved.restoreSavedDraftText(owner, plan, 'replace', 0);
    expect(local.rows.get('draft:thread-a')?.value).toBe('Saved prompt'); expect(local.rows.get(sourceKey)?.value).toEqual(current);
    const recovery = (await saved.loadSavedDrafts(owner)).library.records.find(item => item.name.startsWith('Before replacing'));
    expect(recovery?.text).toBe('Current prompt'); expect(recovery?.sourceContext).toEqual(current);
  });
});
