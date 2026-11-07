import {beforeEach, expect, it, vi} from 'vitest';
import {createSharedAgentComposers} from '../apps/web/src/agents-workspace/composer';
import type {AgentSummary} from '../packages/contracts/agent-inventory';
import type {AgentInputTicket} from '../packages/contracts/agent-input';
import {ApiError} from '../apps/web/src/api';
const ticket: AgentInputTicket = {id: 'ticket', messageId: 'message', parentThreadId: 'parent', jobId: 'job', parentRun: {runId: 'pr', epoch: 1}, childRun: {threadId: 'child', runId: 'cr', epoch: 1}, status: 'queued', createdAt: '', updatedAt: ''};
const agent = (id: string, patch: Partial<AgentSummary> = {}): AgentSummary => ({agentId: id, parentId: null, rootId: id, jobId: null, threadId: id, projectId: 'p', projectName: 'Project', title: id, status: 'working', modelId: 'model', currentAction: null, reportedPercent: null, createdAt: '', updatedAt: '', orderKey: id, revision: 1, archived: false, readOnly: false, metadata: 'thread', ...patch});

const records = vi.hoisted(() => new Map<string, {value: unknown; generation: string}>());
const writes = vi.hoisted(() => ({pause: undefined as Promise<void> | undefined}));
vi.mock('../apps/web/src/journal', () => ({
 journalReadRecord: async (key: string) => records.get(key),
 journalWrite: async (key: string, value: unknown) => {if (key.startsWith('agents-pending:') && writes.pause) await writes.pause; const generation = crypto.randomUUID(); records.set(key, {value, generation}); return generation;},
 journalGeneration: (key: string) => records.get(key)?.generation,
 journalSubscribe: () => () => {},
 journalCompareAndSwap: async (key: string, generation: string, value: unknown) => {if (records.get(key)?.generation !== generation) return false; records.set(key, {value, generation: crypto.randomUUID()}); return true;},
}));
beforeEach(() => {records.clear(); writes.pause = undefined;});
const binding = (id = crypto.randomUUID()): import('../apps/web/src/composer-commands').SkillBinding => ({id, name: 'Selected procedure', source: 'Personal', ref: {version: 1, scope: {kind: 'personal'}, sourceId: 'personal:test', skillId: 'procedure', locator: 'a'.repeat(64), revision: 'b'.repeat(64), digest: 'c'.repeat(64), sourceBinding: 'd'.repeat(64)}});
it('shares and recovers bound skills with the real conversation owner, independent of literal text', async () => {
 const selected = binding(), a = agent('a'), conversation = {kind: 'conversation' as const, threadId: 'a', modelId: 'model', working: false};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: async () => {}});
 await owner.prepare(a); await owner.addSkill(a, selected); await owner.edit(a, '/skill:unbound');
 expect(owner.getSnapshot(conversation).skills).toEqual([selected]); owner.dispose();
 const restored = createSharedAgentComposers({sendParent: async () => {}, stopParent: async () => {}});
 await restored.prepare(conversation); expect(restored.getSnapshot(a).skills).toEqual([selected]);
 await restored.removeSkill(a, selected.id); expect(restored.getSnapshot(conversation).skills).toEqual([]); restored.dispose();
});
it('pins uncertain-send skill references and removes accepted selections while keeping new selections and later text', async () => {
 const first = binding(), second = binding(), a = agent('a');
 const send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').ParentSend): Promise<void> => {throw Error('Uncertain');});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await owner.prepare(a); await owner.edit(a, 'Original'); await owner.addSkill(a, first); await owner.submit(a);
 expect(send.mock.calls[0][0]).toMatchObject({content: 'Original', skills: [first.ref]});
 await owner.edit(a, 'Later'); await owner.addSkill(a, second); send.mockImplementation(async () => {}); await owner.submit(a);
 expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
 expect(owner.getSnapshot(a)).toMatchObject({draft: 'Later', skills: [second], retry: false}); owner.dispose();
});
it('restores the original bound pending send rather than replacing it from current selections', async () => {
 const a = agent('a'), first = binding(), later = binding();
 const firstOwner = createSharedAgentComposers({sendParent: async () => {throw Error('Disconnected');}, stopParent: async () => {}});
 await firstOwner.prepare(a); await firstOwner.edit(a, 'First'); await firstOwner.addSkill(a, first); await firstOwner.submit(a);
 await firstOwner.removeSkill(a, first.id); await firstOwner.addSkill(a, later); firstOwner.dispose();
 const send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').ParentSend) => {});
 const restored = createSharedAgentComposers({sendParent: send, stopParent: async () => {}}); await restored.prepare(a); await restored.submit(a);
 expect(send.mock.calls[0][0].skills).toEqual([first.ref]); expect(restored.getSnapshot(a).skills).toEqual([later]); restored.dispose();
});
it('never promotes child follow-up into pinned Personal skill admission', async () => {
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: async () => {}, followUp: {canSend: () => true, send: async () => ticket, subscribe: () => () => {}}});
 const child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true}); await owner.prepare(child);
 await expect(owner.addSkill(child, binding())).rejects.toThrow(/parent conversation/i); owner.dispose();
});
it('uses the text and binding snapshot captured before async new-thread preparation', async () => {
 const a = agent('new-thread'), first = binding(), later = binding(), send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').ParentSend) => {});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 await owner.prepare(a); await owner.edit(a, 'Later text'); await owner.addSkill(a, first); await owner.addSkill(a, later);
 await owner.submit(a, {submission: {content: 'Captured text', generation: 'old-generation', skills: [first]}});
 expect(send.mock.calls[0][0]).toMatchObject({content: 'Captured text', skills: [first.ref]});
 expect(owner.getSnapshot(a)).toMatchObject({draft: 'Later text', skills: [later]}); owner.dispose();
});
it('allows removing or reselecting a pin after an explicit host rejection before any send was accepted', async () => {
 const a = agent('a'), selected = binding(), send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').ParentSend): Promise<void> => {throw new ApiError('SKILL_ADMISSION_UNAVAILABLE','Select again',{sendAccepted:false});});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}}); await owner.prepare(a); await owner.edit(a,'Keep the draft'); await owner.addSkill(a,selected); await owner.submit(a);
 expect(owner.getSnapshot(a)).toMatchObject({draft:'Keep the draft',skills:[selected],retry:false});
 await owner.removeSkill(a,selected.id);send.mockImplementation(async()=>{});await owner.submit(a);
 expect(send.mock.calls[1][0].skills).toBeUndefined();expect(send.mock.calls[1][0].commandId).not.toBe(send.mock.calls[0][0].commandId);owner.dispose();
});
it('shares an ordinary conversation owner with its agent column without manufacturing inventory', async () => {
 const sends = vi.fn(async (_input: unknown): Promise<void> => {throw Error('Connection lost');});
 const owner = createSharedAgentComposers({sendParent: sends, stopParent: async () => {}});
 const conversation = {kind: 'conversation' as const, threadId: 'a', modelId: 'first-model', working: false};
 const column = agent('a');
 await owner.prepare(conversation); await owner.edit(conversation, 'Original');
 expect(owner.getSnapshot(column)).toBe(owner.getSnapshot(conversation));
 await owner.submit(conversation, {thinkingLevel: 'high'});
 const first = sends.mock.calls[0][0];
 expect(first).toMatchObject({threadId: 'a', modelId: 'first-model', thinkingLevel: 'high', content: 'Original'});
 await owner.edit(column, 'Later edit'); sends.mockImplementation(async () => {});
 await owner.submit({...column, modelId: 'changed-model'});
 expect(sends.mock.calls[1][0]).toEqual(first);
 expect(owner.getSnapshot(conversation).draft).toBe('Later edit'); owner.dispose();
});
it('blocks a nested child while its canonical parent is stopped from the ordinary conversation', async () => {
 let finish!: () => void;
 const followUp = {canSend: () => true, send: async () => ticket, subscribe: () => () => {}};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: () => new Promise<void>(resolve => {finish = resolve;}), followUp});
 const parent = agent('thread:parent', {threadId: 'parent', rootId: 'thread:parent'});
 const conversation = {kind: 'conversation' as const, threadId: 'parent', modelId: 'model', working: true};
 const child = agent('job:parent:child', {threadId: 'child', parentId: parent.agentId, rootId: parent.agentId, jobId: 'job', readOnly: true});
 await owner.prepare(parent); await owner.prepare(conversation); await owner.prepare(child);
 const stopping = owner.stop(conversation);
 expect(owner.canSend(child)).toBe(false);
 finish(); await stopping; owner.dispose();
});
it('clears the old uncertain delivery warning when the same ticket is confirmed handled', async () => {
 let notify!: (id: string, current: AgentInputTicket) => void;
 const followUp = {canSend: () => true, send: async () => ({...ticket, status: 'delivery_uncertain' as const}), subscribe: (listener: typeof notify) => {notify = listener; return () => {};}};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: async () => {}, followUp}), child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true});
 await owner.prepare(child); await owner.edit(child, 'Durable follow-up'); await owner.submit(child);
 expect(owner.getSnapshot(child).error).toContain('uncertain');
 notify(child.agentId, {...ticket, status: 'handled'});
 expect(owner.getSnapshot(child).ticket?.status).toBe('handled');
 expect(owner.getSnapshot(child).error).toBe(''); owner.dispose();
});
it('shares one draft and pending send, retains later text and reuses an uncertain command id', async () => {
 let resolve!: () => void; const send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').ParentSend): Promise<void> => {await new Promise<void>(r => {resolve = r;}); throw Error('Connection lost');});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}}), a = agent('a');
 await owner.prepare(a); await owner.edit(a, 'First'); const sending = owner.submit(a); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
 await owner.submit(a); expect(send).toHaveBeenCalledTimes(1); await owner.edit(a, 'Later'); resolve(); await sending;
 expect(owner.getSnapshot(a).draft).toBe('Later'); expect(owner.getSnapshot(a).error).toContain('Connection lost');
 send.mockImplementation(async () => {}); await owner.submit(a);
 expect(send.mock.calls[0][0].commandId).toBe(send.mock.calls[1][0].commandId);
 expect(send.mock.calls[1][0].content).toBe('First'); expect(owner.getSnapshot(a).draft).toBe('Later'); owner.dispose();
});
it('does not manufacture child send capability or revive completed children', async () => {
 const send = vi.fn(async () => {}), owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}});
 const child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true});
 await owner.prepare(child); await owner.edit(child, 'Keep'); await owner.submit(child);
 expect(send).not.toHaveBeenCalled(); expect(owner.canSend(child)).toBe(false); owner.dispose();
});
it('shows only actual child tickets from the injected parent controller and locks Send during Stop', async () => {
 let finish!: () => void; const stop = vi.fn(() => new Promise<void>(r => {finish = r;}));
 const followUp = {canSend: () => true, send: vi.fn(async () => ticket), subscribe: () => () => {}};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: stop, followUp}), child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true}), parent = agent('parent');
 await owner.prepare(child); await owner.edit(child, 'Follow up'); await owner.submit(child);
 expect(owner.getSnapshot(child).ticket).toEqual(ticket);
 expect(owner.canSend({...child, status: 'completed'})).toBe(false);
 await owner.prepare(parent); await owner.edit(parent, 'Wait'); const stopping = owner.stop(parent); expect(owner.canSend(parent)).toBe(false); finish(); await stopping; owner.dispose();
});
it('Stop prevents a not-yet-dispatched parent send and locks its child composer', async () => {
 let release!: () => void, finishStop!: () => void; const send = vi.fn(async () => {});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: () => new Promise<void>(resolve => {finishStop = resolve;}), followUp: {canSend: () => true, send: async () => ticket, subscribe: () => () => {}}});
 const parent = agent('parent'), child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true});
 await owner.prepare(parent); await owner.prepare(child); await owner.edit(parent, 'Saved before Stop');
 writes.pause = new Promise<void>(resolve => {release = resolve;}); const sending = owner.submit(parent); const stopping = owner.stop(parent);
 expect(owner.canSend(child)).toBe(false); finishStop(); await stopping; release(); await sending;
 expect(send).not.toHaveBeenCalled(); expect(owner.getSnapshot(parent).draft).toBe('Saved before Stop'); owner.dispose();
});
it('parent Stop fences an already queued child before journal persistence releases transport', async () => {
 let release!: () => void, finish!: () => void;
 const followUp = {canSend: () => true, send: vi.fn(async () => ticket), subscribe: () => () => {}};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: () => new Promise<void>(resolve => {finish = resolve;}), followUp});
 const parent = agent('parent'), child = agent('child', {parentId: parent.agentId, rootId: parent.agentId, jobId: 'job', readOnly: true});
 await owner.prepare(parent); await owner.prepare(child); await owner.edit(child, 'Retain this child input');
 writes.pause = new Promise<void>(resolve => {release = resolve;});
 const sending = owner.submit(child), stopping = owner.stop(parent);
 try {
  expect(owner.canSend(child)).toBe(false); release(); await sending;
  expect(followUp.send).not.toHaveBeenCalled(); expect(owner.getSnapshot(child).draft).toBe('Retain this child input'); expect(owner.getSnapshot(child).retry).toBe(true);
 } finally {release(); finish(); await stopping; owner.dispose();}
});

