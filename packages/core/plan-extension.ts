import {Store} from '../storage/store.ts';
import {HarnessError, type DataRecord, type WorkspaceEvent} from '../contracts/index.ts';
import {PLANNING_PROVENANCE, PlanRecordSchema, type PlanRecord} from '../contracts/planning.ts';
import {AGENT_WORK_LIMITS, PlanExtensionV1Schema, type PlanExtensionV1} from '../contracts/agent-work.ts';

const KIND = 'planExtension';
const REPORT_KIND = 'agentWorkReport';
const SELF_EVENT = /^planExtension\.|^agentWorkReport$/;

export interface PlanProgress {
  completed: number;
  pending: number;
  unknown: number;
  total: number;
}

export interface PlanReport {
  planId: string;
  watermark: number;
  nextWatermark: number;
  deltas: WorkspaceEvent[];
  reportId: string;
}

/** Versioned plan sidecar. The canonical PlanRecord v1 stays unchanged; this
 * store pins an extension to an exact base revision and rejects a changed
 * base outright rather than smuggling fields into v1. All writes are durable
 * before any in-memory position (the report watermark) advances. */
export class PlanExtensionStore {
  constructor(private readonly hooks: {store: Store}) {}

  private canonical(planId: string): {record: DataRecord; plan: PlanRecord} {
    const record = this.hooks.store.get<DataRecord>('data', planId);
    if (!record || record.provenance !== PLANNING_PROVENANCE)
      throw new HarnessError('INVALID_PLAN_EXTENSION', `No canonical plan record at ${planId}`);
    return {record, plan: PlanRecordSchema.parse(record.value)};
  }

  get(planId: string): PlanExtensionV1 | null {
    return this.hooks.store.get<PlanExtensionV1>(KIND, planId) ?? null;
  }

  put(raw: unknown): PlanExtensionV1 {
    const extension = PlanExtensionV1Schema.parse(raw);
    const {record, plan} = this.canonical(extension.planId);
    if (extension.canonicalRevision !== record.revision)
      throw new HarnessError('STALE_PLAN_REVISION', `Extension pins canonical revision ${extension.canonicalRevision} but the plan record is at revision ${record.revision}`);
    const existing = this.get(extension.planId);
    if (existing && extension.extensionRevision !== existing.extensionRevision + 1)
      throw new HarnessError('STALE_PLAN_REVISION', `Extension revision ${extension.extensionRevision} does not follow stored revision ${existing.extensionRevision}`);
    if (!existing && extension.extensionRevision !== 1)
      throw new HarnessError('STALE_PLAN_REVISION', 'A new plan extension must start at revision 1');
    this.validate(extension, plan);
    this.hooks.store.internal('planExtension.put', record.threadId, () => this.hooks.store.put(KIND, extension.planId, record.threadId, extension));
    return extension;
  }

  /** Add a child node inside a parent node's existing allocation. The
   * parent's units are re-split, never grown: the extension total is
   * preserved by the conservation check on the next write. */
  split(planId: string, parentId: string, childId: string, units: number): PlanExtensionV1 {
    const extension = this.get(planId);
    if (!extension) throw new HarnessError('INVALID_PLAN_EXTENSION', `No plan extension at ${planId}`);
    const weightBy = new Map(extension.weights.map(weight => [weight.nodeId, weight.units]));
    if (!weightBy.has(parentId)) throw new HarnessError('INVALID_PLAN_EXTENSION', `Unknown parent node ${parentId}`);
    if (weightBy.has(childId) || extension.parentRelationships.some(rel => rel.childId === childId))
      throw new HarnessError('INVALID_PLAN_EXTENSION', `Node ${childId} already exists`);
    const spent = extension.parentRelationships.filter(rel => rel.parentId === parentId)
      .reduce((sum, rel) => sum + (weightBy.get(rel.childId) ?? 0), 0);
    if (!Number.isInteger(units) || units <= 0 || spent + units > (weightBy.get(parentId) ?? 0))
      throw new HarnessError('INVALID_PLAN_EXTENSION', `Split of ${units} units exceeds the remaining allocation of ${parentId}`);
    return this.put({...extension,
      parentRelationships: [...extension.parentRelationships, {parentId, childId}],
      weights: [...extension.weights, {nodeId: childId, units}],
      extensionRevision: extension.extensionRevision + 1});
  }

