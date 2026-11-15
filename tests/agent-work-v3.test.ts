import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import type {ResourceGrant, RunContext, Thread} from '../packages/contracts/index.ts';
import {AgentWorkCoordinator, type AgentWorkChild} from '../packages/core/agent-work.ts';
import {CodeWorktreeResultV1Schema} from '../packages/contracts/agent-work.ts';
import {capabilityEnabled, __setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import type {AgentWorkV1} from '../packages/contracts/agent-work.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  __setCapabilityFlagForTests('agents.workV1', undefined);
  __setCapabilityFlagForTests('workspace.writeDelegateV1', undefined);
  for (const close of cleanups.splice(0).reverse()) await close();
});

class FakeChild implements AgentWorkChild {
  sent: {inputId: string; kind: string; text: string}[] = [];
  cancelled = false;
  disposed = false;
  constructor(readonly supportsLiveSteer: boolean, private readonly onSend?: (input: {inputId: string; kind: string; text: string}) => Promise<void> | void) {}
  async send(input: {inputId: string; kind: string; text: string}) { this.sent.push(input); await this.onSend?.(input); }
  async cancel() { this.cancelled = true; }
  async dispose() { this.disposed = true; }
}

const outputSchema = {
  type: 'object',
  required: ['outcome', 'summary', 'evidenceRefs', 'requirementIds'],
  properties: {
    outcome: {enum: ['COMPLETED', 'INCOMPLETE', 'BLOCKED']},
    summary: {type: 'string'},
    evidenceRefs: {type: 'array'},
    requirementIds: {type: 'array'},
  },
};

