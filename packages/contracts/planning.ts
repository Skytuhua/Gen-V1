import { z } from 'zod';

export const PLANNING_PROVENANCE = 'harness:plan';
const id = z.string().min(1).max(160).regex(/^[\w:.-]+$/);
const label = z.string().trim().min(1).max(160);
const brief = z.string().max(1024).refine(value => new TextEncoder().encode(value).byteLength <= 1024, 'Summary must fit within 1024 UTF-8 bytes');
const requirement = z.object({ id, label }).strict();
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;
export const PLAN_LIMITS = { steps: 24, jobs: 24, edges: 96, agentDepth: 8 } as const;
export const PlanStateSchema = z.enum(['proposed', 'running', 'blocked', 'review_required', 'completed', 'accepted', 'failed', 'cancelled', 'interrupted']);
export const PlanRunSchema = z.object({ runId: id, epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const ref = z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export const PlanCheckSchema = z.object({
  id, label, status: z.enum(['pending', 'reported_passed', 'reported_failed', 'verified_passed', 'verified_failed']),
  details: brief.optional(), evidence: z.array(ref).max(8).optional(),
}).strict();
export const PlanRequirementSchema = requirement.extend({ completed: z.boolean() }).strict();
export const PlanStepSchema = z.object({
  id, title: label, status: z.enum(['pending', 'working', 'completed', 'blocked']),
  // status remains the legacy presentation projection; state carries the precise timeline meaning.
  state: PlanStateSchema.optional(), objective: z.string().trim().min(1).max(1000).optional(),
  details: z.string().max(4096).optional(), result: brief.optional(),
  outputs: z.array(z.object({ id, label, ref: ref.optional() }).strict()).max(8).refine(uniqueIds, 'Output IDs must be unique').optional(),
  checks: z.array(PlanCheckSchema).max(16).refine(uniqueIds, 'Check IDs must be unique').optional(),
  blockers: z.array(brief).max(8).optional(),
  dependsOn: z.array(id).max(24).refine(items => new Set(items).size === items.length, 'Dependencies must be unique').optional(),
  requirements: z.array(PlanRequirementSchema).max(16).refine(uniqueIds, 'Requirement IDs must be unique'),
  agentIds: z.array(id).max(24).refine(items => new Set(items).size === items.length, 'Agent IDs must be unique').optional(),
}).strict();
/** Bounded DFS validates both stored plans and model proposals before a transaction can publish them. */
export function validPlanGraph(steps: { id: string; dependsOn?: string[] }[]): boolean {
  const nodes = new Map(steps.map(step => [step.id, step]));
  if (steps.reduce((n, step) => n + (step.dependsOn?.length ?? 0), 0) > PLAN_LIMITS.edges) return false;
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id) || !nodes.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    if (!(nodes.get(id)!.dependsOn ?? []).every(visit)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  return steps.every(step => visit(step.id));
}
export const PlanUpdateSchema = z.object({
  title: label, baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), commandId: id.optional(),
  steps: z.array(PlanStepSchema.extend({
    state: PlanStateSchema.exclude(['accepted']).optional(),
    checks: z.array(PlanCheckSchema.extend({ status: z.enum(['pending', 'reported_passed', 'reported_failed']) })).max(16).refine(uniqueIds, 'Check IDs must be unique').optional(),
  })).max(24).refine(uniqueIds, 'Step IDs must be unique').refine(validPlanGraph, 'Invalid or over-budget dependency graph'),
}).strict();

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const percentage = z.number().min(0).max(100).nullable();
export const AgentUsageSchema = z.object({
  inputTokens: count.optional(), outputTokens: count.optional(), contextTokens: count.optional(), contextWindow: count.optional(),
  cost: z.number().finite().nonnegative().nullable().optional(), sessionPercent: percentage.optional(), weeklyPercent: percentage.optional(),
}).strict();
export const AgentJobSchema = z.object({
  id, commandId: id, taskId: id, name: label, task: z.string().trim().min(1).max(1000),
  stepId: id.optional(), parentJobId: id.optional(), parentRun: PlanRunSchema.optional(), childThreadId:id.optional(), status: z.enum(['queued', 'working', 'completed', 'needs_review', 'failed', 'cancelled', 'interrupted']),
  requirements: z.array(requirement).max(16).refine(uniqueIds, 'Requirement IDs must be unique'),
  completedRequirementIds: z.array(id).max(16), reportedPercent: percentage,
  evidence: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive() }).strict()).max(8).optional(),
  evidenceTruncated: z.boolean().optional(),
  usage: AgentUsageSchema.optional(), summary: brief.optional(), error: brief.optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(job => job.completedRequirementIds.every(key => job.requirements.some(item => item.id === key)) && new Set(job.completedRequirementIds).size === job.completedRequirementIds.length, 'Completed requirements must be unique declared IDs');
export const PlanRecordSchema = z.object({
  version: z.literal(1), title: label,
  run: PlanRunSchema.optional(), authority: z.enum(['proposal', 'approved']).optional(),
  runState: z.enum(['running', 'review_required', 'cancelled', 'interrupted', 'failed']).optional(),
  steps: z.array(PlanStepSchema).max(24).refine(uniqueIds, 'Step IDs must be unique').refine(validPlanGraph, 'Invalid or over-budget dependency graph'),
  agents: z.array(AgentJobSchema).max(24).refine(uniqueIds, 'Agent IDs must be unique'),
}).strict().refine(plan => plan.steps.every(step => (step.agentIds ?? []).every(key => plan.agents.some(agent => agent.id === key))), 'Steps may reference only existing jobs');

export const DelegateSchema = z.object({
  commandId: id,
  tasks: z.array(z.object({
    id, name: label, task: z.string().trim().min(1).max(1000), prompt: z.string().trim().min(1).max(8000), stepId: id.optional(),
    requirements: z.array(requirement).max(16).refine(uniqueIds, 'Requirement IDs must be unique'),
  }).strict()).min(1).max(3).refine(uniqueIds, 'Task IDs must be unique within the batch'),
}).strict();
export const AgentProgressSchema = z.object({
  completedRequirementIds: z.array(id).max(16).refine(items => new Set(items).size === items.length, 'Completed IDs must be unique').optional(),
  reportedPercent: percentage.optional(),
  summary: brief.optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Report at least one progress value');

export type PlanRecord = z.infer<typeof PlanRecordSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type AgentJob = z.infer<typeof AgentJobSchema>;
export type PlanUpdate = z.infer<typeof PlanUpdateSchema>;
export type DelegateArgs = z.infer<typeof DelegateSchema>;
export type AgentProgress = z.infer<typeof AgentProgressSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/** A checklist takes precedence over a self-reported estimate. Unknown is never zero. */
export function agentProgress(job: Pick<AgentJob, 'requirements' | 'completedRequirementIds' | 'reportedPercent'>): number | null {
  return job.requirements.length ? Math.round(100 * job.completedRequirementIds.length / job.requirements.length) : job.reportedPercent;
}
/** Stable identity; this value travels in existing DataRecord / SSE projections. */
export function planDataId(threadId: string): string { return `plan:${threadId}`; }
