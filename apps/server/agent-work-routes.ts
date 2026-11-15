import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {HarnessError, type DataRecord, type Thread} from '../../packages/contracts/index.ts';
import type {AgentWorkRole, AgentWorkV1} from '../../packages/contracts/agent-work.ts';
import type {Service} from '../../packages/core/service.ts';

const id = z.string().min(1).max(200).regex(/^[\w:.-]+$/);
const roles: AgentWorkRole[] = ['PLAN_READ', 'RESEARCH_READ', 'CODE_WORKTREE', 'QA'];

/** M09 read-model routes. Mutations go through /api/commands as agentWork.*
 * commands so they share the host's session, authority and dedupe plumbing.
 * Personal host only, beneath buildServer's existing gates. */
export function registerAgentWorkRoutes(app: FastifyInstance, service: Service) {
  const store = service.store;
  const taskThread = (taskId: string): Thread => {
    const thread = store.get<Thread>('thread', taskId);
    if (!thread || thread.kind === 'delegate') throw new HarnessError('NOT_FOUND', 'Task unavailable');
    return thread;
  };
  /** Evidence freshness: declared refs resolved against current durable
   * revisions — stale refs are counted, never hidden. */
  const freshness = (work: AgentWorkV1) => {
    const output = work.outputRef ? store.get<DataRecord>('data', work.outputRef.id) : null;
    const refs: {id: string; revision: number}[] = output !== null && output.revision === work.outputRef!.revision
      ? ((output.value as {evidenceRefs?: {id: string; revision: number}[]}).evidenceRefs ?? []) : [];
    const stale = refs.filter(ref => store.get<DataRecord>('data', ref.id)?.revision !== ref.revision).length;
    return {refs: refs.length, stale, outputRevision: output !== null && output.revision === work.outputRef?.revision ? output.revision : null};
  };
  const workRow = (work: AgentWorkV1) => {
    const grants = service.agentWork.dispatchedGrants(work.workId) ?? [];
    return {
      workId: work.workId, role: work.role, state: work.state, failureReason: work.failureReason,
      owner: work.childOwner, parentThreadId: work.parentOwner.threadId,
      worktree: grants.find(grant => grant.writable)?.path ?? null,
      grants: grants.map(grant => ({id: grant.id, label: grant.label, writable: grant.writable})),
      budget: work.budget, outputRef: work.outputRef, repairAttempts: work.repairAttempts,
      evidence: freshness(work),
      steerSupported: work.state === 'RUNNING' && service.agentWork.supportsLiveSteer(work.workId),
      blockedReason: work.state === 'WAITING_HUMAN' ? 'waiting on human' : work.failureReason ?? null,
      updatedAt: work.updatedAt, revision: work.revision,
    };
  };
  app.get('/api/agent-work', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const {taskId} = z.strictObject({taskId: id}).parse(request.query);
    taskThread(taskId);
    return {
      enabled: true,
      roles: Object.fromEntries(roles.map(role => [role, service.agentWork.roleAvailability({threadId: taskId, runId: '', epoch: 0}, role)])),
      works: service.agentWork.listForParent(taskId).map(workRow),
      budget: service.agentWork.budgetLedger(),
    };
  });
  app.get('/api/agent-work/output', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const {taskId, workId} = z.strictObject({taskId: id, workId: id}).parse(request.query);
    taskThread(taskId);
    const work = service.agentWork.inspect(workId);
    if (!work || work.parentOwner.threadId !== taskId) throw new HarnessError('NOT_FOUND', 'Work unavailable');
    const output = work.outputRef ? store.get<DataRecord>('data', work.outputRef.id) : null;
    return {workId, outputRef: work.outputRef, output: output?.value ?? null, lateArtifacts: service.agentWork.lateArtifacts(workId).length};
  });
  app.get('/api/agent-work/inputs', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const {taskId, targetThreadId} = z.strictObject({taskId: id, targetThreadId: id}).parse(request.query);
    taskThread(taskId);
    // Queued entries plus the recent non-queued history so the UI shows the
    // actual delivery status — never an optimistic Delivered.
    const all = (store.all<{inputId: string; taskId: string; targetOwner: {threadId: string}; kind: string; order: number; delivery: string; dedupeKey: string; error?: string; createdAt: string; updatedAt: string}>('agentInputV1'))
      .filter(record => record.taskId === taskId && record.targetOwner.threadId === targetThreadId)
      .sort((a, b) => a.order - b.order || a.inputId.localeCompare(b.inputId))
      .slice(-24);
    return {inputs: all.map(record => ({...record, text: service.agentWork.inbox.text(record.inputId), editable: record.delivery === 'ACCEPTED'}))};
  });
  app.get('/api/agent-work/messages', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const {taskId} = z.strictObject({taskId: id}).parse(request.query);
    taskThread(taskId);
    const title = (threadId: string) => store.get<Thread>('thread', threadId)?.title ?? threadId;
    return {messages: service.agentWork.inbox.messages(taskId).map(message => ({
      ...message, senderTitle: title(message.senderOwner.threadId), recipientTitle: title(message.recipientOwner.threadId),
    }))};
  });
  app.get('/api/agent-work/plan', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const {taskId} = z.strictObject({taskId: id}).parse(request.query);
    taskThread(taskId);
    const planId = `plan:${taskId}`;
    const extension = service.planExtensions.get(planId);
    if (!extension) return {extension: false, planId};
    const record = store.get<DataRecord>('data', planId);
    const statuses = Object.fromEntries(((record?.value as {steps?: {id: string; status: string}[]; agents?: {id: string; status: string}[]}) ?? {})
      && [...((record!.value as {steps?: {id: string; status: string}[]}).steps ?? []), ...((record!.value as {agents?: {id: string; status: string}[]}).agents ?? [])]
        .map(node => [node.id, node.status === 'completed' ? 'completed' : node.status === 'unknown' ? 'unknown' : 'pending'] as const));
    return {extension: true, planId, weights: extension.weights, parentRelationships: extension.parentRelationships,
      progress: service.planExtensions.progress(planId, statuses)};
  });
}