function fixture(options: {
  steer?: boolean;
  flags?: Record<string, boolean>;
  roleProofs?: ConstructorParameters<typeof AgentWorkCoordinator>[0]['roleProofs'];
  roleHandlers?: ConstructorParameters<typeof AgentWorkCoordinator>[0]['roleHandlers'];
  resourceResolver?: ConstructorParameters<typeof AgentWorkCoordinator>[0]['resourceResolver'];
  globalBudget?: {tokens: number | null; ms: number | null};
  onSend?: (input: {inputId: string; kind: string; text: string}) => Promise<void> | void;
  grants?: Partial<ResourceGrant>[];
  runtimeFactory?: () => Promise<AgentWorkChild> | AgentWorkChild;
} = {}) {
  const base = realpathSync(tmpdir()), directory = mkdtempSync(join(base, 'agent-work-')), store = new Store(directory);
  const children: FakeChild[] = [];
  for (const [key, value] of Object.entries(options.flags ?? {'agents.workV1': true})) __setCapabilityFlagForTests(key as never, value as never);
  const coordinator = new AgentWorkCoordinator({
    store,
    assertRun: () => {},
    isEnabled: capabilityEnabled,
    roleProofs: options.roleProofs,
    roleHandlers: options.roleHandlers,
    resourceResolver: options.resourceResolver,
    globalBudget: options.globalBudget,
    runtimeFactory: options.runtimeFactory ?? (() => { const child = new FakeChild(options.steer ?? false, options.onSend); children.push(child); return child; }),
  });
  const parentThread: Thread = {id: 'parent-1', title: 'Parent', projectName: 'proj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'working', epoch: 1, runId: 'run-1', modelId: 'test/model', sessionPath: null, accountId: 'acct-1', projectId: 'proj-1', workspaceId: 'ws-1'};
  const grants: ResourceGrant[] = (options.grants ?? [{}]).map((grant, i) => ({id: 'grant-' + i, threadId: parentThread.id, kind: 'project', path: 'C:/work/wt-' + i, label: 'g' + i, writable: true, createdAt: new Date().toISOString(), ...grant}));
  store.internal('fixture', parentThread.id, () => {
    store.put('thread', parentThread.id, parentThread.id, parentThread);
    for (const grant of grants) store.put('resource', grant.id, parentThread.id, grant);
  });
  cleanups.push(async () => {await coordinator.dispose(); store.close(); if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(base + sep) || lstatSync(directory).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(directory, {recursive: true, force: true});});
  const ctx: RunContext = {threadId: parentThread.id, runId: 'run-1', epoch: 1};
  const admission = (over: Record<string, unknown> = {}, i = 0) => ({
    commandId: 'admit-' + i + '-' + randomUUID().slice(0, 8), workId: 'work-' + i + '-' + randomUUID().slice(0, 8),
    role: 'PLAN_READ', childThreadId: 'child-' + i + '-' + randomUUID().slice(0, 8), prompt: 'Read and report.',
    expectedOutputSchema: outputSchema, grantSubset: grants.map(grant => grant.id), budget: {tokens: 100, ms: 5000}, ...over,
  });
  return {store, coordinator, children, ctx, parentThread, grants, admission};
}

const validOutput = {outcome: 'COMPLETED', summary: 'done', evidenceRefs: [], requirementIds: ['r1']};

describe('AgentWorkV1 admission and role gates', () => {
  it('stays fully closed while agents.workV1 is off, including the registry default', async () => {
    expect(capabilityEnabled('agents.workV1')).toBe(false);
    const f = fixture({flags: {}});
    await expect(f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    expect(f.store.all('agentWork')).toHaveLength(0);
  });
  it('admits read-only work, binds the child to parent grants with write rights stripped, and caps three slots', async () => {
    const f = fixture();
    const works: AgentWorkV1[] = [];
    for (let i = 0; i < 3; i++) works.push(await f.coordinator.admit(f.ctx, f.admission({}, i), new AbortController().signal));
    expect(works.map(work => work.state)).toEqual(['RUNNING', 'RUNNING', 'RUNNING']);
    expect(works[0].role).toBe('PLAN_READ');
    expect(f.children).toHaveLength(3);
    expect(f.children[0].sent[0]).toMatchObject({kind: 'START'});
    await expect(f.coordinator.admit(f.ctx, f.admission({}, 4), new AbortController().signal)).rejects.toMatchObject({code: 'AGENT_LIMIT'});
    // Read-only dispatch must not carry writable grants.
    const dispatched = f.coordinator.dispatchedGrants(works[0].workId)!;
    expect(dispatched.every(grant => grant.writable === false)).toBe(true);
  });
  it('rejects grant ids outside the parent thread and unknown grants before dispatch', async () => {
    const f = fixture();
    const other: ResourceGrant = {id: 'foreign', threadId: 'other-thread', kind: 'project', path: 'C:/elsewhere', label: 'x', writable: true, createdAt: new Date().toISOString()};
    f.store.internal('fixture', 'other-thread', () => f.store.put('resource', 'foreign', 'other-thread', other));
    await expect(f.coordinator.admit(f.ctx, f.admission({grantSubset: ['foreign']}), new AbortController().signal)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    await expect(f.coordinator.admit(f.ctx, f.admission({grantSubset: ['missing']}), new AbortController().signal)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    expect(f.children).toHaveLength(0);
  });
  it('exposes CODE_WORKTREE/QA as unavailable without their registered proofs while PLAN_READ continues', async () => {
    const f = fixture();
    expect(f.coordinator.roleAvailability(f.ctx, 'CODE_WORKTREE')).toMatchObject({available: false});
    expect(f.coordinator.roleAvailability(f.ctx, 'QA')).toMatchObject({available: false});
    expect(f.coordinator.roleAvailability(f.ctx, 'PLAN_READ')).toMatchObject({available: true});
    await expect(f.coordinator.admit(f.ctx, f.admission({role: 'CODE_WORKTREE'}), new AbortController().signal)).rejects.toMatchObject({code: 'ROLE_UNAVAILABLE'});
    await expect(f.coordinator.admit(f.ctx, f.admission({role: 'QA'}), new AbortController().signal)).rejects.toMatchObject({code: 'ROLE_UNAVAILABLE'});
    expect(await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal)).toMatchObject({state: 'RUNNING'});
  });
  it('admits CODE_WORKTREE only with the M08 write flag and a managed-worktree profile proof', async () => {
    __setCapabilityFlagForTests('agents.workV1', true);
    __setCapabilityFlagForTests('workspace.writeDelegateV1', true);
    const f = fixture({
      flags: {},
      roleProofs: {codeWorktree: () => ({worktreeId: 'wt-1', path: 'C:/work', profileDigest: 'a'.repeat(64)})},
    });
    const work = await f.coordinator.admit(f.ctx, f.admission({role: 'CODE_WORKTREE'}), new AbortController().signal);
    expect(work.role).toBe('CODE_WORKTREE');
    const dispatched = f.coordinator.dispatchedGrants(work.workId)!;
    expect(dispatched.some(grant => grant.writable)).toBe(true);
  });
  it('denies recursive spawn from a delegate child thread', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childCtx: RunContext = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await expect(f.coordinator.admit(childCtx, f.admission(), new AbortController().signal)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  });
  it('replays the durable receipt on a retried admit', async () => {
    const f = fixture();
    const spec = f.admission();
    const first = await f.coordinator.admit(f.ctx, spec, new AbortController().signal);
    const again = await f.coordinator.admit(f.ctx, spec, new AbortController().signal);
    expect(again.workId).toBe(first.workId);
    expect(f.children).toHaveLength(1);
  });
  it('refuses to overwrite an existing thread as a child', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    await expect(f.coordinator.admit(f.ctx, f.admission({childThreadId: work.childOwner.threadId}), new AbortController().signal))
      .rejects.toMatchObject({code: 'INVALID_AGENT_WORK'});
    expect(f.store.get<Thread>('thread', work.childOwner.threadId)).toMatchObject({kind: 'delegate'});
  });
  it('keeps the concurrent-slot cap per parent task, not store-wide', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) await f.coordinator.admit(f.ctx, f.admission({}, i), new AbortController().signal);
    await expect(f.coordinator.admit(f.ctx, f.admission({}, 9), new AbortController().signal)).rejects.toMatchObject({code: 'AGENT_LIMIT'});
    // A different parent task still admits its own first child.
    const thread2: Thread = {...f.parentThread, id: 'parent-2'};
    f.store.internal('fixture.parent2', thread2.id, () => {
      f.store.put('thread', thread2.id, thread2.id, thread2);
      f.store.put('resource', 'g2', thread2.id, {...f.grants[0], id: 'g2', threadId: thread2.id});
    });
    const ctx2: RunContext = {threadId: thread2.id, runId: 'run-2', epoch: 1};
    const admitted = await f.coordinator.admit(ctx2, f.admission({grantSubset: ['g2']}, 7), new AbortController().signal);
    expect(admitted.state).toBe('RUNNING');
  });
  it('strips write rights on grants outside the proven worktree path', async () => {
    __setCapabilityFlagForTests('agents.workV1', true);
    __setCapabilityFlagForTests('workspace.writeDelegateV1', true);
    const f = fixture({
      flags: {},
      grants: [{}, {path: 'C:/elsewhere/sibling'}],
      roleProofs: {codeWorktree: () => ({worktreeId: 'wt-1', path: 'C:/work', profileDigest: 'a'.repeat(64)})},
    });
    const work = await f.coordinator.admit(f.ctx, f.admission({role: 'CODE_WORKTREE'}), new AbortController().signal);
    const dispatched = f.coordinator.dispatchedGrants(work.workId)!;
    expect(dispatched.find(grant => grant.id === f.grants[0].id)).toMatchObject({writable: true});
    expect(dispatched.find(grant => grant.id === f.grants[1].id)).toMatchObject({writable: false});
  });
});