it('captures journaled reasoning before a column sends and retains it on retry', async () => {
 records.set('thinking:parent', {value: 'high', generation: 'reasoning-1'});
 const send = vi.fn(async (_input: unknown): Promise<void> => {throw Error('Uncertain delivery');});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}}), parent = agent('parent');
 await owner.prepare(parent); await owner.edit(parent, 'Use the chosen reasoning'); await owner.submit(parent);
 expect(send).toHaveBeenCalledWith(expect.objectContaining({thinkingLevel: 'high'}));
 const command = send.mock.calls[0][0]; records.set('thinking:parent', {value: 'low', generation: 'reasoning-2'});
 await owner.submit(parent); expect(send.mock.calls[1][0]).toEqual(command); owner.dispose();
});

import {AgentFollowUpSchema} from '../packages/contracts/agent-input';

it('review: a locally rejected over-limit child draft can be corrected and sent', async () => {
 const transported:string[]=[];
 const followUp={canSend:()=>true,subscribe:()=>()=>{},send:async ({content}:{content:string})=>{
  AgentFollowUpSchema.parse({jobId:'job', parentRun:ticket.parentRun,childRun:ticket.childRun,content});
  transported.push(content);return ticket;
 }};
 const owner=createSharedAgentComposers({sendParent:async()=>{},stopParent:async()=>{},followUp});
 const child=agent('child',{parentId:'parent',rootId:'parent',jobId:'job',readOnly:true});
 try {
  await owner.prepare(child);await owner.edit(child,'x'.repeat(32769));await owner.submit(child);
  expect(transported).toEqual([]);expect(owner.getSnapshot(child).retry).toBe(false);
  expect(records.has("agents-pending:child")).toBe(false);
  await owner.edit(child,'Corrected valid follow-up');await owner.submit(child);
  expect(transported).toEqual(['Corrected valid follow-up']);
 } finally {owner.dispose();}
});


