import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {Store, digest} from '../storage/store.ts';
import {HarnessError, type DataRecord, type ResourceGrant, type RunContext, type Thread, type ToolCall} from '../contracts/index.ts';
import type {CapabilityFlagKey} from './capability-flags.ts';
import {AgentInbox} from './agent-inbox.ts';
import {
  AGENT_WORK_LIMITS,
  AGENT_WORK_TERMINAL_STATES,
  AgentWorkAdmissionV1Schema,
  AgentWorkV1Schema,
  agentResultSchemaFor,
  type AgentWorkAdmissionV1,
  type AgentWorkRole,
  type AgentWorkV1,
} from '../contracts/agent-work.ts';

/** Live-dispatch surface over the native runtime adapter. The coordinator
 * owns ordering, dedupe and bookkeeping; the adapter owns model history. */
export interface AgentWorkChild {
  /** True only when the adapter declares a demonstrated live-steer channel. */
  supportsLiveSteer: boolean;
  /** Resolves with the adapter's dispatch acknowledgement (entry), rejects on ambiguity or failure. */
  send(input: {inputId: string; kind: string; text: string}): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CodeWorktreeProof { worktreeId: string; path: string; profileDigest: string }
export interface QaProof { verifierId: string }

export interface AgentWorkHooks {
  store: Store;
  assertRun: (ctx: RunContext) => void;
  isEnabled: (key: CapabilityFlagKey) => boolean;
  /** Registered host capabilities proving a role may run. Absent => ROLE_UNAVAILABLE. */
  roleProofs?: {
    codeWorktree?: (ctx: RunContext) => Promise<CodeWorktreeProof> | CodeWorktreeProof;
    qa?: (ctx: RunContext) => Promise<QaProof> | QaProof;
  };
  /** Effect entry points scoped to each gated role. Read roles never reach these. */
  roleHandlers?: {
    codeWorktree?: (call: ToolCall, work: AgentWorkV1) => Promise<unknown>;
    qa?: (call: ToolCall, work: AgentWorkV1) => Promise<unknown>;
  };
  /** Read-only resource access for the read roles; always invoked with write=false. */
  resourceResolver?: (grant: ResourceGrant, write: boolean, call: ToolCall) => Promise<unknown> | unknown;
  /** Global reservation limits; failed and cancelled work still counts. */
  globalBudget?: {tokens: number | null; ms: number | null};
  runtimeFactory?: (work: AgentWorkV1, spec: {prompt: string; grants: ResourceGrant[]; allowSpawn: false}) => Promise<AgentWorkChild> | AgentWorkChild;
}

interface LiveWork { child: AgentWorkChild; runId: string; delivery: Promise<void> }
interface BudgetLedger { reservedTokens: number; reservedMs: number; spentTokens: number; spentMs: number; admitted: number; completed: number; failed: number; cancelled: number; interrupted: number }
interface AdmissionRecord { workId: string; commandId: string; admission: AgentWorkAdmissionV1; bindingDigest: string; grants: ResourceGrant[]; proofMeta: Record<string, unknown>; createdAt: string }
interface WorkArtifact { id: string; workId: string; kind: 'raw-output' | 'late-output'; value: string; createdAt: string }

/** Path containment for grant paths, normalized for Windows separators and
 * case; a grant outside the proven worktree loses its writable bit. */
function pathWithin(candidate: string, root: string): boolean {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const parent = norm(root), child = norm(candidate);
  return child === parent || child.startsWith(parent + '/');
}

const WORK_KIND = 'agentWork';
const ADMISSION_KIND = 'agentWorkAdmission';
const ARTIFACT_KIND = 'agentWorkArtifact';
const BUDGET_KIND = 'agentWorkBudget';
const BUDGET_ID = 'global';
const OUTPUT_PROVENANCE = 'harness:agent-output';
const outId = (workId: string) => `agent-output:${workId}`;

const ajv = new Ajv({allErrors: true, strict: false, validateFormats: false});

/** Tools each role may call. Anything else is denied before any effect. */
const READ_TOOLS = new Set(['repository_files', 'repository_read', 'repository_status', 'repository_diff', 'repository_log', 'text_import', 'knowledge_publish', 'skills_list', 'skill_view']);
const QA_TOOLS = new Set(['verification.run', 'verification.observe', 'context.read']);
const WORKTREE_TOOLS = new Set(['worktree.read', 'worktree.write', 'worktree.git']);

const EMPTY_LEDGER: BudgetLedger = {reservedTokens: 0, reservedMs: 0, spentTokens: 0, spentMs: 0, admitted: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0};

/** M09 typed multi-agent work coordinator. The host stays the sole SQLite
 * writer; children receive a strict authority subset computed as
 * parent grants ∩ role policy ∩ project/worktree binding, revalidated on
 * every dispatch and on resume. */
export class AgentWorkCoordinator {
  readonly inbox: AgentInbox;
  private readonly live = new Map<string, LiveWork>();
  constructor(private readonly hooks: AgentWorkHooks) {
    this.inbox = new AgentInbox({store: hooks.store});
  }