describe('output schema, repair and verification', () => {
  it('repairs invalid output exactly once, then fails with OUTPUT_SCHEMA_INVALID and a private bounded artifact', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const child = f.children[0];
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.submitResult(work.workId, childRun, {outcome: 'DONE'});
    expect(f.coordinator.inspect(work.workId)).toMatchObject({state: 'RUNNING', repairAttempts: 1});
    expect(child.sent.filter(input => input.kind === 'REPAIR')).toHaveLength(1);
    expect(child.sent[1].text).toContain('outcome');
    await f.coordinator.submitResult(work.workId, childRun, {still: 'wrong'});
    const failed = f.coordinator.inspect(work.workId)!;
    expect(failed).toMatchObject({state: 'FAILED', failureReason: 'OUTPUT_SCHEMA_INVALID', repairAttempts: 1});
    const raw = f.coordinator.rawOutputArtifact(work.workId)!;
    expect(raw).toBeTruthy();
    expect(JSON.stringify(raw.value).length).toBeLessThanOrEqual(16 * 1024);
    expect(f.store.snapshot().data.some(record => String(record.id).includes(String(work.workId)))).toBe(false);
    await f.coordinator.submitResult(work.workId, childRun, validOutput);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('FAILED');
  });
  it('records COMPLETED_REPORTED output and requires host evidence re-check for VERIFIED', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.submitResult(work.workId, childRun, validOutput);
    expect(f.coordinator.inspect(work.workId)).toMatchObject({state: 'COMPLETED_REPORTED'});
    expect(f.coordinator.inspect(work.workId)!.outputRef).toMatchObject({revision: 1});
    await f.coordinator.verify(f.ctx, work.workId);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('VERIFIED');
  });
  it('never upgrades fabricated evidence to VERIFIED', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.submitResult(work.workId, childRun, {...validOutput, evidenceRefs: [{id: 'invented', revision: 1}]});
    await expect(f.coordinator.verify(f.ctx, work.workId)).rejects.toMatchObject({code: 'INVALID_AGENT_EVIDENCE'});
    expect(f.coordinator.inspect(work.workId)!.state).toBe('COMPLETED_REPORTED');
  });
  it('verifies real evidence records belonging to the parent task', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    f.store.internal('fixture.evidence', f.parentThread.id, () => f.store.put('data', 'ev-1', f.parentThread.id, {id: 'ev-1', threadId: f.parentThread.id, revision: 1, value: {note: 'real'}, provenance: 'test', createdAt: new Date().toISOString()}));
    await f.coordinator.submitResult(work.workId, childRun, {...validOutput, evidenceRefs: [{id: 'ev-1', revision: 1}]});
    await f.coordinator.verify(f.ctx, work.workId);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('VERIFIED');
  });
});