it('retires a recovered schema-invalid child pending identity while retaining corrected draft text', async () => {
 const child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true});
 records.set('agents-pending:child', {value: {commandId: 'invalid-old', content: 'x'.repeat(32769), generation: 'old'}, generation: 'pending'});
 records.set('draft:child', {value: 'Corrected after reload', generation: 'corrected'});
 const followUp = {canSend: () => true, subscribe: () => () => {}, send: vi.fn(async () => ticket)};
 const owner = createSharedAgentComposers({sendParent: async () => {}, stopParent: async () => {}, followUp});
 await owner.prepare(child); await owner.submit(child);
 expect(followUp.send).not.toHaveBeenCalled(); expect(owner.getSnapshot(child)).toMatchObject({retry: false, draft: 'Corrected after reload'});
 await owner.submit(child); expect(followUp.send).toHaveBeenCalledWith(expect.objectContaining({content: 'Corrected after reload', commandId: expect.not.stringMatching('invalid-old')})); owner.dispose();
});

it('validates child UTF-8 byte bounds before persisting identity and preserves uncertain valid intent across remount', async () => {
 const child = agent('child', {parentId: 'parent', rootId: 'parent', jobId: 'job', readOnly: true});
 const followUp = {canSend: () => true, subscribe: () => () => {}, send: vi.fn(async (_input: unknown): Promise<AgentInputTicket> => {throw Error('Lost receipt');})};
 const actions = {sendParent: async () => {}, stopParent: async () => {}, followUp};
 let owner = createSharedAgentComposers(actions); await owner.prepare(child);
 await owner.edit(child, '界'.repeat(22000)); await owner.submit(child);
 expect(records.has('agents-pending:child')).toBe(false); expect(followUp.send).not.toHaveBeenCalled();
 await owner.edit(child, 'Original valid intent'); await owner.submit(child); const first = followUp.send.mock.calls[0][0] as {content: string; commandId: string};
 await owner.edit(child, 'Later edited text'); owner.dispose(); owner = createSharedAgentComposers(actions); await owner.prepare(child);
 followUp.send.mockResolvedValue(ticket); await owner.submit(child);
 expect(followUp.send.mock.calls[1][0]).toMatchObject({content: first.content, commandId: first.commandId});
 expect(owner.getSnapshot(child).draft).toBe('Later edited text'); owner.dispose();
});

