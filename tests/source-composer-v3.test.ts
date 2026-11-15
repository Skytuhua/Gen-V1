import {beforeEach, expect, it, vi} from 'vitest';
import {createSharedAgentComposers, type ConversationComposerTarget, type ParentSend} from '../apps/web/src/agents-workspace/composer';
import {readSourceDraft, updateSourceDraft} from '../apps/web/src/workbench-recovery';
import type {LogicalOwnerV1, SourceRefV1} from '../packages/contracts/source-selection';
const records = vi.hoisted(() => new Map<string, {value: unknown; generation: string}>());
vi.mock('../apps/web/src/journal', () => ({
 journalEntries: async () => [...records].map(([key,record])=>({key,record})),
 journalReadRecord: async (key: string) => records.get(key),
 journalWrite: async (key: string, value: unknown) => {const generation = crypto.randomUUID(); records.set(key, {value, generation}); return generation;},
 journalGeneration: (key: string) => records.get(key)?.generation,
 journalSubscribe: () => () => {}, journalFlush: async () => {},
 journalCompareAndSwap: async (key: string, generation: string | undefined, value: unknown) => {if (records.get(key)?.generation !== generation) return false; records.set(key, {value, generation: crypto.randomUUID()}); return true;},
 journalCompareAndSwapMany: async (changes:{key:string;generation:string|undefined;value:unknown}[]) => {if(changes.some(change=>records.get(change.key)?.generation!==change.generation))return false;for(const change of changes)records.set(change.key,{value:change.value,generation:crypto.randomUUID()});return true;},
}));
const logicalOwner: LogicalOwnerV1 = {threadId: 'task', projectId: 'project', workspaceId: 'workspace'};
const target = {...logicalOwner, kind: 'conversation', modelId: 'model', working: false} as ConversationComposerTarget;
const source = (id: string): SourceRefV1 => ({captureId: id, keepCaptured: false, source: {kind: 'MESSAGE', sourceId: 'message', logicalOwner, sourceRevision: 'a'.repeat(64), contentDigest: 'a'.repeat(64), capturedAt: '2026-11-15T00:00:00.000Z', range: {encoding: 'UTF16', start: 0, end: 4, selectedTextDigest: 'b'.repeat(64)}}});
beforeEach(() => records.clear());
it('sends host source references and mode through the existing parent transport and clears only accepted metadata', async () => {
 const send = vi.fn(async (_input: ParentSend) => {}), composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await composer.prepare(target); await composer.edit(target, 'Explain');
 await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('first')], sendMode: 'AFTER_CURRENT'}));
 await composer.submit(target,{sourceContextVisible:true});
 expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0]).toMatchObject({content: 'Explain', sourceRefs: [source('first')], sendMode: 'AFTER_CURRENT'});
 expect((await readSourceDraft(logicalOwner)).sourceRefs).toEqual([]); composer.dispose();
});
it('pins exact source custody and command identity through uncertain delivery, reload and later edits', async () => {
 const send = vi.fn(async (_input: ParentSend):Promise<void> => {throw Error('Disconnected');});
 let composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await composer.prepare(target); await composer.edit(target, 'Original');
 await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('first')]}));
 await composer.submit(target,{sourceContextVisible:true}); const original = send.mock.calls[0][0];
 await composer.edit(target, 'Later'); await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('later')], sendMode: 'AFTER_CURRENT'}));
 composer.dispose(); send.mockImplementation(async () => {});
 composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}}); await composer.prepare(target); await composer.submit(target,{sourceContextVisible:true});
 expect(send.mock.calls[1][0]).toEqual(original);
 expect(composer.getSnapshot(target).draft).toBe('Later'); expect((await readSourceDraft(logicalOwner)).sourceRefs).toEqual([source('later')]); composer.dispose();
});
it('does not leak old source metadata into a replaced workspace and preserves the old record', async () => {
 await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('first')]}));
 const send = vi.fn(async (_input: ParentSend) => {}), composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 const replacement = {...target, workspaceId: 'replacement'}; await composer.prepare(replacement); await composer.edit(replacement, 'Explain'); await composer.submit(replacement,{sourceContextVisible:true});
 expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0]).not.toHaveProperty('sourceRefs');
 expect((await readSourceDraft(logicalOwner)).sourceRefs).toHaveLength(1); composer.dispose();
});
it('refuses a pending source send after workspace replacement', async () => {
 const send = vi.fn(async (_input: ParentSend) => {throw Error('Disconnected');}), composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await composer.prepare(target); await composer.edit(target, 'Original'); await updateSourceDraft(logicalOwner, state => ({...state, sourceRefs: [source('first')]})); await composer.submit(target,{sourceContextVisible:true});
 send.mockClear(); await composer.submit({...target, workspaceId: 'replacement'},{sourceContextVisible:true}); expect(send).not.toHaveBeenCalled(); expect(composer.getSnapshot(target).retry).toBe(true); composer.dispose();
});
it('leaves ordinary sends unchanged when no source context has been authored', async () => {
 const send = vi.fn(async (_input: ParentSend) => {}), composer = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await composer.prepare(target); await composer.edit(target, 'Ordinary'); await composer.submit(target,{sourceContextVisible:true});
 expect(send.mock.calls[0][0]).not.toHaveProperty('sourceRefs'); expect(send.mock.calls[0][0]).not.toHaveProperty('sendMode'); composer.dispose();
});

it('blocks invisible source context in an unintegrated composer surface',async()=>{
 const send=vi.fn(async(_input:ParentSend)=>{}),composer=createSharedAgentComposers({sendParent:send,stopParent:async()=>{}});
 await composer.prepare(target);await composer.edit(target,'Explain');await updateSourceDraft(logicalOwner,state=>({...state,sourceRefs:[source('hidden')]}));await composer.submit(target);
 expect(send).not.toHaveBeenCalled();expect(composer.getSnapshot(target).error).toContain('source-aware composer');expect((await readSourceDraft(logicalOwner)).sourceRefs).toHaveLength(1);composer.dispose();
});

it('blocks unscoped surfaces that cannot identify an existing source working copy',async()=>{
 const send=vi.fn(async(_input:ParentSend)=>{}),composer=createSharedAgentComposers({sendParent:send,stopParent:async()=>{}});
 await composer.prepare(target);await composer.edit(target,'Explain');await updateSourceDraft(logicalOwner,state=>({...state,sourceRefs:[source('scoped')]}));await composer.submit({...target,workspaceId:undefined});
 expect(send).not.toHaveBeenCalled();expect(composer.getSnapshot(target).error).toContain('source-aware composer');composer.dispose();
});
