import { HarnessError, type DataRecord, type Thread } from '../contracts/index.ts';
import { AgentJobSchema, PLAN_LIMITS, PLANNING_PROVENANCE, PlanRecordSchema, PlanRunSchema, planDataId,
  type AgentJob, type PlanRecord, type PlanStep } from '../contracts/planning.ts';

export interface CanonicalPlanJobs {
  threadId: string; runId: string; epoch: number; jobs: AgentJob[];
}
/** Personal host only. Private providers must supply their own explicit scoped adapter. */
export interface CanonicalPlanJobProvider { read(threadId: string): CanonicalPlanJobs }
export interface PlanAgentLane { job: AgentJob; children: PlanAgentLane[] }
export type PlanTimelineStep = Omit<PlanStep, 'status' | 'state' | 'dependsOn' | 'checks'> & {
  status: NonNullable<PlanStep['state']>; reportedStatus: NonNullable<PlanStep['state']>;
  dependsOn: string[]; checks: NonNullable<PlanStep['checks']>; agents: PlanAgentLane[];
};
export interface PlanTimeline {
  id: string; threadId: string; revision: number; run?: PlanRecord['run']; authority: 'proposal' | 'approved';
  steps: PlanTimelineStep[]; unassignedAgents: PlanAgentLane[];
}
export type PlanSnapshot = DataRecord & { value: PlanRecord };
const invalid = () => new HarnessError('INVALID_CANONICAL_PLAN_JOBS', 'Canonical plan jobs must be bounded, scoped and consistently linked');
export const stepState = (step: PlanStep): NonNullable<PlanStep['state']> =>
  step.state ?? (step.status === 'pending' ? 'proposed' : step.status === 'working' ? 'running' : step.status);
export const legacyStepStatus = (state: NonNullable<PlanStep['state']>): PlanStep['status'] =>
  state === 'running' ? 'working' : state === 'completed' || state === 'accepted' ? 'completed' : state === 'proposed' ? 'pending' : 'blocked';

/** No job writes or execution: this validates and joins the host's existing records. */
export function canonicalPlanJobs(plan: PlanRecord, threadId: string, source?: CanonicalPlanJobs): AgentJob[] {
  if (source && (source.threadId !== threadId || !PlanRunSchema.safeParse({ runId: source.runId, epoch: source.epoch }).success
    || !Array.isArray(source.jobs) || source.jobs.length > PLAN_LIMITS.jobs)) throw invalid();
  const jobs = new Map(plan.agents.map(job => [job.id, job]));
  const provided = new Set<string>();
  for (const value of source?.jobs ?? []) {
    const parsed = AgentJobSchema.safeParse(value);
    if (!parsed.success || provided.has(parsed.data.id)) throw invalid();
    const job = parsed.data, old = jobs.get(job.id); provided.add(job.id);
    if (job.stepId && !plan.steps.some(step => step.id === job.stepId)) throw invalid();
    if (old && ['commandId', 'taskId', 'stepId', 'childThreadId', 'parentJobId'].some(key => old[key as keyof AgentJob] !== job[key as keyof AgentJob])) throw invalid();
    if (old && JSON.stringify(old.parentRun) !== JSON.stringify(job.parentRun)) throw invalid();
    jobs.set(job.id, job);
  }
  if (jobs.size > PLAN_LIMITS.jobs || new TextEncoder().encode(JSON.stringify([...jobs.values()])).byteLength > 128 * 1024) throw invalid();
  for (const job of jobs.values()) {
    let current = job, depth = 1; const seen = new Set([job.id]);
    while (current.parentJobId) {
      const parent = jobs.get(current.parentJobId);
      if (!parent || seen.has(parent.id) || ++depth > PLAN_LIMITS.agentDepth || (current.stepId && parent.stepId && current.stepId !== parent.stepId)) throw invalid();
      seen.add(parent.id); current = parent;
    }
  }
  const all = [...jobs.values()];
  for (const job of all) if (job.parentJobId && jobStepId(job, all, plan.steps) !== jobStepId(jobs.get(job.parentJobId)!, all, plan.steps)) throw invalid();
  return all;
}

