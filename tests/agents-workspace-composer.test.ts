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
it('shares one draft and pending send, retains later text and reuses an uncertain command id', async () => {
 let resolve!: () => void; const send = vi.fn(async (_input: import('../apps/web/src/agents-workspace/composer').AgentSend): Promise<void> => {await new Promise<void>(r => {resolve = r;}); throw Error('Connection lost');});
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