  private enabled(): boolean { return this.hooks.isEnabled('agents.workV1'); }

  private parent(ctx: RunContext): Thread {
    const thread = this.hooks.store.get<Thread>('thread', ctx.threadId);
    if (!thread) throw new HarnessError('CAPABILITY_DENIED', `Unknown parent thread ${ctx.threadId}`);
    // No recursion: a delegate child can never admit further work.
    if (thread.kind === 'delegate') throw new HarnessError('CAPABILITY_DENIED', 'Delegate threads cannot admit child work');
    return thread;
  }

  roleAvailability(_ctx: RunContext, role: AgentWorkRole): {available: boolean; reason?: string} {
    if (!this.enabled()) return {available: false, reason: 'agents.workV1 disabled'};
    switch (role) {
      case 'PLAN_READ':
      case 'RESEARCH_READ': return {available: true};
      case 'CODE_WORKTREE':
        if (!this.hooks.isEnabled('workspace.writeDelegateV1')) return {available: false, reason: 'workspace.writeDelegateV1 disabled'};
        if (!this.hooks.roleProofs?.codeWorktree) return {available: false, reason: 'no managed-worktree profile proof'};
        return {available: true};
      case 'QA':
        if (!this.hooks.roleProofs?.qa) return {available: false, reason: 'no verification capability proof'};
        return {available: true};
    }
  }

  private ledger(): BudgetLedger { return this.hooks.store.get<BudgetLedger>(BUDGET_KIND, BUDGET_ID) ?? {...EMPTY_LEDGER}; }

  private worksLive(threadId: string): AgentWorkV1[] {
    return this.hooks.store.all<AgentWorkV1>(WORK_KIND).filter(work => work.parentOwner.threadId === threadId && !AGENT_WORK_TERMINAL_STATES.has(work.state));
  }

  /** Grants the child may actually hold right now: named parent resources
   * intersected with role policy and, for CODE_WORKTREE, the proven
   * worktree's path bound. Recomputed at every dispatch so revoked or
   * re-scoped parent rights never leak into a child. */
  private async admittedAuthority(ctx: RunContext, spec: {role: AgentWorkRole; grantSubset: string[]}, denyCode: string): Promise<{grants: ResourceGrant[]; proofMeta: Record<string, unknown>}> {
    const parentGrants = this.hooks.store.all<ResourceGrant>('resource', ctx.threadId);
    const selected = spec.grantSubset.map(id => {
      const grant = parentGrants.find(item => item.id === id);
      if (!grant) throw new HarnessError(denyCode, `Grant ${id} is not a parent-thread resource`);
      return grant;
    });
    const readOnly = spec.role === 'PLAN_READ' || spec.role === 'RESEARCH_READ';
    const proofMeta: Record<string, unknown> = {};
    const worktreeProof = spec.role === 'CODE_WORKTREE' ? await this.hooks.roleProofs!.codeWorktree!(ctx) : null;
    if (worktreeProof) proofMeta.worktree = worktreeProof;
    if (spec.role === 'QA') proofMeta.qa = await this.hooks.roleProofs!.qa!(ctx);
    const grants = selected.map(grant => (readOnly || (worktreeProof !== null && !pathWithin(grant.path, worktreeProof.path))) ? {...grant, writable: false} : grant);
    return {grants, proofMeta};
  }

