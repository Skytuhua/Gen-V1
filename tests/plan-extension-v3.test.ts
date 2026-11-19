import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import type {PlanRecord, PlanStep} from '../packages/contracts/planning.ts';
import {planDataId, PLANNING_PROVENANCE} from '../packages/contracts/planning.ts';
import {PlanExtensionStore} from '../packages/core/plan-extension.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const step = (id: string): PlanStep => ({id, title: id, status: 'pending', requirements: []});
const agent = (id: string): PlanRecord['agents'][number] => ({id, commandId: 'c-' + id, taskId: 't-1', name: id, task: 'do', status: 'queued', requirements: [], completedRequirementIds: [], reportedPercent: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
const plan = (): PlanRecord => ({version: 1, title: 'P', steps: [step('s1'), step('s2'), step('s3')], agents: [agent('ag1')]});

function fixture() {
  const base = realpathSync(tmpdir()), directory = mkdtempSync(join(base, 'plan-ext-')), store = new Store(directory);
  const extensions = new PlanExtensionStore({store});
  const threadId = 't-1', record = plan();
  store.internal('fixture', threadId, () => store.put('data', planDataId(threadId), threadId, {id: planDataId(threadId), threadId, revision: 1, value: record, provenance: PLANNING_PROVENANCE, createdAt: new Date().toISOString()}));
  cleanups.push(async () => {store.close(); if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(base + sep) || lstatSync(directory).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(directory, {recursive: true, force: true});});
  const extension = (over: Record<string, unknown> = {}) => ({
    version: 1 as const,
    planId: planDataId(threadId), canonicalRevision: 1, extensionRevision: 1,
    parentRelationships: [{parentId: 's1', childId: 'ag1'}],
    weights: [{nodeId: 's1', units: 2}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 2}],
    estimateUnits: 'units',
    reportWatermark: 0, ...over,
  });
  return {store, extensions, extension, threadId, record, planId: planDataId(threadId)};
}

describe('PlanExtensionV1 integrity', () => {
  it('accepts a versioned sidecar pinned to the canonical revision', () => {
    const f = fixture();
    const saved = f.extensions.put(f.extension());
    expect(saved.planId).toBe(f.extension().planId);
    expect(f.extensions.get(saved.planId)).toMatchObject({extensionRevision: 1});
  });
  it('rejects a sidecar written against a stale canonical revision', () => {
    const f = fixture();
    expect(() => f.extensions.put(f.extension({canonicalRevision: 2}))).toThrow(/stale|revision/i);
    // Bump the canonical plan, then the previously valid extension is refused.
    f.store.internal('bump', f.threadId, () => f.store.put('data', f.planId, f.threadId, {id: f.planId, threadId: f.threadId, revision: 2, value: {...f.record, runState: 'running'}, provenance: PLANNING_PROVENANCE, createdAt: 'now'}));
    expect(() => f.extensions.put(f.extension({canonicalRevision: 1, extensionRevision: 2}))).toThrow(/stale|revision/i);
  });
  it('rejects dangling parents, cycles, duplicate nodes and missing weights', () => {
    const f = fixture();
    expect(() => f.extensions.put(f.extension({parentRelationships: [{parentId: 'ghost', childId: 's1'}]}))).toThrow(/unknown|dangling/i);
    expect(() => f.extensions.put(f.extension({parentRelationships: [{parentId: 's1', childId: 'ghost'}]}))).toThrow(/unknown|dangling/i);
    expect(() => f.extensions.put(f.extension({parentRelationships: [{parentId: 's1', childId: 's2'}, {parentId: 's2', childId: 's1'}]}))).toThrow(/cycle/i);
    expect(() => f.extensions.put(f.extension({parentRelationships: [{parentId: 's1', childId: 'ag1'}, {parentId: 's2', childId: 'ag1'}]}))).toThrow(/declared parent|duplicate/i);
    expect(() => f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 1}]}))).toThrow(/weight/i);
  });
  it('rejects non-positive and non-integer weights and weights for unknown nodes', () => {
    const f = fixture();
    expect(() => f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 0}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 1}]}))).toThrow(/weight/i);
    expect(() => f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 1.5}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 1}]}))).toThrow(/weight/i);
    expect(() => f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 1}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 1}, {nodeId: 'ghost', units: 1}]}))).toThrow(/unknown|weight/i);
  });
  it('requires conservation: child units may not exceed the parent allocation', () => {
    const f = fixture();
    // ag1 claims 2 units under s1 but s1 only holds 1 unit here -> over-budget.
    expect(() => f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 1}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 2}]}))).toThrow(/conservation|allocation|budget/i);
    // ag1 holds fewer units than its parent — the undivided remainder stays
    // with the parent, so under-allocation is valid.
    const partial = f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 3}, {nodeId: 's2', units: 1}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 1}]}));
    expect(partial.weights.find(weight => weight.nodeId === 's1')).toMatchObject({units: 3});
  });
  it('split() allocates a child inside the parent budget and preserves the parent allocation', () => {
    const f = fixture();
    const saved = f.extensions.put(f.extension());
    const split = f.extensions.split(saved.planId, 's2', 'ag2', 1);
    expect(split.weights.find(weight => weight.nodeId === 'ag2')).toMatchObject({units: 1});
    // The parent's own units are untouched; the child merely partitions them.
    expect(split.weights.find(weight => weight.nodeId === 's2')).toMatchObject({units: 1});
    expect(split.parentRelationships).toContainEqual({parentId: 's2', childId: 'ag2'});
    expect(() => f.extensions.split(saved.planId, 's2', 'ag3', 5)).toThrow(/budget|allocation|units/i);
  });
  it('partial splits succeed and the parent keeps the residual share', () => {
    const f = fixture();
    const saved = f.extensions.put(f.extension({weights: [{nodeId: 's1', units: 2}, {nodeId: 's2', units: 4}, {nodeId: 's3', units: 1}, {nodeId: 'ag1', units: 2}]}));
    const first = f.extensions.split(saved.planId, 's2', 'ag2', 1);
    expect(first.weights.find(weight => weight.nodeId === 's2')).toMatchObject({units: 4});
    const second = f.extensions.split(saved.planId, 's2', 'ag3', 2);
    expect(second.parentRelationships).toContainEqual({parentId: 's2', childId: 'ag3'});
    // Residual s2 = 1; leaves: ag1(2), ag2(1), ag3(2), s3(1) -> total 7.
    const progress = f.extensions.progress(saved.planId, {s2: 'completed', ag1: 'completed'});
    expect(progress).toEqual({completed: 3, pending: 4, unknown: 0, total: 7});
  });
});

