import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { HarnessError, type DataRecord, type RunContext, type Thread } from '../packages/contracts/index.ts';
import { PlanningCoordinator, type PlanningHooks } from '../packages/core/planning.ts';
import { PlanRecordSchema, PlanUpdateSchema, type AgentJob, type PlanRecord } from '../packages/contracts/planning.ts';
import * as timeline from '../packages/core/planning.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0)) close(); });
const stamp = '2026-11-05T12:00:00.000Z';
const step = (id: string, extra = {}) => ({ id, title: id, status: 'working' as const, requirements: [], ...extra });
const job = (id: string, extra = {}): AgentJob => ({
  id, commandId: 'batch', taskId: id, name: id, task: 'Read the assigned source', stepId: 'build',
  status: 'working', requirements: [{ id: 'read', label: 'Read source' }], completedRequirementIds: [],
  reportedPercent: null, createdAt: stamp, updatedAt: stamp, ...extra,
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'plan-timeline-')), store = new Store(dir);
  const ctx: RunContext = { threadId: 'parent', runId: 'run-1', epoch: 1 };
  const thread = (): Thread => ({ id: ctx.threadId, title: 'Task', status: 'working', projectName: null,
    epoch: ctx.epoch, runId: ctx.runId, modelId: 'test/model', createdAt: stamp, updatedAt: stamp, sessionPath: null });
  store.internal('seed', ctx.threadId, () => store.put('thread', ctx.threadId, ctx.threadId, thread()));
  const hooks: PlanningHooks = { store, assertRun: incoming => {
    if (incoming.runId !== ctx.runId || incoming.epoch !== ctx.epoch) throw new HarnessError('CANCELLED_RUN', 'Stale run');
  }, domainContext: () => { throw new Error('Read-only projection must not create a runtime or domain context'); },
  runtimeFactory: () => { throw new Error('Projection must not execute agents'); } };
  const coordinator = new PlanningCoordinator(hooks);
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const update = (steps = [step('build')], extra = {}) => coordinator.updatePlan(ctx, {
    title: 'Task', baseRevision: coordinator.inspect(ctx.threadId)?.revision ?? 0, steps, ...extra,
  });
  const seed = (value: PlanRecord, revision = 1) => store.internal('seed.plan', ctx.threadId, () => store.put('data', 'plan:parent', ctx.threadId,
    { id: 'plan:parent', threadId: ctx.threadId, provenance: 'harness:plan', revision, createdAt: stamp, value }));
  return { store, ctx, hooks, coordinator, update, seed, thread };
}

it('publishes detailed branch/join steps with explicit completion distinct from acceptance', () => {
  const x = setup();
  const result = x.update([
    step('design', { state: 'completed', objective: 'Confirm the contract', details: 'Inspect real consumers', dependsOn: [],
      result: 'Contract agreed', outputs: [{ id: 'contract', label: 'Planning contract', ref: { id: 'source', revision: 2 } }],
      checks: [{ id: 'read', label: 'Consumers inspected', status: 'reported_passed' }] }),
    step('build', { state: 'running', dependsOn: ['design'] }),
    step('tests', { state: 'blocked', dependsOn: ['design'], blockers: ['Waiting for granted test inputs'] }),
    step('review', { state: 'proposed', dependsOn: ['build', 'tests'] }),
  ]);
  expect(result.value.steps[0]).toMatchObject({ state: 'completed', objective: 'Confirm the contract', result: 'Contract agreed' });
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps.map(item => [item.id, item.status, item.dependsOn])).toEqual([
    ['design', 'completed', []], ['build', 'running', ['design']], ['tests', 'blocked', ['design']], ['review', 'proposed', ['build', 'tests']],
  ]);
  expect(result.value.authority).toBe('proposal');
});

it.each([
  [step('one', { dependsOn: ['missing'] })],
  [step('one', { dependsOn: ['one'] })],
  [step('one', { dependsOn: ['two'] }), step('two', { dependsOn: ['one'] })],
  [step('one'), step('two', { dependsOn: ['one', 'one'] })],
])('rejects missing, self, cyclic or duplicate dependency edges atomically: %j', (...steps) => {
  const x = setup(), before = x.store.sequence;
  expect(() => x.update(steps)).toThrow(HarnessError);
  expect(x.store.sequence).toBe(before); expect(x.coordinator.inspect(x.ctx.threadId)).toBeNull();
});