describe('escalation, budget and authority', () => {
  it('denies direct, script, MCP and sibling-worktree escalation before any effect', async () => {
    const resolver = vi.fn();
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    for (const name of ['task_delegate', 'agent_work.admit', 'script.run', 'mcp.call', 'prepare_operation', 'fs.write', 'worktree.write']) {
      await expect(f.coordinator.invokeTool(work.workId, childRun, {name, args: {}})).rejects.toMatchObject({code: 'AGENT_TOOL_DENIED'});
    }
    // Naming a sibling run's context is denied before effects.
    await expect(f.coordinator.invokeTool(work.workId, {...childRun, runId: 'forged'}, {name: 'repository_read', args: {}})).rejects.toMatchObject({code: 'CANCELLED_RUN'});
    expect(resolver).not.toHaveBeenCalled();
  });
  it('permits read tools through the injected resolver without write rights', async () => {
    const resolver = vi.fn(async () => ({bytes: 4}));
    const f = fixture({resourceResolver: resolver});
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    const result = await f.coordinator.invokeTool(work.workId, childRun, {name: 'repository_read', args: {grantId: f.grants[0].id, path: 'a.txt'}});
    expect(result).toEqual({bytes: 4});
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({id: f.grants[0].id, writable: false}), false, {name: 'repository_read', args: {grantId: f.grants[0].id, path: 'a.txt', resourceId: f.grants[0].id}});
    await expect(f.coordinator.invokeTool(work.workId, childRun, {name: 'repository_read', args: {grantId: f.grants[0].id, path: 'a.txt', write: true}})).rejects.toMatchObject({code: 'AGENT_TOOL_DENIED'});
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it('rejects admission beyond the global reserved budget and counts failed and cancelled work', async () => {
    const f = fixture({globalBudget: {tokens: 150, ms: null}});
    await f.coordinator.admit(f.ctx, f.admission({budget: {tokens: 100, ms: null}}), new AbortController().signal);
    await expect(f.coordinator.admit(f.ctx, f.admission({budget: {tokens: 100, ms: null}}, 2), new AbortController().signal)).rejects.toMatchObject({code: 'AGENT_BUDGET_EXHAUSTED'});
    const ledger1 = f.coordinator.budgetLedger();
    expect(ledger1.reservedTokens).toBe(100);
    const work = f.coordinator.listForParent(f.ctx.threadId)[0];
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.submitResult(work.workId, childRun, {bad: 1});
    await f.coordinator.submitResult(work.workId, childRun, {bad: 2});
    expect(f.coordinator.inspect(work.workId)!.state).toBe('FAILED');
    const ledger2 = f.coordinator.budgetLedger();
    expect(ledger2.failed).toBe(1);
    expect(ledger2.reservedTokens).toBe(0);
  });
});

describe('stop, revocation, resume and restart', () => {
  it('revokes dispatch before cancelling children on parent stop and keeps late results historical', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.revokeForParent(f.ctx.threadId);
    expect(f.children[0].cancelled).toBe(true);
    expect(f.children[0].disposed).toBe(true);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('CANCELLED');
    await f.coordinator.submitResult(work.workId, childRun, validOutput);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('CANCELLED');
    expect(f.coordinator.lateArtifacts(work.workId)).toHaveLength(1);
  });
  it('resume creates a new child epoch and refuses stale account, project or grant bindings', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    await f.coordinator.stop(f.ctx, work.workId);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('CANCELLED');
    const resumed = await f.coordinator.resume(f.ctx, work.workId);
    expect(resumed.childOwner.epoch).toBe(2);
    expect(resumed.childOwner.runId).not.toBe(work.childOwner.runId);
    expect(resumed.state).toBe('RUNNING');
    // Change the durable parent binding, then refuse resume as stale authority.
    await f.coordinator.stop(f.ctx, work.workId);
    f.store.internal('fixture.rebind', f.parentThread.id, () => {const t = f.store.get<Thread>('thread', f.parentThread.id)!; f.store.put('thread', t.id, t.id, {...t, accountId: 'other'});});
    await expect(f.coordinator.resume(f.ctx, work.workId)).rejects.toMatchObject({code: 'STALE_AGENT_AUTHORITY'});
    expect(f.coordinator.inspect(work.workId)!.state).toBe('CANCELLED');
    f.store.internal('fixture.rebind2', f.parentThread.id, () => {const t = f.store.get<Thread>('thread', f.parentThread.id)!; f.store.put('thread', t.id, t.id, {...t, accountId: 'acct-1', projectId: 'other-project'});});
    await expect(f.coordinator.resume(f.ctx, work.workId)).rejects.toMatchObject({code: 'STALE_AGENT_AUTHORITY'});
  });
  it('reconstructs the visible graph after restart from durable facts with interrupted non-terminal work', async () => {
    const f = fixture();
    const a = await f.coordinator.admit(f.ctx, f.admission({}, 1), new AbortController().signal);
    const b = await f.coordinator.admit(f.ctx, f.admission({}, 2), new AbortController().signal);
    const bRun = {threadId: b.childOwner.threadId, runId: b.childOwner.runId!, epoch: b.childOwner.epoch};
    await f.coordinator.submitResult(b.workId, bRun, validOutput);
    const recovered = new AgentWorkCoordinator({store: f.store, assertRun: () => {}, isEnabled: capabilityEnabled, runtimeFactory: () => new FakeChild(false)});
    recovered.recover();
    expect(f.coordinator.inspect(a.workId)!.state).toBe('INTERRUPTED');
    expect(f.coordinator.inspect(b.workId)!.state).toBe('COMPLETED_REPORTED');
    const graph = recovered.reconstruct(f.ctx.threadId);
    expect(graph.find(node => node.workId === a.workId)).toMatchObject({state: 'INTERRUPTED', childKnown: true});
    f.store.internal('fixture.remove-child', f.parentThread.id, () => f.store.remove('thread', a.childOwner.threadId));
    const graph2 = recovered.reconstruct(f.ctx.threadId);
    expect(graph2.find(node => node.workId === a.workId)!.childKnown).toBe(false);
    await recovered.dispose();
  });
  it('marks waiting human as an explicit state reachable only while live', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    f.coordinator.markWaitingHuman(f.ctx, work.workId);
    expect(f.coordinator.inspect(work.workId)!.state).toBe('WAITING_HUMAN');
    await f.coordinator.stop(f.ctx, work.workId);
    expect(() => f.coordinator.markWaitingHuman(f.ctx, work.workId)).toThrow();
  });
});

