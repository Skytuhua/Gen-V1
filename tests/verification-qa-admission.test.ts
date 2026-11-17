import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HarnessError, type Thread} from '../packages/contracts/index.ts';
import type {AgentWorkAdmissionV1} from '../packages/contracts/agent-work.ts';
import {AgentWorkCoordinator} from '../packages/core/agent-work.ts';
import {Store, digest} from '../packages/storage/store.ts';

const close: (() => Promise<void>)[] = [];
afterEach(async () => {for (const action of close.splice(0).reverse()) await action();});
function fixture(proof?: ConstructorParameters<typeof AgentWorkCoordinator>[0]['roleProofs']) {
  const directory = mkdtempSync(join(tmpdir(), 'qa-admission-')), store = new Store(directory), stamp = new Date().toISOString();
  const ctx = {threadId: 'parent', runId: 'run', epoch: 1};
  const thread: Thread = {id: ctx.threadId, title: 'QA', projectName: null, createdAt: stamp, updatedAt: stamp, status: 'working', runId: ctx.runId, epoch: ctx.epoch, modelId: 'fixture/model', sessionPath: null};
  store.internal('fixture.parent', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  const spec: AgentWorkAdmissionV1 = {commandId: 'admission', workId: 'approved-work', childThreadId: 'child', role: 'QA', prompt: 'Review only', grantSubset: [], budget: {tokens: 100, ms: 1000}, expectedOutputSchema: {type: 'object'}};
  const child = {supportsLiveSteer: false, send: vi.fn(async () => {}), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {})}, runtimeFactory = vi.fn(() => child);
  const qa = vi.fn((_ctx, supplied: AgentWorkAdmissionV1) => {if (digest(supplied) !== digest(spec)) throw new HarnessError('APPROVAL_REQUIRED', 'Only the exact approved QA work is permitted'); return {verifierId: 'host-work-proof'};});
  const coordinator = new AgentWorkCoordinator({store, assertRun: () => {}, isEnabled: () => false, qaEnabled: () => true, roleProofs: proof ?? {qa}, runtimeFactory});
  close.push(async () => {await coordinator.dispose(); store.close(); rmSync(directory, {recursive: true, force: true});});
  return {store, ctx, spec, coordinator, qa, child, runtimeFactory};
}

it('admits only host-proven QA while the unrelated agent-work flag remains disabled', async () => {
  const f = fixture();
  const work = await f.coordinator.admit(f.ctx, f.spec, new AbortController().signal);
  expect(work.role).toBe('QA'); expect(f.qa).toHaveBeenCalledWith(f.ctx, f.spec); expect(f.runtimeFactory).toHaveBeenCalledTimes(1);
  for (const role of ['PLAN_READ', 'RESEARCH_READ', 'CODE_WORKTREE']) {
    await expect(f.coordinator.admit(f.ctx, {...f.spec, role, workId: role, childThreadId: role, commandId: role}, new AbortController().signal)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  }
});

it.each(['workId', 'budget'])('denies a mismatched QA %s before a worker exists', async field => {
  const f = fixture(), changed = {...f.spec, ...(field === 'workId' ? {workId: 'other'} : {budget: {tokens: 101, ms: 1000}})};
  await expect(f.coordinator.admit(f.ctx, changed, new AbortController().signal)).rejects.toMatchObject({code: 'APPROVAL_REQUIRED'});
  expect(f.runtimeFactory).not.toHaveBeenCalled(); expect(f.store.all('agentWork')).toEqual([]);
});

it('denies QA with no proof and rechecks cancellation after the asynchronous proof', async () => {
  const missing = fixture({}); await expect(missing.coordinator.admit(missing.ctx, missing.spec, new AbortController().signal)).rejects.toMatchObject({code: 'ROLE_UNAVAILABLE'});
  expect(missing.runtimeFactory).not.toHaveBeenCalled();
  const controller = new AbortController(), f = fixture({qa: async () => {controller.abort(); return {verifierId: 'now-cancelled'};}});
  await expect(f.coordinator.admit(f.ctx, f.spec, controller.signal)).rejects.toMatchObject({code: 'CANCELLED_RUN'});
  expect(f.runtimeFactory).not.toHaveBeenCalled(); expect(f.store.all('agentWork')).toEqual([]);
});