it('fences detached and pending owners, including stale send callbacks released after journal persistence', async () => {
 let ownership: number | undefined = 1, release!: () => void;
 const send = vi.fn(async () => {}), stop = vi.fn(async () => {});
 const owner = createSharedAgentComposers({sendParent: send, stopParent: stop, ownership: () => ownership}), parent = agent('parent');
 await owner.prepare(parent); await owner.edit(parent, 'Retain for the owning window');
 ownership = undefined; await owner.submit(parent); await owner.stop(parent);
 expect(send).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(owner.canSend(parent)).toBe(false);
 ownership = 2; writes.pause = new Promise<void>(resolve => {release = resolve;}); const sending = owner.submit(parent);
 ownership = undefined; release(); await sending; expect(send).not.toHaveBeenCalled();
 expect(owner.getSnapshot(parent)).toMatchObject({draft: 'Retain for the owning window', retry: true});
 ownership = 3; writes.pause = undefined; await owner.submit(parent); expect(send).toHaveBeenCalledTimes(1); owner.dispose();
});

it('fences an ownership roundtrip even when the original window becomes editable again before dispatch', async () => {
 let ownership = 1, release!: () => void;
 const send = vi.fn(async () => {}), owner = createSharedAgentComposers({sendParent: send, stopParent: async () => {}, ownership: () => ownership}), parent = agent('parent');
 await owner.prepare(parent); await owner.edit(parent, 'Do not dispatch a stale action');
 writes.pause = new Promise<void>(resolve => {release = resolve;}); const sending = owner.submit(parent);
 ownership = 3; release(); await sending; expect(send).not.toHaveBeenCalled(); expect(owner.getSnapshot(parent).retry).toBe(true); owner.dispose();
});