describe('live-steer semantics, revocation revalidation and dispatch race', () => {
  it('keeps steering queued-after-current when the adapter cannot live-steer', async () => {
    const f = fixture({steer: false});
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const record = await f.coordinator.sendInput(f.ctx, {inputId: 'in-steer', workId: work.workId, kind: 'STEER', text: 'go left', dedupeKey: 'k-steer'});
    expect(record.delivery).toBe('ACCEPTED');
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(f.children[0].sent.filter(input => input.kind === 'STEER')).toHaveLength(0);
    expect(f.coordinator.inbox.inspect('in-steer')).toMatchObject({delivery: 'ACCEPTED'});
  });
  it('live-steer adapter delivers steering into the active run and marks it ENTERED_RUNTIME', async () => {
    const f = fixture({steer: true});
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    await f.coordinator.sendInput(f.ctx, {inputId: 'in-steer2', workId: work.workId, kind: 'STEER', text: 'go left', dedupeKey: 'k-steer2'});
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(f.children[0].sent.filter(input => input.kind === 'STEER')).toHaveLength(1);
    expect(f.coordinator.inbox.inspect('in-steer2')).toMatchObject({delivery: 'ENTERED_RUNTIME'});
  });
  it('marks follow-up UNKNOWN instead of returning a stale ACCEPTED snapshot', async () => {
    const f = fixture();
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    await f.coordinator.stop(f.ctx, work.workId);
    const record = await f.coordinator.sendInput(f.ctx, {inputId: 'in-late', workId: work.workId, kind: 'FOLLOW_UP', text: 'still there?', dedupeKey: 'k-late'});
    expect(record.delivery).toBe('UNKNOWN');
    expect(f.coordinator.inbox.inspect('in-late')).toMatchObject({delivery: 'UNKNOWN'});
  });
  it('never dispatches work cancelled while the runtime was still starting', async () => {
    let resolveFactory!: (child: AgentWorkChild) => void;
    const f = fixture({runtimeFactory: () => new Promise<AgentWorkChild>(resolve => { resolveFactory = resolve; })});
    const spec = f.admission();
    const pending = f.coordinator.admit(f.ctx, spec, new AbortController().signal);
    while (!f.coordinator.inspect(spec.workId)) await new Promise(resolve => setTimeout(resolve, 5));
    await f.coordinator.revokeForParent(f.ctx.threadId);
    const child = new FakeChild(false);
    resolveFactory(child);
    const work = await pending;
    expect(work.state).toBe('CANCELLED');
    expect(child.disposed).toBe(true);
    expect(child.sent).toHaveLength(0);
  });
  it('denies child calls on grants the parent no longer holds', async () => {
    const resolver = vi.fn(async () => ({bytes: 4}));
    const f = fixture({resourceResolver: resolver});
    const work = await f.coordinator.admit(f.ctx, f.admission(), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    f.store.internal('fixture.revoke', f.parentThread.id, () => f.store.remove('resource', f.grants[0].id));
    await expect(f.coordinator.invokeTool(work.workId, childRun, {name: 'repository_read', args: {grantId: f.grants[0].id, path: 'a.txt'}}))
      .rejects.toMatchObject({code: 'PERMISSION_REVOKED'});
    expect(resolver).not.toHaveBeenCalled();
  });
  it('re-derives write rights on resume instead of replaying the stale admission grants', async () => {
    __setCapabilityFlagForTests('agents.workV1', true);
    __setCapabilityFlagForTests('workspace.writeDelegateV1', true);
    const f = fixture({
      flags: {},
      roleProofs: {codeWorktree: () => ({worktreeId: 'wt-1', path: 'C:/work', profileDigest: 'a'.repeat(64)})},
    });
    const work = await f.coordinator.admit(f.ctx, f.admission({role: 'CODE_WORKTREE'}), new AbortController().signal);
    expect(f.coordinator.dispatchedGrants(work.workId)!.some(grant => grant.writable)).toBe(true);
    await f.coordinator.stop(f.ctx, work.workId);
    // The parent loses write rights on the grant between stop and resume.
    f.store.internal('fixture.dewrite', f.parentThread.id, () => {
      const grant = f.store.get<ResourceGrant>('resource', f.grants[0].id)!;
      f.store.put('resource', grant.id, f.parentThread.id, {...grant, writable: false});
    });
    const resumed = await f.coordinator.resume(f.ctx, work.workId);
    expect(resumed.state).toBe('RUNNING');
    expect(f.coordinator.dispatchedGrants(resumed.workId)!.every(grant => grant.writable === false)).toBe(true);
  });
});

describe('result contract and lifetime budget', () => {
  it('accepts real 40-hex git commits in code-worktree results', () => {
    expect(() => CodeWorktreeResultV1Schema.parse({...validOutput, worktreeId: 'wt-1', commits: ['a'.repeat(40)]})).not.toThrow();
    expect(() => CodeWorktreeResultV1Schema.parse({...validOutput, worktreeId: 'wt-1', commits: ['a'.repeat(64)]})).toThrow();
  });
  it('counts completed work against the lifetime global budget', async () => {
    const f = fixture({globalBudget: {tokens: 150, ms: null}});
    const work = await f.coordinator.admit(f.ctx, f.admission({budget: {tokens: 100, ms: null}}), new AbortController().signal);
    const childRun = {threadId: work.childOwner.threadId, runId: work.childOwner.runId!, epoch: work.childOwner.epoch};
    await f.coordinator.submitResult(work.workId, childRun, validOutput);
    expect(f.coordinator.budgetLedger()).toMatchObject({spentTokens: 100, reservedTokens: 0});
    await expect(f.coordinator.admit(f.ctx, f.admission({budget: {tokens: 60, ms: null}}, 2), new AbortController().signal))
      .rejects.toMatchObject({code: 'AGENT_BUDGET_EXHAUSTED'});
  });
});
