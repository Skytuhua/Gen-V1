import type { Snapshot } from '../../../packages/contracts/index.ts';
import { selectPlanRecord } from './plan-visibility';

/** Presentation projection only; never infer live jobs or a plan from prose. */
export function contextCompanions(snapshot: Pick<Snapshot, 'threads' | 'data'>, threadId?: string) {
  const agents = threadId ? snapshot.threads.filter(thread => thread.kind === 'delegate' && thread.parentThreadId === threadId).toSorted((a, b) => Number(b.status === 'working') - Number(a.status === 'working')) : [];
  const sideConversations = threadId ? snapshot.threads.filter(thread => thread.kind === 'side' && (thread.sideParentId ?? thread.parentThreadId) === threadId) : [];
  const record = selectPlanRecord(snapshot, threadId), plan = record?.plan;
  const current = plan?.steps.find(step => step.status === 'working') ?? plan?.steps.find(step => step.status === 'blocked') ?? plan?.steps.find(step => step.status === 'pending');
  return { agents, sideConversations, plan: plan ? { title: plan.title, revision: record!.revision, completed: plan.steps.filter(step => step.status === 'completed').length, total: plan.steps.length, currentStep: current?.title ?? null, blocked: current?.status === 'blocked' } : null };
}