  async admit(ctx: RunContext, raw: unknown, signal: AbortSignal): Promise<AgentWorkV1> {
    if (!this.enabled()) throw new HarnessError('CAPABILITY_DENIED', 'agents.workV1 is disabled');
    this.hooks.assertRun(ctx);
    const parent = this.parent(ctx);
    const spec = AgentWorkAdmissionV1Schema.parse(raw);
    const availability = this.roleAvailability(ctx, spec.role);
    if (!availability.available) throw new HarnessError('ROLE_UNAVAILABLE', `Role ${spec.role} is unavailable: ${availability.reason}`);
    const priorAdmission = this.hooks.store.get<AdmissionRecord>(ADMISSION_KIND, spec.workId);
    if (priorAdmission?.commandId !== spec.commandId) {
      if (this.hooks.store.get<AgentWorkV1>(WORK_KIND, spec.workId)) throw new HarnessError('INVALID_AGENT_WORK', `Work ${spec.workId} already exists`);
      if (this.hooks.store.get<Thread>('thread', spec.childThreadId)) throw new HarnessError('INVALID_AGENT_WORK', `Child thread ${spec.childThreadId} already exists`);
    }
    if (this.worksLive(ctx.threadId).length >= AGENT_WORK_LIMITS.concurrent) throw new HarnessError('AGENT_LIMIT', `At most ${AGENT_WORK_LIMITS.concurrent} active work items run in parallel`);
    const allWorks = this.hooks.store.all<AgentWorkV1>(WORK_KIND).filter(work => work.parentOwner.threadId === ctx.threadId);
    if (allWorks.length >= AGENT_WORK_LIMITS.worksPerTask) throw new HarnessError('AGENT_LIMIT', `Task ${ctx.threadId} has reached ${AGENT_WORK_LIMITS.worksPerTask} work items`);
    if (signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Admission was cancelled');

    // Authority subset: parent grants ∩ role policy ∩ worktree binding,
    // computed against the current parent so revoked or re-scoped rights
    // never reach the child. Role proofs are bound into the admission.
    const {grants: effectiveGrants, proofMeta} = await this.admittedAuthority(ctx, spec, 'CAPABILITY_DENIED');
    this.hooks.assertRun(ctx);

    // Global budget reservation; completed, failed and cancelled work all
    // still count against the lifetime budget.
    const ledger = this.ledger();
    if (spec.budget.tokens !== null && this.hooks.globalBudget?.tokens != null && ledger.reservedTokens + ledger.spentTokens + spec.budget.tokens > this.hooks.globalBudget.tokens)
      throw new HarnessError('AGENT_BUDGET_EXHAUSTED', `Token reservation ${spec.budget.tokens} exceeds the remaining agent budget`);
    if (spec.budget.ms !== null && this.hooks.globalBudget?.ms != null && ledger.reservedMs + ledger.spentMs + spec.budget.ms > this.hooks.globalBudget.ms)
      throw new HarnessError('AGENT_BUDGET_EXHAUSTED', `Wall-time reservation ${spec.budget.ms} exceeds the remaining agent budget`);

    const now = new Date().toISOString();
    const work: AgentWorkV1 = AgentWorkV1Schema.parse({
      version: 1,
      workId: spec.workId,
      parentOwner: {threadId: ctx.threadId, runId: ctx.runId, epoch: ctx.epoch},
      childOwner: {threadId: spec.childThreadId, runId: null, epoch: 1},
      role: spec.role,
      inputContractDigest: digest(spec),
      expectedOutputSchema: spec.expectedOutputSchema,
      grantSubset: spec.grantSubset,
      budget: spec.budget,
      state: 'QUEUED',
      outputRef: null,
      repairAttempts: 0,
      createdSeq: this.hooks.store.sequence,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
    const bindingDigest = digest({modelId: parent.modelId, accountId: parent.accountId ?? null, projectId: parent.projectId, workspaceId: parent.workspaceId});
    const childThread: Thread = {
      id: spec.childThreadId, title: `agent-work:${spec.workId}`, projectName: parent.projectName,
      createdAt: now, updatedAt: now, status: 'working', epoch: 1, runId: null,
      modelId: parent.modelId, sessionPath: null, accountId: parent.accountId,
      kind: 'delegate', parentThreadId: ctx.threadId, jobId: spec.workId,
      projectId: parent.projectId, workspaceId: parent.workspaceId,
    };
    const receipt = this.hooks.store.command({id: spec.commandId, type: 'agentWork.admit', threadId: ctx.threadId, payload: spec as unknown as Record<string, unknown>}, () => {
      this.hooks.store.put(WORK_KIND, work.workId, ctx.threadId, work);
      this.hooks.store.put('thread', childThread.id, childThread.id, childThread);
      const admission: AdmissionRecord = {workId: work.workId, commandId: spec.commandId, admission: spec, bindingDigest, grants: effectiveGrants, proofMeta, createdAt: now};
      this.hooks.store.put(ADMISSION_KIND, work.workId, ctx.threadId, admission);
      const next = this.ledger();
      next.reservedTokens += spec.budget.tokens ?? 0; next.reservedMs += spec.budget.ms ?? 0; next.admitted += 1;
      this.hooks.store.put(BUDGET_KIND, BUDGET_ID, null, next);
      return work;
    });
    const admitted = (receipt.result as AgentWorkV1) ?? work;
    if (admitted.workId !== spec.workId) return admitted; // command replay: already admitted.
    if (this.hooks.store.get<AgentWorkV1>(WORK_KIND, spec.workId)!.state !== 'QUEUED')
      return this.hooks.store.get<AgentWorkV1>(WORK_KIND, spec.workId)!; // replayed command; nothing to dispatch.
    return this.dispatch(work, spec, effectiveGrants);
  }

  private async dispatch(work: AgentWorkV1, spec: AgentWorkAdmissionV1, grants: ResourceGrant[]): Promise<AgentWorkV1> {
    try {
      const child = await (this.hooks.runtimeFactory?.(work, {prompt: spec.prompt, grants, allowSpawn: false})
        ?? Promise.resolve<AgentWorkChild>({supportsLiveSteer: false, send: async () => {}, cancel: async () => {}, dispose: async () => {}}));
      // A stop/revocation landing while the runtime started cancels the work;
      // a late startup must never overwrite that terminal state or send START.
      const current = this.hooks.store.get<AgentWorkV1>(WORK_KIND, work.workId);
      if (!current || current.state !== 'QUEUED') { void child.dispose(); return current ?? work; }
      const runId = randomUUID();
      this.live.set(work.workId, {child, runId, delivery: Promise.resolve()});
      const running: AgentWorkV1 = {...current, state: 'RUNNING', childOwner: {...current.childOwner, runId}, updatedAt: new Date().toISOString(), revision: current.revision + 1};
      this.hooks.store.internal('agentWork.running', current.parentOwner.threadId, () => {
        this.hooks.store.put(WORK_KIND, work.workId, current.parentOwner.threadId, running);
        const thread = this.hooks.store.get<Thread>('thread', current.childOwner.threadId);
        if (thread) this.hooks.store.put('thread', thread.id, thread.id, {...thread, runId, status: 'working'});
      });
      try { await child.send({inputId: `start:${work.workId}`, kind: 'START', text: spec.prompt}); }
      catch (error) { this.finish(work.workId, 'FAILED', {failureReason: 'RUNTIME_FAILURE'}); throw new HarnessError('RUNTIME_FAILURE', 'Child dispatch failed', error); }
      return this.hooks.store.get<AgentWorkV1>(WORK_KIND, work.workId)!;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      this.finish(work.workId, 'FAILED', {failureReason: 'RUNTIME_FAILURE'});
      throw error;
    }
  }

  private finish(workId: string, state: 'FAILED' | 'CANCELLED' | 'INTERRUPTED', extra: Partial<AgentWorkV1>): void {
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work || AGENT_WORK_TERMINAL_STATES.has(work.state)) return;
    const next: AgentWorkV1 = {...work, ...extra, state, updatedAt: new Date().toISOString(), revision: work.revision + 1};
    this.hooks.store.internal('agentWork.' + state.toLowerCase(), work.parentOwner.threadId, () => {
      this.hooks.store.put(WORK_KIND, workId, work.parentOwner.threadId, next);
      const ledger = this.ledger();
      ledger.reservedTokens -= work.budget.tokens ?? 0; ledger.reservedMs -= work.budget.ms ?? 0;
      ledger.spentTokens += work.budget.tokens ?? 0; ledger.spentMs += work.budget.ms ?? 0;
      if (state === 'FAILED') ledger.failed += 1; else if (state === 'CANCELLED') ledger.cancelled += 1; else ledger.interrupted += 1;
      this.hooks.store.put(BUDGET_KIND, BUDGET_ID, null, ledger);
      const thread = this.hooks.store.get<Thread>('thread', work.childOwner.threadId);
      if (thread) this.hooks.store.put('thread', thread.id, thread.id, {...thread, status: state === 'CANCELLED' ? 'stopped' : 'interrupted'});
    });
  }

  private releaseLive(workId: string, cancel: boolean): void {
    const live = this.live.get(workId);
    if (!live) return;
    this.live.delete(workId);
    void (cancel ? live.child.cancel() : Promise.resolve()).finally(() => void live.child.dispose());
  }

  private artifact(workId: string, kind: WorkArtifact['kind'], value: unknown): WorkArtifact {
    const record: WorkArtifact = {id: `${kind}:${workId}:${randomUUID()}`, workId, kind,
      value: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, AGENT_WORK_LIMITS.rawOutputBytes),
      createdAt: new Date().toISOString()};
    this.hooks.store.internal('agentWork.artifact', this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId)?.parentOwner.threadId ?? null,
      () => this.hooks.store.put(ARTIFACT_KIND, record.id, null, record));
    return record;
  }

