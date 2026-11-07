import {beforeEach, expect, it, vi} from 'vitest';
import {createSharedAgentComposers} from '../apps/web/src/agents-workspace/composer';
import type {AgentSummary} from '../packages/contracts/agent-inventory';
import type {AgentInputTicket} from '../packages/contracts/agent-input';
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