it('enforces node, edge and byte budgets before any durable update', () => {
  const x = setup();
  expect(() => x.update(Array.from({ length: 25 }, (_, i) => step('s' + i)))).toThrow();
  expect(() => x.update(Array.from({ length: 24 }, (_, i) => step('s' + i,
    { dependsOn: Array.from({ length: i }, (_, j) => 's' + j) })))).toThrow();
  expect(() => x.update([step('big', { details: 'a'.repeat(4097) })])).toThrow();
  expect(x.store.snapshot().data).toEqual([]);
});

it('rejects stale or missing revisions and deduplicates command retries without events', () => {
  const x = setup(), first = x.update(), args = { title: 'Task', steps: [step('build')], baseRevision: first.revision, commandId: 'edit' };
  const second = x.coordinator.updatePlan(x.ctx, args), seq = x.store.sequence;
  expect(x.coordinator.updatePlan(x.ctx, args)).toEqual(second);
  expect(x.store.sequence).toBe(seq);
  expect(() => x.coordinator.updatePlan(x.ctx, { ...args, commandId: 'stale', title: 'Old' })).toThrow(expect.objectContaining({ code: 'STALE_PLAN' }));
  expect(() => x.coordinator.updatePlan(x.ctx, { title: 'Task', steps: [] })).toThrow(expect.objectContaining({ code: 'STALE_PLAN' }));
  expect(() => x.coordinator.updatePlan(x.ctx, { ...args, title: 'Changed' })).toThrow(expect.objectContaining({ code: 'DUPLICATE_COMMAND' }));
  expect(x.store.sequence).toBe(seq);
});

it('keeps host-owned assignments when a model omits them during replan', () => {
  const x = setup(); x.seed({ version: 1, title: 'Task', steps: [step('build', { agentIds: ['reader'] })], agents: [job('reader')] });
  const result = x.update([step('build', { title: 'Same objective, more detail' }), step('test')]);
  expect(result.value.steps[0].agentIds).toEqual(['reader']);
  expect(result.value.agents[0]).toMatchObject({ id: 'reader', stepId: 'build', status: 'working' });
});

it('forbids model assignment rebinding, invented jobs and removing assigned steps', () => {
  const x = setup(); x.seed({ version: 1, title: 'Task', steps: [step('build', { agentIds: ['reader'] }), step('test')], agents: [job('reader')] });
  for (const steps of [[step('test')], [step('build'), step('test', { agentIds: ['reader'] })], [step('build', { agentIds: ['fake'] })]]) {
    expect(() => x.update(steps)).toThrow();
  }
  expect(x.coordinator.inspect(x.ctx.threadId)!.revision).toBe(1);
});

it('joins nested canonical jobs through an injected read-only provider without duplicating them in storage', () => {
  const x = setup();
  const snapshot = { threadId: x.ctx.threadId, runId: x.ctx.runId, epoch: x.ctx.epoch,
    jobs: [job('lead'), job('reader', { parentJobId: 'lead' }), job('checks', { parentJobId: 'lead' })] };
  x.hooks.canonicalJobs = { read: () => snapshot };
  x.update(); const seq = x.store.sequence, view = x.coordinator.timeline(x.ctx.threadId)!;
  expect(view.steps[0].agents.map(lane => [lane.job.id, lane.children.map(child => child.job.id)])).toEqual([['lead', ['reader', 'checks']]]);
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.agents).toEqual([]);
  expect(x.store.sequence).toBe(seq);
  expect(() => x.update([step('elsewhere')])).toThrow();
  snapshot.jobs[1].status = 'needs_review';
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps[0].agents[0].children[0].job.status).toBe('needs_review');
});

it('advances the plan revision in the canonical producer transaction without copying its job records', () => {
  const x = setup(); x.update();
  const snapshot = { threadId: x.ctx.threadId, runId: x.ctx.runId, epoch: 1, jobs: [job('reader')] };
  x.hooks.canonicalJobs = { read: () => snapshot };
  const before = x.coordinator.inspect(x.ctx.threadId)!.revision;
  x.store.internal('canonical.job.changed', x.ctx.threadId, () => {
    snapshot.jobs[0].status = 'needs_review'; x.coordinator.refreshCanonicalJobs(x.ctx.threadId);
  });
  expect(x.coordinator.inspect(x.ctx.threadId)!.revision).toBe(before + 1);
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.agents).toEqual([]);
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps[0].status).toBe('review_required');
});