  private validateOutput(work: AgentWorkV1, raw: unknown): {valid: boolean; issues: string; parsed?: unknown} {
    const issues: string[] = [];
    const compiled = ajv.compile(work.expectedOutputSchema);
    if (!compiled(raw)) issues.push(...(compiled.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`));
    const role = agentResultSchemaFor(work.role).safeParse(raw);
    if (!role.success) issues.push(...role.error.issues.map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`));
    return issues.length ? {valid: false, issues: issues.slice(0, 8).join('; ')} : {valid: true, issues: '', parsed: role.success ? role.data : raw};
  }

  /** Strict per-role result intake. One repair is offered; a second invalid
   * result fails OUTPUT_SCHEMA_INVALID with the raw output kept privately. */
  async submitResult(workId: string, supplied: RunContext, raw: unknown): Promise<AgentWorkV1> {
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (AGENT_WORK_TERMINAL_STATES.has(work.state)) { this.artifact(workId, 'late-output', raw); return work; }
    const live = this.live.get(workId);
    if (!live || supplied.threadId !== work.childOwner.threadId || supplied.runId !== live.runId || supplied.epoch !== work.childOwner.epoch)
      throw new HarnessError('CANCELLED_RUN', 'Result does not match the live child run');
    const verdict = this.validateOutput(work, raw);
    if (!verdict.valid) {
      if (work.repairAttempts === 0) {
        const repairing: AgentWorkV1 = {...work, repairAttempts: 1, updatedAt: new Date().toISOString(), revision: work.revision + 1};
        this.hooks.store.internal('agentWork.repair', work.parentOwner.threadId, () => this.hooks.store.put(WORK_KIND, workId, work.parentOwner.threadId, repairing));
        this.artifact(workId, 'raw-output', raw);
        await live.child.send({inputId: `repair:${workId}`, kind: 'REPAIR', text: `Your result was rejected by the declared output contract: ${verdict.issues}. Submit once more against the same schema.`});
        return this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId)!;
      }
      this.artifact(workId, 'raw-output', raw);
      this.releaseLive(workId, true);
      this.finish(workId, 'FAILED', {failureReason: 'OUTPUT_SCHEMA_INVALID'});
      return this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId)!;
    }
    const now = new Date().toISOString();
    const outputRef = {id: outId(workId), revision: 1};
    this.releaseLive(workId, false);
    this.hooks.store.internal('agentWork.completed', work.parentOwner.threadId, () => {
      this.hooks.store.put('data', outputRef.id, work.parentOwner.threadId, {id: outputRef.id, threadId: work.parentOwner.threadId, revision: 1, value: verdict.parsed, provenance: OUTPUT_PROVENANCE, createdAt: now});
      const next: AgentWorkV1 = {...work, state: 'COMPLETED_REPORTED', outputRef, updatedAt: now, revision: work.revision + 1};
      this.hooks.store.put(WORK_KIND, workId, work.parentOwner.threadId, next);
      const ledger = this.ledger();
      ledger.reservedTokens -= work.budget.tokens ?? 0; ledger.reservedMs -= work.budget.ms ?? 0;
      ledger.spentTokens += work.budget.tokens ?? 0; ledger.spentMs += work.budget.ms ?? 0; ledger.completed += 1;
      this.hooks.store.put(BUDGET_KIND, BUDGET_ID, null, ledger);
      const thread = this.hooks.store.get<Thread>('thread', work.childOwner.threadId);
      if (thread) this.hooks.store.put('thread', thread.id, thread.id, {...thread, status: 'completed'});
    });
    return this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId)!;
  }

  /** Host re-check of reported evidence; reported output can never set VERIFIED. */
  async verify(ctx: RunContext, workId: string): Promise<AgentWorkV1> {
    this.hooks.assertRun(ctx);
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work || work.parentOwner.threadId !== ctx.threadId) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (work.state === 'VERIFIED') return work;
    if (work.state !== 'COMPLETED_REPORTED') throw new HarnessError('INVALID_AGENT_WORK', `Work ${workId} is ${work.state}, not COMPLETED_REPORTED`);
    const record = this.hooks.store.get<DataRecord>('data', work.outputRef!.id);
    if (!record || record.revision !== work.outputRef!.revision || record.provenance !== OUTPUT_PROVENANCE)
      throw new HarnessError('INVALID_AGENT_EVIDENCE', 'Reported output record is missing or changed');
    const parsed = agentResultSchemaFor(work.role).safeParse(record.value);
    if (!parsed.success) throw new HarnessError('INVALID_AGENT_EVIDENCE', 'Reported output no longer satisfies its contract');
    for (const ref of (parsed.data as {evidenceRefs: {id: string; revision: number}[]}).evidenceRefs) {
      const evidence = this.hooks.store.get<DataRecord>('data', ref.id);
      if (!evidence || evidence.threadId !== work.parentOwner.threadId || evidence.revision !== ref.revision)
        throw new HarnessError('INVALID_AGENT_EVIDENCE', `Evidence ${ref.id}@${ref.revision} does not resolve inside the parent task`);
    }
    const next: AgentWorkV1 = {...work, state: 'VERIFIED', updatedAt: new Date().toISOString(), revision: work.revision + 1};
    this.hooks.store.internal('agentWork.verified', work.parentOwner.threadId, () => this.hooks.store.put(WORK_KIND, workId, work.parentOwner.threadId, next));
    return next;
  }

  markWaitingHuman(ctx: RunContext, workId: string): AgentWorkV1 {
    this.hooks.assertRun(ctx);
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work || work.parentOwner.threadId !== ctx.threadId) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (AGENT_WORK_TERMINAL_STATES.has(work.state)) throw new HarnessError('INVALID_AGENT_WORK', `Work ${workId} is already ${work.state}`);
    const next: AgentWorkV1 = {...work, state: 'WAITING_HUMAN', updatedAt: new Date().toISOString(), revision: work.revision + 1};
    this.hooks.store.internal('agentWork.waiting', work.parentOwner.threadId, () => this.hooks.store.put(WORK_KIND, workId, work.parentOwner.threadId, next));
    return next;
  }

  /** Tool dispatch for a live child. Everything outside the role's allowlist
   * is denied before any effect: no delegation, no scripts, no MCP, no
   * sibling-worktree handles. */
  async invokeTool(workId: string, supplied: RunContext, call: ToolCall): Promise<unknown> {
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (call.name === 'agent_result') return this.submitResult(workId, supplied, call.args.output);
    const live = this.live.get(workId);
    if (!live || AGENT_WORK_TERMINAL_STATES.has(work.state)
      || supplied.threadId !== work.childOwner.threadId || supplied.runId !== live.runId || supplied.epoch !== work.childOwner.epoch)
      throw new HarnessError('CANCELLED_RUN', 'Tool call does not match the live child run');
    if (call.name === 'agent_progress') return {acknowledged: true};
    const admission = this.hooks.store.get<AdmissionRecord>(ADMISSION_KIND, workId)!;
    const readOnly = work.role === 'PLAN_READ' || work.role === 'RESEARCH_READ';
    if (readOnly) {
      if (!READ_TOOLS.has(call.name)) throw new HarnessError('AGENT_TOOL_DENIED', `Tool ${call.name} is outside the ${work.role} allowlist`);
      if (call.args.write === true || call.args.writable === true) throw new HarnessError('AGENT_TOOL_DENIED', 'Read roles hold no write authority');
      const grant = admission.grants.find(item => item.id === call.args.grantId);
      if (!grant) throw new HarnessError('AGENT_TOOL_DENIED', `Grant ${String(call.args.grantId)} is outside the child's authority subset`);
      const current = this.hooks.store.get<ResourceGrant>('resource', grant.id);
      if (!current || current.threadId !== work.parentOwner.threadId)
        throw new HarnessError('PERMISSION_REVOKED', `Grant ${grant.id} is no longer held by the parent`);
      if (!this.hooks.resourceResolver) throw new HarnessError('AGENT_TOOL_DENIED', 'No read resolver is bound for this host');
      return this.hooks.resourceResolver({...current, writable: grant.writable}, false, call);
    }
    if (work.role === 'QA') {
      if (!QA_TOOLS.has(call.name) || !this.hooks.roleHandlers?.qa) throw new HarnessError('AGENT_TOOL_DENIED', `Tool ${call.name} is outside the QA allowlist`);
      return this.hooks.roleHandlers.qa(call, work);
    }
    // CODE_WORKTREE: worktree-scoped effects only, through the gated handler.
    if (!WORKTREE_TOOLS.has(call.name) || !this.hooks.roleHandlers?.codeWorktree) throw new HarnessError('AGENT_TOOL_DENIED', `Tool ${call.name} is outside the CODE_WORKTREE allowlist`);
    if (call.name === 'worktree.write') {
      const grant = admission.grants.find(item => item.id === call.args.grantId && item.writable);
      if (!grant) throw new HarnessError('AGENT_TOOL_DENIED', 'Write call names a grant outside the worktree authority');
      const current = this.hooks.store.get<ResourceGrant>('resource', grant.id);
      if (!current || current.threadId !== work.parentOwner.threadId || !current.writable)
        throw new HarnessError('PERMISSION_REVOKED', `Grant ${grant.id} is no longer writable by the parent`);
    }
    return this.hooks.roleHandlers.codeWorktree(call, work);
  }

  /** Ordered, deduplicated input delivery to a live child. */
  sendInput(ctx: RunContext, args: {inputId: string; workId: string; kind: 'STEER' | 'FOLLOW_UP' | 'MESSAGE'; text: string; dedupeKey: string; sourceRefs?: {id: string; revision: number}[]}) {
    this.hooks.assertRun(ctx);
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, args.workId);
    if (!work || work.parentOwner.threadId !== ctx.threadId) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${args.workId}`);
    const live = this.live.get(args.workId);
    const record = this.inbox.admit({
      inputId: args.inputId, taskId: ctx.threadId, targetOwner: work.childOwner,
      kind: args.kind, text: args.text, dedupeKey: args.dedupeKey, sourceRefs: args.sourceRefs,
    }, {liveSteer: live?.child.supportsLiveSteer === true && work.state === 'RUNNING'});
    if (record.delivery !== 'ACCEPTED') return record;
    if (!live || AGENT_WORK_TERMINAL_STATES.has(work.state)) return this.inbox.markUnknown(record.inputId);
    live.delivery = live.delivery.then(async () => {
      const current = this.inbox.inspect(record.inputId);
      if (!current || current.delivery !== 'ACCEPTED') return;
      // Steering without a declared and demonstrated live-steer adapter stays
      // queued after current; it is never relabelled or forced through send().
      if (current.kind === 'STEER' && !live.child.supportsLiveSteer) return;
      const text = this.inbox.text(record.inputId) ?? '';
      try { await live.child.send({inputId: record.inputId, kind: record.kind, text}); this.inbox.markEntered(record.inputId); }
      catch { this.inbox.markUnknown(record.inputId); }
    }).catch(() => {});
    return record;
  }

  /** Parent stop/archive: revoke dispatch first, then cancel the child and
   * confirm teardown. Late results become historical artifacts only. */
  async revokeForParent(parentThreadId: string): Promise<void> {
    for (const work of this.hooks.store.all<AgentWorkV1>(WORK_KIND).filter(item => item.parentOwner.threadId === parentThreadId)) {
      if (AGENT_WORK_TERMINAL_STATES.has(work.state)) continue;
      this.releaseLive(work.workId, true);
      this.finish(work.workId, 'CANCELLED', {failureReason: 'PERMISSION_REVOKED'});
    }
  }

  async stop(ctx: RunContext, workId: string): Promise<AgentWorkV1> {
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work || work.parentOwner.threadId !== ctx.threadId) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (!AGENT_WORK_TERMINAL_STATES.has(work.state)) { this.releaseLive(workId, true); this.finish(workId, 'CANCELLED', {}); }
    return this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId)!;
  }

  /** Resume never inherits handles: a fresh child epoch is dispatched only
   * after the durable admission's account, project, schema and grant bindings
   * all re-verify against the current parent. */
  async resume(ctx: RunContext, workId: string): Promise<AgentWorkV1> {
    if (!this.enabled()) throw new HarnessError('CAPABILITY_DENIED', 'agents.workV1 is disabled');
    this.hooks.assertRun(ctx);
    const work = this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId);
    if (!work || work.parentOwner.threadId !== ctx.threadId) throw new HarnessError('INVALID_AGENT_WORK', `Unknown work ${workId}`);
    if (work.state === 'COMPLETED_REPORTED' || work.state === 'VERIFIED') throw new HarnessError('INVALID_AGENT_WORK', `Work ${workId} already reported`);
    if (!AGENT_WORK_TERMINAL_STATES.has(work.state)) throw new HarnessError('INVALID_AGENT_WORK', `Work ${workId} is still ${work.state}`);
    const parent = this.parent(ctx);
    const admission = this.hooks.store.get<AdmissionRecord>(ADMISSION_KIND, workId);
    if (!admission) throw new HarnessError('STALE_AGENT_AUTHORITY', `No durable admission for ${workId}`);
    const binding = digest({modelId: parent.modelId, accountId: parent.accountId ?? null, projectId: parent.projectId, workspaceId: parent.workspaceId});
    if (binding !== admission.bindingDigest) throw new HarnessError('STALE_AGENT_AUTHORITY', 'Parent account, project or workspace binding changed since admission');
    if (digest(admission.admission.expectedOutputSchema) !== digest(work.expectedOutputSchema)) throw new HarnessError('STALE_AGENT_AUTHORITY', 'Output contract changed since admission');
    const availability = this.roleAvailability(ctx, work.role);
    if (!availability.available) throw new HarnessError('ROLE_UNAVAILABLE', `Role ${work.role} is unavailable: ${availability.reason}`);
    if (this.worksLive(ctx.threadId).length >= AGENT_WORK_LIMITS.concurrent) throw new HarnessError('AGENT_LIMIT', `At most ${AGENT_WORK_LIMITS.concurrent} active work items run in parallel`);
    // Authority is rebuilt against the current parent — revoked grants refuse
    // resume outright and re-scoped rights (including a narrowed worktree
    // binding) flow into the refreshed admission, never the stale snapshot.
    const {grants: effectiveGrants, proofMeta} = await this.admittedAuthority(ctx, {role: work.role, grantSubset: work.grantSubset}, 'STALE_AGENT_AUTHORITY');

    const ledger = this.ledger();
    if (work.budget.tokens !== null && this.hooks.globalBudget?.tokens != null && ledger.reservedTokens + ledger.spentTokens + work.budget.tokens > this.hooks.globalBudget.tokens)
      throw new HarnessError('AGENT_BUDGET_EXHAUSTED', 'Resumed work exceeds the remaining agent budget');

    const epoch = work.childOwner.epoch + 1;
    const resumed: AgentWorkV1 = AgentWorkV1Schema.parse({...work,
      state: 'QUEUED', childOwner: {threadId: work.childOwner.threadId, runId: null, epoch},
      outputRef: null, repairAttempts: 0, failureReason: undefined,
      updatedAt: new Date().toISOString(), revision: work.revision + 1});
    this.hooks.store.internal('agentWork.resumed', ctx.threadId, () => {
      this.hooks.store.put(WORK_KIND, workId, ctx.threadId, resumed);
      this.hooks.store.put(ADMISSION_KIND, workId, ctx.threadId, {...admission, grants: effectiveGrants, proofMeta});
      const next = this.ledger();
      next.reservedTokens += work.budget.tokens ?? 0; next.reservedMs += work.budget.ms ?? 0;
      this.hooks.store.put(BUDGET_KIND, BUDGET_ID, null, next);
      const thread = this.hooks.store.get<Thread>('thread', work.childOwner.threadId);
      if (thread) this.hooks.store.put('thread', thread.id, thread.id, {...thread, epoch, runId: null, status: 'working'});
    });
    return this.dispatch(resumed, admission.admission, effectiveGrants);
  }

  /** Restart: every non-terminal work becomes INTERRUPTED with its durable
   * facts intact; the visible graph is rebuilt from records only. */
  recover(): void {
    for (const work of this.hooks.store.all<AgentWorkV1>(WORK_KIND)) {
      if (AGENT_WORK_TERMINAL_STATES.has(work.state)) continue;
      this.finish(work.workId, 'INTERRUPTED', {failureReason: 'UNKNOWN'});
    }
    this.inbox.recover();
  }

  reconstruct(parentThreadId: string): {workId: string; role: AgentWorkRole; state: AgentWorkV1['state']; childThreadId: string; childKnown: boolean; outputRef: AgentWorkV1['outputRef']}[] {
    return this.hooks.store.all<AgentWorkV1>(WORK_KIND)
      .filter(work => work.parentOwner.threadId === parentThreadId)
      .map(work => ({
        workId: work.workId, role: work.role, state: work.state,
        childThreadId: work.childOwner.threadId,
        childKnown: this.hooks.store.get<Thread>('thread', work.childOwner.threadId) !== null,
        outputRef: work.outputRef,
      }));
  }

  /** Whether the live child accepts runtime steering right now. */
  supportsLiveSteer(workId: string): boolean {
    const live = this.live.get(workId);
    return live ? live.child.supportsLiveSteer : false;
  }

  inspect(workId: string): AgentWorkV1 | null { return this.hooks.store.get<AgentWorkV1>(WORK_KIND, workId) ?? null; }
  listForParent(threadId: string): AgentWorkV1[] { return this.hooks.store.all<AgentWorkV1>(WORK_KIND).filter(work => work.parentOwner.threadId === threadId); }
  dispatchedGrants(workId: string): ResourceGrant[] | null { return this.hooks.store.get<AdmissionRecord>(ADMISSION_KIND, workId)?.grants ?? null; }
  rawOutputArtifact(workId: string): WorkArtifact | null {
    return this.hooks.store.all<WorkArtifact>(ARTIFACT_KIND).filter(item => item.workId === workId && item.kind === 'raw-output').at(-1) ?? null;
  }
  lateArtifacts(workId: string): WorkArtifact[] { return this.hooks.store.all<WorkArtifact>(ARTIFACT_KIND).filter(item => item.workId === workId && item.kind === 'late-output'); }
  budgetLedger(): BudgetLedger { return this.ledger(); }

  async cancel(ctx: RunContext): Promise<void> { await this.revokeForParent(ctx.threadId); }

  async dispose(): Promise<void> {
    for (const workId of [...this.live.keys()]) this.releaseLive(workId, false);
  }
}