/** Canonical stepId takes precedence; old host assignment lists remain readable. */
export function jobStepId(job: AgentJob, jobs: AgentJob[], steps: PlanStep[]): string | undefined {
  let current: AgentJob | undefined = job;
  while (current) {
    if (current.stepId) return current.stepId;
    const assigned = steps.find(step => step.agentIds?.includes(current!.id));
    if (assigned) return assigned.id;
    current = jobs.find(parent => parent.id === current!.parentJobId);
  }
  return undefined;
}

export function projectPlanTimeline(record: PlanSnapshot, thread?: Pick<Thread, 'runId' | 'epoch' | 'status'> | null, source?: CanonicalPlanJobs): PlanTimeline {
  const plan = record.value, jobs = canonicalPlanJobs(plan, record.threadId, source);
  const sourceIds = new Set(source?.jobs.map(job => job.id));
  const jobRun = (job: AgentJob) => job.parentRun ?? (sourceIds.has(job.id) ? source : plan.run);
  const lanes = new Map<string, PlanAgentLane>();
  for (const job of jobs) {
    const run = jobRun(job);
    const stale = (plan.runState && plan.runState !== 'running') || (thread && (!thread.runId || (run && (run.runId !== thread.runId || run.epoch !== thread.epoch))));
    lanes.set(job.id, { job: stale && (job.status === 'queued' || job.status === 'working') ? { ...job, status: 'interrupted' } : job, children: [] });
  }
  for (const lane of lanes.values()) if (lane.job.parentJobId) lanes.get(lane.job.parentJobId)!.children.push(lane);
  const assignedTo = (id: string) => jobs.filter(job => jobStepId(job, jobs, plan.steps) === id).map(job => lanes.get(job.id)!);
  const legacyLinear = plan.steps.every(step => step.dependsOn === undefined);
  const ordered: PlanStep[] = [], remaining = [...plan.steps];
  while (remaining.length) {
    const index = remaining.findIndex(step => (step.dependsOn ?? []).every(id => ordered.some(previous => previous.id === id)));
    if (index < 0) throw new HarnessError('INVALID_PLAN_ARGUMENTS', 'Invalid dependency graph');
    ordered.push(remaining.splice(index, 1)[0]);
  }
  const steps = ordered.map((step, index): PlanTimelineStep => {
    const all = assignedTo(step.id), reportedStatus = stepState(step);
    const current = all.filter(lane => { const run = jobRun(lane.job); return !run || !plan.run ||
      run.runId === plan.run.runId && run.epoch === plan.run.epoch; });
    // Model completion cannot hide live, failed or unreviewed canonical work.
    const status = plan.runState === 'failed' && reportedStatus === 'failed' || current.some(lane => lane.job.status === 'failed') ? 'failed'
      : current.some(lane => lane.job.status === 'working' || lane.job.status === 'queued') ? 'running'
      : current.some(lane => lane.job.status === 'cancelled') ? 'cancelled'
      : current.some(lane => lane.job.status === 'interrupted') ? 'interrupted'
      : current.some(lane => lane.job.status === 'needs_review') ? 'review_required' : reportedStatus;
    return { ...step, status, reportedStatus, dependsOn: step.dependsOn ?? (legacyLinear && index ? [plan.steps[index - 1].id] : []),
      checks: step.checks ?? step.requirements.map(check => ({ id: check.id, label: check.label, status: check.completed ? 'reported_passed' : 'pending' })),
      agents: all.filter(lane => !lane.job.parentJobId) };
  });
  return { id: record.id, threadId: record.threadId, revision: record.revision, run: plan.run, authority: plan.authority ?? 'proposal', steps,
    unassignedAgents: [...lanes.values()].filter(lane => !lane.job.parentJobId && !plan.steps.some(step => step.id === jobStepId(lane.job, jobs, plan.steps))) };
}

/** Reconnect/SSE consumers coalesce renders only after this identity/revision/epoch check. */
export function isNewerPlanSnapshot(current: PlanSnapshot | null, incoming: PlanSnapshot): boolean {
  if (incoming.id !== planDataId(incoming.threadId) || incoming.provenance !== PLANNING_PROVENANCE || !Number.isSafeInteger(incoming.revision) || incoming.revision < 1 || !PlanRecordSchema.safeParse(incoming.value).success) return false;
  if (!current) return true;
  if (incoming.id !== current.id || incoming.threadId !== current.threadId || incoming.revision <= current.revision) return false;
  const old = current.value.run, next = incoming.value.run;
  return !old || !!next && (next.epoch > old.epoch || next.epoch === old.epoch && next.runId === old.runId);
}