it('rejects a nested canonical child that would disappear beneath a differently assigned parent', () => {
  const x = setup(); x.update([step('build'), step('test')]);
  x.hooks.canonicalJobs = { read: () => ({ threadId: x.ctx.threadId, runId: x.ctx.runId, epoch: 1,
    jobs: [job('lead', { stepId: undefined }), job('child', { parentJobId: 'lead', stepId: 'test' })] }) };
  expect(() => x.coordinator.timeline(x.ctx.threadId)).toThrow(HarnessError);
});

it('orders dependency steps before their consumers while retaining stable independent order', () => {
  const x = setup(); x.update([step('review', { dependsOn: ['build', 'tests'] }), step('build'), step('tests')]);
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps.map(item => item.id)).toEqual(['build', 'tests', 'review']);
});

it('rejects a high-revision snapshot with a forged plan identity', () => {
  const x = setup(), record = x.update();
  expect(timeline.isNewerPlanSnapshot(null, { ...record, id: 'other' })).toBe(false);
});

it.each(['foreign', 'cycle', 'missing-parent', 'wrong-step', 'duplicate'])('fails closed on invalid canonical provider records: %s', kind => {
  const x = setup(); x.update();
  const jobs = kind === 'cycle' ? [job('a', { parentJobId: 'b' }), job('b', { parentJobId: 'a' })]
    : kind === 'missing-parent' ? [job('a', { parentJobId: 'missing' })]
    : kind === 'wrong-step' ? [job('a', { stepId: 'foreign' })]
    : kind === 'duplicate' ? [job('a'), job('a')] : [job('a')];
  x.hooks.canonicalJobs = { read: () => ({ threadId: kind === 'foreign' ? 'other' : x.ctx.threadId, runId: x.ctx.runId, epoch: 1, jobs }) };
  expect(() => x.coordinator.timeline(x.ctx.threadId)).toThrow(HarnessError);
});

it('enforces canonical job count and nesting bounds without truncating actual work', () => {
  const x = setup(); x.update();
  for (const jobs of [Array.from({ length: 25 }, (_, i) => job('j' + i)),
    Array.from({ length: 9 }, (_, i) => job('j' + i, i ? { parentJobId: 'j' + (i - 1) } : {}))]) {
    x.hooks.canonicalJobs = { read: () => ({ threadId: x.ctx.threadId, runId: x.ctx.runId, epoch: 1, jobs }) };
    expect(() => x.coordinator.timeline(x.ctx.threadId)).toThrow(HarnessError);
  }
});

it('preserves host-verified evidence while treating a revised approved plan as a fresh proposal', () => {
  const x = setup(); x.seed({ version: 1, title: 'Approved', authority: 'approved', steps: [step('build', { status: 'completed', state: 'accepted',
    checks: [{ id: 'receipt', label: 'Test receipt', status: 'verified_passed', evidence: [{ id: 'check', revision: 1 }] }] })], agents: [] });
  const revised = x.update([step('build', { status: 'completed', details: 'New result to review' })]);
  expect(revised.value.authority).toBe('proposal');
  expect(revised.value.steps[0].checks).toEqual([{ id: 'receipt', label: 'Test receipt', status: 'verified_passed', evidence: [{ id: 'check', revision: 1 }] }]);
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps[0].status).toBe('completed');
  expect(() => x.update([step('build', { checks: [{ id: 'receipt', label: 'Different check', status: 'reported_passed' }] })])).toThrow();
  expect(() => x.update([step('build', { objective: 'A different task must not inherit old verification' })])).toThrow();
});

it('adapts legacy linear records and 100% reported checks without manufacturing acceptance', () => {
  const x = setup(); x.seed({ version: 1, title: 'Old plan', steps: [step('build', { status: 'completed',
    requirements: [{ id: 'read', label: 'Read', completed: true }] }), step('test', { status: 'pending' })],
    agents: [job('reader', { status: 'completed', completedRequirementIds: ['read'] })] });
  const view = x.coordinator.timeline(x.ctx.threadId)!;
  expect(view.steps[0]).toMatchObject({ status: 'completed', checks: [{ status: 'reported_passed' }] });
  expect(view.steps[1]).toMatchObject({ status: 'proposed', dependsOn: ['build'] });
  expect(view.authority).toBe('proposal');
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.steps[1]).not.toHaveProperty('dependsOn');
});

