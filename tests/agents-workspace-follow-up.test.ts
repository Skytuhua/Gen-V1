import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {AgentSummary} from '../packages/contracts/agent-inventory';
import type {AgentFollowUpTarget, AgentInputTicket} from '../packages/contracts/agent-input';
import {createPersonalChildFollowUp} from '../apps/web/src/agents-workspace/follow-up';
const mocks = vi.hoisted(() => ({target: vi.fn(), send: vi.fn(), ticket: vi.fn(), records: new Map<string, unknown>()}));
vi.mock('../apps/web/src/agent-input-api', () => ({getAgentFollowUpTarget: mocks.target, sendAgentFollowUp: mocks.send, getAgentInputTicket: mocks.ticket}));
vi.mock('../apps/web/src/journal', () => ({journalReadRecord: async (key: string) => mocks.records.has(key) ? {value: mocks.records.get(key)} : undefined, journalWrite: async (key: string, value: unknown) => {mocks.records.set(key, value);}}));
const child = {agentId: 'job:parent:job', parentId: 'thread:parent', rootId: 'thread:parent', jobId: 'job', threadId: 'child', status: 'working', revision: 1} as AgentSummary;
const target: AgentFollowUpTarget = {authority: 'personal', parentThreadId: 'parent', jobId: 'job', parentRun: {runId: 'parent-run', epoch: 1}, childRun: {threadId: 'child', runId: 'child-run', epoch: 2}};
const ticket: AgentInputTicket = {...target, id: 'id', messageId: 'message', status: 'processing', createdAt: '', updatedAt: ''};
const adapters: ReturnType<typeof createPersonalChildFollowUp>[] = [];
beforeEach(() => {vi.clearAllMocks(); mocks.records.clear(); mocks.target.mockResolvedValue(target); mocks.send.mockResolvedValue({result: {ticketId: 'id', status: 'queued'}}); mocks.ticket.mockResolvedValue(ticket);});
afterEach(() => {adapters.splice(0).forEach(adapter => adapter.dispose?.());});
function adapter() {const value = createPersonalChildFollowUp(() => 'parent'); adapters.push(value); return value;}
it('reconciles a recovered uncertain ticket when the host later confirms its answer without sending again', async () => {
 const value = adapter(), listener = vi.fn(); value.subscribe(listener);
 mocks.ticket.mockResolvedValue({...ticket, status: 'handled'});
 value.track!(child, {...ticket, status: 'delivery_uncertain'});
 await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(child.agentId, expect.objectContaining({status: 'handled'})));
 expect(mocks.ticket).toHaveBeenCalledWith('parent', 'id', expect.any(AbortSignal)); expect(mocks.send).not.toHaveBeenCalled();
});
it('reads the exact target and current ticket, never reports immutable queued admission as current', async () => {
 const value = adapter(); expect(value.canSend(child)).toBe(false); await value.prepare!(child); expect(value.canSend(child)).toBe(true);
 const current = await value.send({agent: child, content: 'Follow up', commandId: 'stable-id'});
 expect(current.status).toBe('processing'); expect(mocks.ticket).toHaveBeenCalledWith('parent', 'id', expect.any(AbortSignal));
 expect(mocks.send).toHaveBeenCalledWith('parent', {jobId: 'job', parentRun: target.parentRun, childRun: target.childRun, content: 'Follow up'}, 'stable-id');
});
it('pins the original run across failed HTTP delivery, reload and a replacement target', async () => {
 const first = adapter(); await first.prepare!(child); mocks.send.mockRejectedValueOnce(Error('lost'));
 await expect(first.send({agent: child, content: 'First', commandId: 'same-id'})).rejects.toThrow('lost');
 first.dispose?.(); const next = adapter(); mocks.target.mockResolvedValue({...target, childRun: {...target.childRun, runId: 'replacement'}}); await next.prepare!({...child, revision: 2});
 await next.send({agent: child, content: 'First', commandId: 'same-id'});
 expect(mocks.send.mock.calls.map(call => [call[1].childRun.runId, call[2]])).toEqual([['child-run', 'same-id'], ['child-run', 'same-id']]);
});
it('uses published terminal and uncertain statuses without automatic sends, and denies settled children', async () => {
 const value = adapter(); await value.prepare!(child); mocks.ticket.mockResolvedValue({...ticket, status: 'delivery_uncertain'});
 expect((await value.send({agent: child, content: 'First', commandId: 'id'})).status).toBe('delivery_uncertain');
 expect(mocks.send).toHaveBeenCalledTimes(1); expect(value.canSend({...child, status: 'completed'})).toBe(false);
 await value.prepare!({...child, status: 'completed'}); expect(value.canSend(child)).toBe(false);
});
it('rejects wrong parent/linkage and oversized follow-up text before transport', async () => {
 const value = adapter(); mocks.target.mockResolvedValue({...target, parentThreadId: 'foreign'});
 await expect(value.prepare!(child)).rejects.toThrow('target changed'); expect(value.canSend(child)).toBe(false);
 mocks.target.mockResolvedValue(target); await value.prepare!(child);
 await expect(value.send({agent: child, content: 'x'.repeat(32769), commandId: 'id'})).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
});

it('refreshes uncertain tickets when later executor evidence confirms handling', async () => {
 vi.useFakeTimers();
 const value = adapter(), seen: string[] = [];
 try {
  await value.prepare!(child);
  mocks.ticket.mockResolvedValueOnce({...ticket, status: 'delivery_uncertain'}).mockResolvedValue({...ticket, status: 'handled'});
  value.subscribe((_id, current) => seen.push(current.status));
  await value.send({agent: child, content: 'First', commandId: 'id'});
  await vi.advanceTimersByTimeAsync(1500);
  expect(seen).toEqual(['handled']);
  expect(mocks.send).toHaveBeenCalledTimes(1);
 } finally {value.dispose?.(); vi.useRealTimers();}
});