describe('progress and report watermark', () => {
  it('reports rational progress with unknown share and never fabricates 0 or 100%', () => {
    const f = fixture();
    const planId = f.extensions.put(f.extension()).planId;
    // ag1 partitions s1's 2 units; leaves are ag1(2), s2(1), s3(1) — total 4.
    const partial = f.extensions.progress(planId, {s1: 'completed', ag1: 'completed'});
    expect(partial).toEqual({completed: 2, pending: 2, unknown: 0, total: 4});
    const unsure = f.extensions.progress(planId, {ag1: 'unknown'});
    expect(unsure).toEqual({completed: 0, pending: 2, unknown: 2, total: 4});
    const allDone = f.extensions.progress(planId, {s1: 'completed', ag1: 'completed', s2: 'completed', s3: 'completed'});
    expect(allDone).toEqual({completed: 4, pending: 0, unknown: 0, total: 4});
    // No fabricated endpoints: units are exact integers, progress is a ratio of them.
    const none = f.extensions.progress(planId, {});
    expect(none).toEqual({completed: 0, total: 4, pending: 4, unknown: 0});
  });
  it('does not calculate current progress with weights pinned to an older plan', () => {
    const f = fixture();
    const {planId} = f.extensions.put(f.extension());
    f.store.internal('plan.changed', f.threadId, () => f.store.put('data', planId, f.threadId, {
      id: planId, threadId: f.threadId, revision: 2,
      value: {...f.record, steps: [...f.record.steps, step('new-step')]},
      provenance: PLANNING_PROVENANCE, createdAt: 'now',
    }));
    expect(() => f.extensions.progress(planId, {ag1: 'completed', s2: 'completed', s3: 'completed', 'new-step': 'pending'}))
      .toThrowError(expect.objectContaining({code: 'STALE_PLAN_REVISION'}));
  });
  it('node weight conservation holds across a tree of descendants', () => {
    const f = fixture();
    const tree = f.extension({
      parentRelationships: [{parentId: 's1', childId: 's2'}, {parentId: 's2', childId: 'ag1'}],
      weights: [{nodeId: 's1', units: 8}, {nodeId: 's2', units: 8}, {nodeId: 's3', units: 2}, {nodeId: 'ag1', units: 8}],
      estimateUnits: 'units',
    });
    expect(() => f.extensions.put(tree)).not.toThrow();
    const bad = f.extension({
      parentRelationships: [{parentId: 's1', childId: 's2'}, {parentId: 's2', childId: 'ag1'}],
      weights: [{nodeId: 's1', units: 8}, {nodeId: 's2', units: 4}, {nodeId: 's3', units: 2}, {nodeId: 'ag1', units: 8}],
      extensionRevision: 2,
    });
    expect(() => f.extensions.put(bad)).toThrow(/conservation|allocation|budget/i);
  });
  it('advances the report watermark only after a durable report record', () => {
    const f = fixture();
    const saved = f.extensions.put(f.extension({reportWatermark: f.store.sequence}));
    f.store.internal('evt.1', f.threadId, () => f.store.put('data', 'e1', f.threadId, {id: 'e1', threadId: f.threadId, revision: 1, value: {}, provenance: 'p', createdAt: 'n'}));
    f.store.internal('evt.2', f.threadId, () => f.store.put('data', 'e2', f.threadId, {id: 'e2', threadId: f.threadId, revision: 1, value: {}, provenance: 'p', createdAt: 'n'}));
    const report = f.extensions.report(saved.planId);
    expect(report.watermark).toBe(saved.reportWatermark);
    expect(report.deltas).toHaveLength(2);
    expect(report.nextWatermark).toBeGreaterThan(report.deltas[1].seq);
    // The stored watermark moved past the report's own durable record.
    expect(f.extensions.get(saved.planId)!.reportWatermark).toBe(report.nextWatermark);
    const again = f.extensions.report(saved.planId);
    expect(again.deltas).toHaveLength(0);
    expect(again.watermark).toBe(report.nextWatermark);
    expect(f.extensions.get(saved.planId)!.reportWatermark).toBe(again.nextWatermark);
  });
  it('reaches task events beyond a page of unrelated events', () => {
    const f = fixture();
    const saved = f.extensions.put(f.extension({reportWatermark: f.store.sequence}));
    // Flood the store with unrelated-thread events so a task event lands
    // beyond one report page; it must still surface in a later report.
    for (let i = 0; i < 505; i++)
      f.store.internal('noise.' + i, 'other-thread', () => f.store.put('data', 'noise-' + i, 'other-thread', {id: 'noise-' + i, threadId: 'other-thread', revision: 1, value: {}, provenance: 'p', createdAt: 'n'}));
    f.store.internal('evt.task', f.threadId, () => f.store.put('data', 'task-ev', f.threadId, {id: 'task-ev', threadId: f.threadId, revision: 1, value: {}, provenance: 'p', createdAt: 'n'}));
    const first = f.extensions.report(saved.planId);
    expect(first.deltas).toHaveLength(0);
    const second = f.extensions.report(saved.planId);
    expect(second.deltas.map(delta => delta.type)).toContain('evt.task');
    const third = f.extensions.report(saved.planId);
    expect(third.deltas).toHaveLength(0);
    expect(third.watermark).toBe(second.nextWatermark);
  });
});
