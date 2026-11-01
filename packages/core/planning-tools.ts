import { z } from 'zod';
import { AgentProgressSchema, DelegateSchema, PlanUpdateSchema } from '../contracts/planning.ts';

/** Data only: the Pi adapter converts these JSON schemas to its installed TypeBox tool ABI. */
export const PLANNING_TOOLS = [
  { name: 'plan_update', description: 'Create or update the task plan when useful: concise steps and explicit acceptance requirements. Preserve stable step/requirement IDs. Agents and their execution statuses are host-owned. This presents a plan; it does not execute work or grant authority.', parameters: z.toJSONSchema(PlanUpdateSchema) as Record<string, unknown> },
  { name: 'task_delegate', description: 'Assign 1–3 parallel read-only Pi readers to bounded independent investigations using the selected subscription model and existing thread grants. The tool awaits all readers and streams actual job/progress/usage into the plan. Give each task explicit requirement IDs. Readers cannot modify files, prepare/execute operations, ask the user, publish UI or delegate. Use a stable explicit commandId for retries. A crash-interrupted ID cannot restart or bill again; authorize new work with a new ID. Inspect returned evidence and needs_review outcomes before acting.', parameters: z.toJSONSchema(DelegateSchema) as Record<string, unknown> },
  { name: 'agent_progress', description: 'Auxiliary-reader only: report actual completed declared requirement IDs or an explicit self-reported percentage when no checklist is available. Never infer progress from elapsed time. This does not claim completion; call task_finish after the final report with a concise outcome and evidence.', parameters: z.toJSONSchema(AgentProgressSchema) as Record<string, unknown> },
] as const;