  private validate(extension: PlanExtensionV1, plan: PlanRecord): void {
    const planNodes = new Set([...plan.steps.map(step => step.id), ...plan.agents.map(agent => agent.id)]);
    const extensionNodes = new Set(extension.parentRelationships.map(rel => rel.childId));
    const weightBy = new Map(extension.weights.map(weight => [weight.nodeId, weight.units]));
    for (const nodeId of planNodes)
      if (!weightBy.has(nodeId)) throw new HarnessError('INVALID_PLAN_EXTENSION', `Plan node ${nodeId} has no weight allocation`);
    for (const weight of extension.weights)
      if (!planNodes.has(weight.nodeId) && !extensionNodes.has(weight.nodeId))
        throw new HarnessError('INVALID_PLAN_EXTENSION', `Weight for unknown node ${weight.nodeId}`);
    const parentOf = new Map(extension.parentRelationships.map(rel => [rel.childId, rel.parentId]));
    for (const rel of extension.parentRelationships) {
      for (const nodeId of [rel.parentId, rel.childId])
        if (!weightBy.has(nodeId)) throw new HarnessError('INVALID_PLAN_EXTENSION', `Parent relationship references unknown node ${nodeId}`);
    }
    // A node reaches a root by following its single parent; any revisit is a cycle.
    for (const rel of extension.parentRelationships) {
      const seen = new Set<string>([rel.childId]);
      let cursor: string | undefined = rel.childId;
      while ((cursor = parentOf.get(cursor)) !== undefined) {
        if (seen.has(cursor)) throw new HarnessError('INVALID_PLAN_EXTENSION', 'Parent relationships contain a cycle');
        seen.add(cursor);
      }
    }
    // Conservation: children may never exceed the parent's allocation. The
    // undivided remainder stays with the parent as its own work share, so
    // successive partial splits keep the parent's total weight unchanged.
    const children = new Map<string, number>();
    for (const rel of extension.parentRelationships)
      children.set(rel.parentId, (children.get(rel.parentId) ?? 0) + (weightBy.get(rel.childId) ?? 0));
    for (const [parentId, allocated] of children)
      if (allocated > (weightBy.get(parentId) ?? 0))
        throw new HarnessError('INVALID_PLAN_EXTENSION', `Weight conservation violated at ${parentId}: children hold ${allocated} of ${weightBy.get(parentId)} units`);
  }

  /** Rational progress over leaf weight units plus each parent's undivided
   * residual share. Unknown shares stay unknown — no fabricated 0% or 100%. */
  progress(planId: string, statuses: Record<string, 'completed' | 'pending' | 'unknown'>): PlanProgress {
    const extension = this.get(planId);
    if (!extension) throw new HarnessError('INVALID_PLAN_EXTENSION', `No plan extension at ${planId}`);
    const weightBy = new Map(extension.weights.map(weight => [weight.nodeId, weight.units]));
    const delegated = new Map<string, number>();
    for (const rel of extension.parentRelationships)
      delegated.set(rel.parentId, (delegated.get(rel.parentId) ?? 0) + (weightBy.get(rel.childId) ?? 0));
    const progress: PlanProgress = {completed: 0, pending: 0, unknown: 0, total: 0};
    for (const weight of extension.weights) {
      // A node is a leaf unless it delegated; a delegating node's own share
      // is the residual its children did not take.
      const residual = weight.units - (delegated.get(weight.nodeId) ?? 0);
      const units = delegated.has(weight.nodeId) ? residual : weight.units;
      if (units <= 0) continue;
      progress.total += units;
      const status = statuses[weight.nodeId] ?? 'pending';
      if (status === 'completed') progress.completed += units;
      else if (status === 'unknown') progress.unknown += units;
      else progress.pending += units;
    }
    return progress;
  }

  /** Progress report from event deltas since the watermark. The watermark
   * advances only after the report itself is durably recorded; on restart it
   * simply resumes from the stored position. */
  report(planId: string): PlanReport {
    const store = this.hooks.store;
    const {record} = this.canonical(planId);
    let report!: PlanReport;
    store.internal('agentWorkReport', record.threadId, () => {
      const extension = this.get(planId);
      if (!extension) throw new HarnessError('INVALID_PLAN_EXTENSION', `No plan extension at ${planId}`);
      const watermark = extension.reportWatermark;
      const raw = store.eventsAfter(watermark, AGENT_WORK_LIMITS.reportEvents);
      const deltas = raw.filter(event => event.threadId === record.threadId && !SELF_EVENT.test(event.type));
      const reportId = `plan-report:${planId}:${extension.extensionRevision}`;
      // Advance only over the raw window consumed, together with its report.
      // A subscriber can commit more events as soon as this transaction ends.
      const nextWatermark = raw.at(-1)?.seq ?? watermark;
      store.put(REPORT_KIND, reportId, record.threadId, {
        id: reportId, planId, watermark, deltaSeqs: deltas.map(delta => delta.seq), createdAt: new Date().toISOString(),
      });
      store.put(KIND, planId, record.threadId, {...extension, reportWatermark: nextWatermark, extensionRevision: extension.extensionRevision + 1});
      report = {planId, watermark, nextWatermark, deltas, reportId};
    });
    return report;
  }
}