it('does not let model reports mint accepted completion, verified checks, approval or presentation state', () => {
  const x = setup();
  for (const args of [
    { steps: [step('build', { state: 'accepted' })] },
    { steps: [step('build', { checks: [{ id: 'ok', label: 'Okay', status: 'verified_passed' }] })] },
    { authority: 'approved' }, { collapsed: true }, { focus: 'build' }, { scrollTop: 20 }, { run: x.ctx },
  ]) expect(() => x.update([step('build')], args)).toThrow();
  expect(PlanRecordSchema.safeParse({ version: 1, title: 'Trusted', steps: [step('build', { state: 'accepted' })], agents: [] }).success).toBe(true);
  expect(PlanUpdateSchema.safeParse({ title: 'Task', steps: [step('build')], authority: 'approved' }).success).toBe(false);
});

it.each(['cancelled', 'interrupted', 'failed', 'review_required'] as const)('ends running steps truthfully for %s and ignores old epochs', status => {
  const x = setup(); x.update([step('build'), step('done', { status: 'completed' })]);
  x.store.internal('run.end', x.ctx.threadId, () => x.coordinator.endRun(x.ctx, status));
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.steps.map(item => item.state)).toEqual([status, undefined]);
  const seq = x.store.sequence;
  x.store.internal('stale.end', x.ctx.threadId, () => x.coordinator.endRun({ ...x.ctx, epoch: 0 }, 'cancelled'));
  expect(x.coordinator.inspect(x.ctx.threadId)!.revision).toBe(2); expect(x.store.sequence).toBe(seq + 1);
});

it('resets an old running lane on a new run and rejects a late prior snapshot', () => {
  const x = setup(), first = x.update();
  x.ctx.runId = 'run-2'; x.ctx.epoch = 2;
  x.store.internal('run.start', x.ctx.threadId, () => { x.store.put('thread', x.ctx.threadId, x.ctx.threadId, x.thread()); x.coordinator.beginRun(x.ctx); });
  const next = x.coordinator.inspect(x.ctx.threadId)!;
  expect(next.value.steps[0].state).toBe('interrupted');
  expect(next.value.run).toEqual({ runId: 'run-2', epoch: 2 });
  expect(timeline.isNewerPlanSnapshot(next, first)).toBe(false);
  expect(timeline.isNewerPlanSnapshot(first, next)).toBe(true);
  expect(timeline.isNewerPlanSnapshot(next, { ...next, threadId: 'foreign', revision: 99 })).toBe(false);
  expect(timeline.isNewerPlanSnapshot(next, { ...next, revision: 99, value: { ...next.value, run: first.value.run } })).toBe(false);
});

it('marks crash-left plan-only work interrupted without starting or billing jobs', () => {
  const x = setup(); x.update(); x.coordinator.recover();
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.steps[0].state).toBe('interrupted');
  const seq = x.store.sequence; x.coordinator.recover(); expect(x.store.sequence).toBe(seq);
});

it('retains a failed run outcome when runtime teardown subsequently cancels its workers', async () => {
  const x = setup(); x.update();
  x.store.internal('run.failed', x.ctx.threadId, () => x.coordinator.endRun(x.ctx, 'failed'));
  await x.coordinator.cancel(x.ctx);
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.runState).toBe('failed');
});

it('interrupts plan-only work during coordinator shutdown', async () => {
  const x = setup(); x.update(); await x.coordinator.dispose();
  expect(x.coordinator.inspect(x.ctx.threadId)!.value.steps[0].state).toBe('interrupted');
});

it('projects orphaned legacy jobs readably and never calls a stopped lane working', async () => {
  const x = setup(); x.seed({ version: 1, title: 'Legacy', steps: [step('test')], agents: [job('orphan')] });
  await x.coordinator.cancel(x.ctx);
  expect(x.coordinator.timeline(x.ctx.threadId)!.unassignedAgents[0].job.status).toBe('interrupted');
  expect(x.coordinator.timeline(x.ctx.threadId)!.steps[0].status).toBe('cancelled');
});

it('serializes committed plan revisions and rolls back invalid updates without touching presentation state', () => {
  const x = setup(), events: DataRecord[] = [];
  x.store.internal('presentation', x.ctx.threadId, () => x.store.put('userState', 'plan-view', x.ctx.threadId, { collapsed: ['build'], focus: 'build', scrollTop: 42 }));
  x.store.subscribe(event => { if (event.type === 'plan.updated') events.push((event.payload as { result: DataRecord }).result); });
  x.update(); x.update([step('build', { state: 'review_required' })]);
  expect(() => x.update([step('build', { dependsOn: ['gone'] })])).toThrow();
  expect(events.map(record => record.revision)).toEqual([1, 2]);
  expect(x.store.get('userState', 'plan-view')).toEqual({ collapsed: ['build'], focus: 'build', scrollTop: 42 });
});
