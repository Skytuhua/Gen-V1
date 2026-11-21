import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  HarnessError,
  type ArtifactRecord,
  type HostCommand,
  type InputRequest,
  type Message,
  type Operation,
  type ResourceGrant,
  type RunContext,
  type CommandReceipt,
  type RuntimeAdapter,
  type Snapshot,
  type Thread,
  type UserStateRecord,
  type CompletedWriteReceipt,
  type WriteHookDiagnostic,
} from "../contracts/index.ts";
import type { SendModeV1 } from "../contracts/source-selection.ts";
import type { BackgroundWorkKind } from "../contracts/background-work.ts";
import type { DomainContext } from "../capabilities/index.ts";
import type { SkillActor } from "../contracts/skills.ts";
import { Store, digest } from "../storage/store.ts";
import { assertNotStorage, canonical } from "./security.ts";
import { validateJson } from "./widgets.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { getPreferences, mergePreferences } from "../contracts/preferences.ts";
import { applySkillOperations, curateSkills, decideSkillProposal, setSkillFlags } from "./skills.ts";
import { changeAccount, modelProvider } from "./accounts.ts";
import { applySessionBranch } from "./session-branches.ts";
import { cancelImport, commitImport, prepareImport, stageImport } from "./history-import.ts";
import { changeTaskMemory } from "./task-memory.ts";
import { ToolEffectLedger, createToolEffectFlags, ownerFor } from "./tool-effects.ts";
import type { PlanningCoordinator } from "./planning.ts";
import type { AgentWorkCoordinator } from "./agent-work.ts";
import type { BackgroundWorkCoordinator } from "./background-work.ts";
import type { ExternalIntakeCoordinator } from "./external-intake.ts";
import type { BrowserConsentHost } from "./browser-consent.ts";
import type { OperationProjectTrustHost } from "./operation-project-trust.ts";
import type { ProjectMemoryHost } from "./project-memory-host.ts";
import type { WorkbenchQueuedInput } from "./source-workbench.ts";
import type { SourceIntegration } from "./service.ts";

type Outbox = WorkbenchQueuedInput & {messageId?:string;completedWrite?:CompletedWriteReceipt;hookClaimed?:boolean;hookDiagnostic?:WriteHookDiagnostic;sendMode?:SendModeV1};
type Lease = { id: string; threadId: string; clientId: string; fields: string[]; expiresAt: number };
const text = (p: Record<string, unknown>, key: string, max = 128 * 1024): string => {
  if (typeof p[key] !== "string" || !(p[key] as string).trim() || Buffer.byteLength(p[key] as string) > max) throw new HarnessError("INVALID_INPUT", key + " must be a nonempty string within its size limit");
  return p[key] as string;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HarnessError("INVALID_INPUT", "Expected an object");
  return value as Record<string, unknown>;
};
const now = () => new Date().toISOString();

export interface ServiceCommandsHost {
  store: Store;
  effects: ToolEffectLedger;
  effectFlags: ReturnType<typeof createToolEffectFlags>;
  aborts: Map<string, AbortController>;
  teardowns: Map<string, { ctx: RunContext; side: boolean; promise: Promise<void> }>;
  planning: PlanningCoordinator;
  agentWork: AgentWorkCoordinator;
  backgroundWork: BackgroundWorkCoordinator;
  intake: ExternalIntakeCoordinator;
  controlConsent: BrowserConsentHost;
  projectTrust: OperationProjectTrustHost;
  runtime: RuntimeAdapter;
  closed(): boolean;
  updateClosing(): boolean;
  reviewing(): boolean;
  touch(): void;
  predictionsBusy(): boolean;
  cancelComposerPredictions(): Promise<void>;
  mutatePredictions(delta: number): void;
  memoryBusy(): boolean;
  memoryHost(): ProjectMemoryHost;
  source(): SourceIntegration | undefined;
  thread(id: string | undefined): Thread;
  skillActor(kind: SkillActor["kind"], ctx?: RunContext): SkillActor;
  isAccountBound(thread: Thread): boolean;
  binding(thread: Thread, providerId: string): { accountId: string | null; bound: boolean };
  assertBinding(thread: Thread, providerId: string, captured: { accountId: string | null; bound: boolean }): void;
  cancelRun(ctx: RunContext, side: boolean): Promise<void>;
  cancelReview(): Promise<void>;
  failUnansweredDetails(ctx: RunContext, error: string): void;
  applyLossAwareCompaction(command: HostCommand, thread: Thread): Promise<CommandReceipt>;
  runtimeFailure(ctx: RunContext, error: unknown): void;
  assertMutation(id: string): void;
  flushDeltas(threadId: string): void;
  sendMessage(command: HostCommand, thread: Thread): Promise<CommandReceipt>;
  resume(command: HostCommand, thread: Thread): Promise<CommandReceipt>;
  agentWorkCommand(ctx: RunContext, command: HostCommand): Promise<CommandReceipt>;
  acceptRequest(thread: Thread, request: InputRequest, response: unknown): unknown;
  acceptAction(thread: Thread, p: Record<string, unknown>, commandId: string): unknown;
  request(threadId: string, id: unknown, revision: unknown): InputRequest;
  updateGateStatus(threadId: string): void;
  assertNoOtherRun(threadId: string): void;
  enqueueInput(input: Outbox): void;
  deliverOutbox(threadId: string): Promise<void>;
  dispatchOperation(id: string): Promise<unknown>;
  operationData(operation: Operation, progress?: { message: string; counts?: unknown }): void;
  state(threadId: string, id: unknown): UserStateRecord;
  lease(stateId: string): Lease | null;
  artifact(threadId: string, id: unknown): ArtifactRecord;
  context(threadId: string, signal?: AbortSignal, operationId?: string, authority?: RunContext): DomainContext;
  background(promise: Promise<unknown>): void;
}

export class ServiceCommands {
  private readonly messageAdmissions = new Map<string, { commitment: string; work: Promise<CommandReceipt> }>();
  constructor(private readonly host: ServiceCommandsHost) {}

  async command(command: HostCommand): Promise<CommandReceipt> {
    const host = this.host;
    if (command.type !== 'message.send') return this.commandAdmitted(command);
    const accepted = host.store.receipt(command); if (accepted) return accepted;
    const commitment = digest(command), pending = this.messageAdmissions.get(command.id);
    if (pending) {if (pending.commitment !== commitment) throw new HarnessError('DUPLICATE_COMMAND', 'A pending send command already belongs to different content.'); return pending.work;}
    if (this.messageAdmissions.size >= 128) throw new HarnessError('SEND_BUSY', 'Too many messages are being admitted.', {sendAccepted: false});
    const captured = structuredClone(command);
    const work = Promise.resolve().then(async () => {
      try {return await this.commandAdmitted(captured);} catch (error) {
        const receipt = host.store.receipt(captured); if (receipt) return receipt;
        // There is exactly one matching admission while this entry is held.
        // Typed precommit denial can therefore unlock an edited new command.
        if (error instanceof HarnessError && !host.store.get('outbox', captured.id)) throw new HarnessError(error.code, error.message, {...(error.details && typeof error.details === 'object' ? error.details : {}), sendAccepted: false});
        throw error;
      }
    });
    this.messageAdmissions.set(command.id, {commitment, work});
    try {return await work;} finally {if (this.messageAdmissions.get(command.id)?.work === work) this.messageAdmissions.delete(command.id);}
  }
  private async commandAdmitted(command: HostCommand): Promise<CommandReceipt> {
    const host = this.host;
    if(host.updateClosing())throw new HarnessError('HOST_CLOSING','Gen is closing. Saved work is retained.');
    if(command.type==='agent.followUp'){if(host.closed())throw new HarnessError('CANCELLED_RUN','The workspace has closed.');host.touch();return host.planning.followUp(command);}
    // Retired commands must not replay old write receipts.
    if(command.type.startsWith('research.'))throw new HarnessError('UNKNOWN_COMMAND', 'Unknown command: '+command.type);
    const duplicate = host.store.receipt(command); if (duplicate) {
      if(command.type==='run.stop'){
        const owner=(duplicate.result as {nativeOwner?:RunContext})?.nativeOwner;
        if(owner)await host.teardowns.get(JSON.stringify([owner.threadId,owner.runId,owner.epoch]))?.promise;
      }
      return duplicate;
    }
    const target=command.threadId?host.store.get<Thread>('thread',command.threadId):null;
    if(target?.kind==='delegate'&&!['thread.rename','thread.presentation','thread.archive','thread.restore'].includes(command.type))throw new HarnessError('DELEGATE_READ_ONLY','Delegated transcripts are read-only. Control their work from the parent task.');
    const preempts=['message.send','run.resume','run.compact','run.stop','thread.archive','settings.update','action.submit','request.respond','request.detail','operation.approve','operation.reject','learning.curate'].includes(command.type)||command.type.startsWith('account.');
    if(!preempts)return this.executeCommand(command);
    // Hold admission through asynchronous model discovery/history/teardown. A
    // previous reply settling in that interval must not start optional work.
    host.mutatePredictions(1);
    try{const busy=host.predictionsBusy()||host.memoryBusy(),cancelled=host.cancelComposerPredictions();if(busy)await cancelled;return await this.executeCommand(command);}
    finally{host.mutatePredictions(-1);}
  }
  private async executeCommand(command:HostCommand){
    const host = this.host;
    const p = command.payload;
    if(host.closed())throw new HarnessError('CANCELLED_RUN','The workspace has closed.');
    if(host.source()?.runtime.sourceBusy&&command.type==='settings.update'&&p.preferences&&typeof p.preferences==='object'&&['learningEnabled','learningApproval','learningInterval','skillCurator'].some(key=>Object.hasOwn(p.preferences as object,key)))throw new HarnessError('HERMES_POLICY_BUSY','Stop the current response before changing learning controls.');
    host.touch();
    if(host.reviewing()&&(['run.stop','run.compact','thread.archive','learning.cancel'].includes(command.type)||command.type.startsWith('account.')||command.type==='settings.update'||command.type.startsWith('skill.')))await host.cancelReview();
    if(host.source()&&(command.type.startsWith('skill.')||command.type==='learning.curate'))return host.source()!.library.command(command);
    if(command.type.startsWith('skill.'))return host.store.command(command,()=>{
      if(command.type==='skill.manage')return applySkillOperations(host.store,p.operations,host.skillActor('user'));
      if(command.type==='skill.flags')return setSkillFlags(host.store,text(p,'name',64),{...(p.enabled===undefined?{}:{enabled:p.enabled as boolean}),...(p.protected===undefined?{}:{protected:p.protected as boolean})},p.baseRevision as number);
      if(command.type==='skill.decide')return decideSkillProposal(host.store,text(p,'proposalId',200),p.approve as boolean);
      throw new HarnessError('UNKNOWN_CAPABILITY','Unknown skill command.');
    });
    if(command.type==='control.request')return host.store.command(command,()=>{
      const thread=host.thread(command.threadId!),mode=p.mode;
      if(mode!=='FRESH_VERIFICATION_BROWSER'&&mode!=='CONSENTED_EXISTING_TAB'&&mode!=='SELECTED_DESKTOP_APPLICATION')throw new HarnessError('INVALID_INPUT','Choose a control mode.');
      const owner={threadId:thread.id,runId:null,epoch:thread.epoch,projectId:thread.projectId??null,workspaceId:thread.workspaceId??null,accountBinding:thread.accountId??null};
      const OPS=['CLICK','TYPE','KEYPRESS','UPLOAD','DOWNLOAD','NAVIGATE'] as const;
      const operations=Array.isArray(p.operations)?p.operations.filter((o):o is (typeof OPS)[number]=>typeof o==='string'&&(OPS as readonly string[]).includes(o)):[];
      const request=host.controlConsent.requestConsent(owner,{mode,observe:p.observe===true,operations,allowedOrigins:Array.isArray(p.allowedOrigins)?p.allowedOrigins.filter((o):o is string=>typeof o==='string'):[]});
      return {consent:request,control:host.controlConsent.surfaceModel(thread.id)};
    });
    if(command.type==='control.stop')return host.store.command(command,()=>{
      const thread=host.thread(command.threadId!);
      return {control:host.controlConsent.stop(thread.id)};
    });
    if(command.type==='learning.cancel')return host.store.command(command,()=>({cancelled:true}));
    if(command.type==='learning.curate')return host.store.command(command,()=>({changes:curateSkills(host.store)}));
    if(command.type.startsWith('account.'))return host.store.command(command,()=>changeAccount(host.store,command));
    if(command.type.startsWith('background.')||command.type.startsWith('intake.'))return this.backgroundCommand(command);
    if (command.type === "thread.create") return host.store.command(command, () => {
      const parent=p.sideParentId===undefined?undefined:host.thread(text(p,'sideParentId',200));
      if(parent?.sideParentId||parent?.kind==='delegate')throw new HarnessError('INVALID_INPUT','Open side questions from the main conversation.');
      if(parent&&host.store.all<Thread>('thread').filter(item=>item.sideParentId===parent.id&&!host.store.get('archivedThread',item.id)).length>=24)throw new HarnessError('SIDE_CHAT_LIMIT','Archive an older side conversation before creating another.');
      const projectId=p.projectId===undefined?parent?.projectId:text(p,'projectId',160);
      if(projectId&&!/^[\w:.-]+$/.test(projectId))throw new HarnessError('INVALID_INPUT','Choose a valid connected project.');
      const project=projectId?host.store.get<{name:string;authority:{kind:string}}>('workspaceProject',projectId):null;
      if(projectId&&(!project||project.authority?.kind!=='local'))throw new HarnessError('CAPABILITY_DENIED','Choose a connected personal project.');
      const thread: Thread = { id: randomUUID(),kind:parent?'side':'main',...(projectId?{projectId}:{}),...(parent?.workspaceId?{workspaceId:parent.workspaceId}:{}), title: typeof p.title === "string" ? p.title.slice(0, 140) || "New thread" : parent?'Side question':"New thread", projectName:project?.name??(typeof p.projectName === "string" ? p.projectName : parent?.projectName??null), createdAt: now(), updatedAt: now(), status: "ready", epoch: 0, runId: null, modelId: null, sessionPath: null,...(parent?{sideParentId:parent.id,parentThreadId:parent.id,mode:'plan' as const,...(host.isAccountBound(parent)?{accountId:parent.accountId??null,modelId:parent.modelId}:{})}:{}) };
      host.store.put("thread", thread.id, thread.id, thread);
      if(parent)host.store.put('sideContext',thread.id,thread.id,{parentId:parent.id,title:parent.title,capturedAt:now(),messages:host.store.all<Message>('message',parent.id).filter(message=>message.role!=='activity').slice(-8).map(message=>({id:message.id,role:message.role,content:message.content.slice(0,1500)}))});
      return thread;
    });
    if (command.type === "settings.update") return host.store.command(command, () => {
      const settings = host.store.get<Snapshot['settings']>('settings', 'global') ?? { theme: 'dark', modelId: null };
      if (Object.keys(p).some(key => !['theme', 'modelId', 'preferences'].includes(key))) throw new HarnessError('INVALID_INPUT', 'Unsupported setting');
      if (p.theme !== undefined && !["light", "dark", "system"].includes(String(p.theme))) throw new HarnessError("INVALID_INPUT", "Unknown theme");
      if (p.modelId !== undefined && p.modelId !== null && (typeof p.modelId !== 'string' || p.modelId.length > 200)) throw new HarnessError('INVALID_INPUT', 'Invalid model selection');
      let preferences = settings.preferences;
      if (p.preferences !== undefined) { try { preferences = mergePreferences(getPreferences(settings), p.preferences); } catch { throw new HarnessError('INVALID_INPUT', 'Invalid or unsupported preference'); } }
      const next = { ...settings, ...(p.theme !== undefined ? { theme: p.theme } : {}), ...(p.modelId !== undefined ? { modelId: p.modelId } : {}), ...(preferences ? { preferences } : {}) }; host.store.put("settings", "global", null, next); return next;
    });
    if (command.type === 'thread.restore') return host.store.command(command, () => {
      const archived = command.threadId && host.store.get<Thread>('thread', command.threadId);
      if (!archived || !host.store.get('archivedThread', archived.id)) throw new HarnessError('NOT_FOUND', 'Archived thread unavailable');
      host.store.remove('archivedThread', archived.id); return archived;
    });
    const thread = host.thread(command.threadId);
    // A command can end or supersede the run; flush its buffered deltas before
    // any handler mutates epoch/runId, or the trailing text would be dropped.
    host.flushDeltas(thread.id);
    if(thread.sideParentId&&!['message.send','run.stop','run.resume','thread.rename','thread.presentation','thread.archive'].includes(command.type))throw new HarnessError('SIDE_CHAT_READ_ONLY','Side conversations answer questions without changing the main task or accessing files.');
    if (command.type === 'session.branch') {
      if (!capabilityEnabled('sessions.branchV1')) throw new HarnessError('CAPABILITY_DENIED', 'Session branching is disabled on this host.');
      return host.store.command(command, () => applySessionBranch(host.store, host.thread(thread.id), p, { accountExists: id => host.store.get('account', id) !== null }));
    }
    if (command.type.startsWith('historyImport.')) {
      if (!capabilityEnabled('sessions.inertImportV1')) throw new HarnessError('CAPABILITY_DENIED', 'History import is disabled on this host.');
      const owner = { threadId: thread.id, projectId: thread.projectId ?? null };
      if (command.type === 'historyImport.stage') {
        // Format admission is pure CPU work — it completes before the staging
        // transaction so a 20 MiB document never holds the write lock.
        const bytes = typeof p.archive === 'string' ? Buffer.from(text(p, 'archive', 22 * 1024 * 1024), 'utf8')
          : typeof p.archiveBase64 === 'string' ? Buffer.from(text(p, 'archiveBase64', 30 * 1024 * 1024), 'base64')
          : (() => { throw new HarnessError('INVALID_INPUT', 'An ArchiveV1 JSON archive is required'); })();
        const prepared = prepareImport(bytes);
        return host.store.command(command, () => stageImport(host.store, owner, prepared));
      }
      if (command.type === 'historyImport.commit')
        return host.store.command(command, () => commitImport(host.store, owner, text(p, 'importId', 200)));
      if (command.type === 'historyImport.cancel')
        return host.store.command(command, () => cancelImport(host.store, owner, text(p, 'importId', 200)));
      throw new HarnessError('UNKNOWN_COMMAND', 'Unknown command: ' + command.type);
    }
    if (command.type.startsWith('agentWork.')) {
      const ctx: RunContext = { threadId: thread.id, runId: thread.runId ?? '', epoch: thread.epoch };
      return host.agentWorkCommand(ctx, command);
    }
    if (command.type === 'memory.save' || command.type === 'memory.delete') return host.store.command(command, () => changeTaskMemory(host.store, thread.id, command.type === 'memory.save' ? 'save' : 'delete', p, 'user'));
    if (command.type === "message.send") return host.sendMessage(command, thread);
    if (command.type === "run.stop") {
      const pending=[...host.teardowns.values()].find(owner=>owner.ctx.threadId===thread.id);
      const ctx = !thread.runId&&pending?pending.ctx:{ threadId: thread.id, runId: thread.runId ?? "", epoch: thread.epoch };
      const receipt = host.store.command(command, () => { host.planning.endRun(ctx,'cancelled'); host.failUnansweredDetails(ctx,"The explanation was stopped. Resume the task to retry."); host.store.put("thread", thread.id, thread.id, { ...thread, epoch: thread.epoch + 1, runId: null, status: "stopped", updatedAt: now() }); return { stopped: true,nativeOwner:ctx }; });
      host.aborts.get(thread.id)?.abort();
      // Register the native teardown first — a racing resume must still see
      // RUN_BUSY — then revoke child work whether teardown succeeded or
      // failed, so no stopped parent leaves live dispatch behind.
      await host.cancelRun(ctx,!!thread.sideParentId)
        .finally(() => host.agentWork.revokeForParent(thread.id).catch(() => {}));
      return receipt;
    }
    if (command.type === "run.resume") return host.resume(command, thread);
    if (command.type === "operation.reconcile") {
      const operation = host.store.get<Operation>("operation", text(p, "operationId", 200));
      if (!operation || operation.threadId !== thread.id || operation.status !== "unknown") throw new HarnessError("INVALID_OPERATION", "Select an uncertain operation to inspect");
      const domain = await import("../capabilities/index.ts");
      const observed = await domain.reconcileDomainOperation(operation, host.context(thread.id));
      return host.store.command(command, () => {
        const current = host.store.get<Operation>("operation", operation.id), currentThread = host.store.get<Thread>("thread", thread.id);
        if (host.closed() || !currentThread || host.store.get("archivedThread", thread.id)
          || digest(ownerFor(currentThread)) !== digest(ownerFor(thread)) || !current || digest(current) !== digest(operation))
          throw new HarnessError("STALE_OPERATION", "The action or its owner changed while inspecting its outcome. Reload the action before inspecting again.");
        const next = { ...current, status: observed.status, ...(observed.result !== undefined ? { result: observed.result } : {}), error: observed.status === "unknown" ? observed.message : undefined };
        host.store.put("operation", operation.id, thread.id, next); host.operationData(next); return observed;
      });
    }
    if (command.type === "run.compact") {
      if (capabilityEnabled('context.lossAwareCompactionV1')) {
        if (!thread.sessionPath || !thread.modelId) throw new HarnessError("RUNTIME_UNAVAILABLE", "This thread does not have a Pi session yet");
        if (thread.runId) throw new HarnessError("RUN_BUSY", "Wait for the current run before compacting");
        host.assertNoOtherRun(thread.id);
        return host.applyLossAwareCompaction(command,thread);
      }
      if (!thread.sessionPath || !thread.modelId) throw new HarnessError("RUNTIME_UNAVAILABLE", "This thread does not have a Pi session yet");
      if (thread.runId) throw new HarnessError("RUN_BUSY", "Wait for the current run before compacting");
      host.assertNoOtherRun(thread.id);
      const binding=host.binding(thread,modelProvider(thread.modelId));
      const memoryCheckpoint=capabilityEnabled('memory.projectV1')?await host.memoryHost().requirement(thread.id):undefined;
      const current=host.thread(thread.id);if(current.epoch!==thread.epoch||current.runId!==thread.runId||current.modelId!==thread.modelId||current.sessionPath!==thread.sessionPath)throw new HarnessError('CANCELLED_RUN','The compaction owner changed while preparing memory.');
      const ctx = { threadId: thread.id, runId: randomUUID(), epoch: thread.epoch + 1 };
      const receipt = host.store.command(command, () => { host.assertBinding(host.thread(thread.id),modelProvider(thread.modelId!),binding);host.store.put("runtimeIntent", ctx.runId, thread.id, { kind: "compaction", previousStatus: thread.status }); host.store.put("thread", thread.id, thread.id, { ...thread, ...ctx, accountId:binding.accountId,id: thread.id, status: "working", updatedAt: now() }); return ctx; });
      host.background((memoryCheckpoint?host.runtime.compact(ctx,thread.sessionPath,thread.modelId,binding.accountId,memoryCheckpoint):host.runtime.compact(ctx,thread.sessionPath,thread.modelId,binding.accountId)).catch(e => host.runtimeFailure(ctx, e))); return receipt;
    }
    if (command.type === "resource.grant") {
      const path = await canonical(text(p, "path", 4096)); assertNotStorage(path, host.store.dataDir);
      if (!["project", "file", "database", "export", "attachment"].includes(String(p.kind))) throw new HarnessError("INVALID_INPUT", "Unsupported resource kind");
      const identity = await stat(path, { bigint: true });
      const grant: ResourceGrant = { id: randomUUID(), threadId: thread.id, path, kind: p.kind as ResourceGrant["kind"], label: typeof p.label === "string" ? p.label : basename(path), writable: p.writable === true, createdAt: now(), identity: { dev: String(identity.dev), ino: String(identity.ino) } };
      return host.store.command(command, () => { host.store.put("resource", grant.id, thread.id, grant); return grant; });
    }
    if (command.type === "resource.upload") {
      const name = basename(text(p, "name", 200)).replace(/[^a-zA-Z0-9._ -]/g, "_");
      const base64 = text(p, "base64", 28 * 1024 * 1024);
      if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(base64)) throw new HarnessError("INVALID_INPUT", "Invalid attachment encoding");
      const bytes = Buffer.from(base64, "base64"); if (bytes.length > 20 * 1024 * 1024) throw new HarnessError("INVALID_INPUT", "Attachments are limited to 20 MiB");
      const folder = join(host.store.dataDir, "attachments", thread.id); await mkdir(folder, { recursive: true });
      const path = join(folder, command.id + "-" + name); try { await writeFile(path, bytes, { flag: "wx" }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if (!(await readFile(path)).equals(bytes)) throw new HarnessError("DUPLICATE_COMMAND", "Upload ID already has different content"); }
      const grant: ResourceGrant = { id: command.id, threadId: thread.id, path, label: name, kind: "attachment", writable: false, createdAt: now() };
      return host.store.command(command, () => { host.store.put("resource", grant.id, thread.id, grant); return grant; });
    }
    const receipt = host.store.command(command, () => this.applyCommand(command, host.thread(thread.id)));
    if (["request.respond","request.detail","action.submit","operation.reject"].includes(command.type)) host.background(host.deliverOutbox(thread.id));
    if (command.type === "operation.approve" || command.type === "action.submit") {
      for (const op of host.store.all<Operation>("operation", thread.id).filter(o => o.approved && o.status === "prepared")) host.background(host.dispatchOperation(op.id));
    }
    return receipt;
  }
  private async backgroundCommand(command: HostCommand): Promise<CommandReceipt> {
    const host = this.host;
    const p = command.payload;
    const ownerFor = (thread: Thread) => ({ threadId: thread.id, runId: thread.runId, epoch: thread.epoch, projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null, accountBinding: thread.accountId ?? null });
    const sync = (result: unknown): CommandReceipt => host.store.receipt(command) ?? host.store.command(command, () => result);
    switch (command.type) {
      case 'background.work.admit': {
        const thread = host.thread(command.threadId);
        const kind = String(p.kind) as BackgroundWorkKind;
        if (!['COMMAND', 'REVIEW', 'MAINTENANCE', 'EXTERNAL_TASK'].includes(kind)) throw new HarnessError('INVALID_INPUT', 'Unknown background work kind.');
        const record = host.backgroundWork.admit(command, {
          owner: ownerFor(thread), kind, title: text(p, 'title', 200),
          ...(p.lifetime === 'APPROVED_SERVICE' ? { lifetime: 'APPROVED_SERVICE' as const } : {}),
          ...(typeof p.deadlineMs === 'number' ? { deadlineMs: p.deadlineMs } : {}),
          ...(typeof p.effectId === 'string' ? { effectId: p.effectId } : {}),
          ...(p.command && typeof p.command === 'object' ? { command: p.command as { executable: string; argv: string[]; cwd: string; profileId: string } } : {}),
          ...(p.idle && typeof p.idle === 'object' ? { idle: p.idle as { projectId: string; profileId: string; intervalMs: number } } : {}),
          ...(typeof p.parentThreadId === 'string' ? { parentThreadId: p.parentThreadId } : {}),
          ...(p.advisory === true ? { advisory: true } : {}),
          ...(typeof p.intakeId === 'string' ? { intakeId: p.intakeId } : {}),
        });
        return sync(record);
      }
      case 'background.work.cancel': return sync(host.backgroundWork.cancel(command, text(p, 'workId', 200)));
      case 'background.work.stop': {
        const result = await host.backgroundWork.stopCommand(text(p, 'workId', 200));
        return host.store.command(command, () => result);
      }
      case 'background.work.reconcile': {
        const receipt = p.receipt as { pid: number; creationToken: string | null; exitCode: number | null; signal: string | null; observedAt: string };
        return sync(host.backgroundWork.resolveProcessExit(text(p, 'workId', 200), receipt));
      }
      case 'background.command.start': {
        const result = await host.backgroundWork.startCommand(text(p, 'workId', 200));
        return host.store.command(command, () => result);
      }
      case 'background.wakeup.register': {
        const thread = host.thread(command.threadId);
        const taskId = text(p, 'taskId', 200);
        const work = host.backgroundWork.work(taskId);
        if (work.owner.threadId !== thread.id) throw new HarnessError('CAPABILITY_DENIED', 'The wakeup belongs to another task.');
        return sync(host.backgroundWork.scheduler.register(command, { taskId, trigger: p.trigger, ...(typeof p.scheduleTimezone === 'string' ? { scheduleTimezone: p.scheduleTimezone } : {}), ...(typeof p.deadlineMs === 'number' ? { deadlineMs: p.deadlineMs } : {}) }));
      }
      case 'background.wakeup.pause': return sync(host.backgroundWork.scheduler.pause(command, text(p, 'wakeupId', 200)));
      case 'background.wakeup.resume': return sync(host.backgroundWork.scheduler.resume(command, text(p, 'wakeupId', 200)));
      case 'background.wakeup.cancel': return sync(host.backgroundWork.scheduler.cancel(command, text(p, 'wakeupId', 200)));
      case 'background.occurrence.reconcile': return sync(host.backgroundWork.scheduler.reconcile(command, text(p, 'occurrenceKey', 600), p.receipt as { observed: 'DELIVERED' | 'NOT_DISPATCHED'; receiptRef?: string }));
      case 'background.human.request': {
        const thread = host.thread(command.threadId);
        return sync(host.backgroundWork.requestHumanStep(command, {
          requestId: text(p, 'requestId', 200), owner: ownerFor(thread), questionRevision: Number(p.questionRevision),
          responseSchema: object(p.responseSchema), requiredAction: p.requiredAction as 'answer' | 'approval' | 'credential', workId: text(p, 'workId', 200),
        }));
      }
      case 'background.human.respond': return sync(host.backgroundWork.respondHumanStep(command, { requestId: text(p, 'requestId', 200), revision: Number(p.revision), response: p.response }));
      case 'background.human.decline': return sync(host.backgroundWork.declineHumanStep(command, { requestId: text(p, 'requestId', 200), revision: Number(p.revision) }));
      case 'background.idle.configure': return sync(host.backgroundWork.configureIdle(command, { projectId: text(p, 'projectId', 160), profileId: text(p, 'profileId', 160), enabled: p.enabled === true, intervalMs: Number(p.intervalMs) }));
      case 'background.pauseAll': return sync(host.backgroundWork.pauseAll(command));
      case 'intake.configure': return sync(host.intake.configure(command, { repositoryId: Number(p.repositoryId), enabled: p.enabled === true, ...(typeof p.projectId === 'string' || p.projectId === null ? { projectId: p.projectId } : {}) }));
      case 'intake.poll': {
        const result = await host.intake.pollOnce();
        return host.store.command(command, () => result);
      }
      case 'intake.approve': {
        const result = await host.intake.approve(command, { intakeId: text(p, 'intakeId', 200), modelId: text(p, 'modelId', 300), ...(typeof p.projectId === 'string' ? { projectId: p.projectId } : {}) });
        return host.store.command(command, () => result);
      }
      case 'intake.reject': return sync(host.intake.reject(command, { intakeId: text(p, 'intakeId', 200), ...(typeof p.reason === 'string' ? { reason: p.reason } : {}) }));
      default: throw new HarnessError('UNKNOWN_COMMAND', 'Unknown command: ' + command.type);
    }
  }
  private applyCommand(command: HostCommand, thread: Thread): unknown {
    const host = this.host;
    const p = command.payload;
    switch (command.type) {
      case 'thread.mode': {
        if(thread.runId)throw new HarnessError('RUN_BUSY','Stop the current run before changing its mode');
        if(!['plan','build'].includes(String(p.mode)))throw new HarnessError('INVALID_INPUT','Unknown task mode');
        const next={...thread,mode:p.mode as 'plan'|'build'};host.store.put('thread',thread.id,thread.id,next);return next;
      }
      case "thread.rename": { const next = { ...thread, title: text(p, "title", 140), updatedAt: now() }; host.store.put("thread", thread.id, thread.id, next); return next; }
      case 'thread.presentation': {
        if (Object.keys(p).some(key => !['pinned', 'unread', 'settled', 'order'].includes(key)) || Object.entries(p).some(([key, value]) => key === 'order' ? typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000 : typeof value !== 'boolean')) throw new HarnessError('INVALID_INPUT', 'Invalid thread presentation');
        const next = { ...thread, presentation: { ...thread.presentation, ...p } }; host.store.put('thread', thread.id, thread.id, next); return next;
      }
      case "thread.archive": {
        if(thread.runId)throw new HarnessError("RUN_BUSY","Stop the thread before archiving");
        if(host.planning.hasActiveChildren(thread.id)||host.store.all<Thread>('thread').some(side=>(side.sideParentId===thread.id||side.parentThreadId===thread.id)&&side.runId&&!host.store.get('archivedThread',side.id)))throw new HarnessError('RUN_BUSY','Finish or stop the child conversation before archiving this thread');
        host.store.put("archivedThread",thread.id,thread.id,true);return {archived:true};
      }
      case "edit.begin": {
        const state = host.state(thread.id, p.stateId), lease = host.lease(state.id), clientId = text(p, "clientId", 200);
        if (lease && lease.clientId !== clientId) throw new HarnessError("USER_EDIT_CONFLICT", "Another client is editing this state");
        const next: Lease = { id: state.id, threadId: thread.id, clientId, fields: Array.isArray(p.fields) ? p.fields.map(String) : [], expiresAt: Date.now() + 30000 };
        host.store.put("lease", state.id, thread.id, next); return next;
      }
      case "edit.end": { const state = host.state(thread.id, p.stateId), lease = host.lease(state.id); if (lease && lease.clientId !== p.clientId) throw new HarnessError("USER_EDIT_CONFLICT", "Only the editing client may release this lease"); host.store.remove("lease", state.id); return { released: true }; }
      case "state.save": {
        const state = host.state(thread.id, p.stateId), clientId = text(p, "clientId", 200), lease = host.lease(state.id);
        if (lease && lease.clientId !== clientId) throw new HarnessError("USER_EDIT_CONFLICT", "Another client owns this edit");
        const key = state.id + ":" + clientId, last = host.store.get<{ sequence: number; hash: string; result: UserStateRecord }>("clientSequence", key);
        const sequence = Number(p.clientSequence), values = object(p.values);
        if (!Number.isSafeInteger(sequence) || sequence < 0 || JSON.stringify(values).length > 128 * 1024) throw new HarnessError("INVALID_INPUT", "Invalid draft sequence or size");
        if (last && sequence <= last.sequence) { if (sequence === last.sequence && digest(values) === last.hash) return last.result; throw new HarnessError("STALE_USER_STATE", "Draft sequence has already advanced"); }
        if (p.baseRevision !== state.revision) throw new HarnessError("STALE_USER_STATE", "The saved draft changed; keep both versions", { currentRevision: state.revision });
        const next = { ...state, revision: state.revision + 1, values };
        host.store.put("userState", state.id, thread.id, next); host.store.put("clientSequence", key, thread.id, { sequence, hash: digest(values), result: next });
        if (lease) host.store.put("lease", state.id, thread.id, { ...lease, expiresAt: Date.now() + 30000 }); return next;
      }
      case "widget.checkpoint": {
        const artifact = host.artifact(thread.id, p.artifactId);
        if (!artifact.widget || artifact.revision !== p.revision) throw new HarnessError("STALE_REVISION", "Widget code changed");
        if (artifact.widget.stateSchemaVersion !== p.stateSchemaVersion) throw new HarnessError("STALE_USER_STATE", "Widget state schema changed");
        const state = host.state(thread.id, artifact.stateId), lease = host.lease(state.id), clientId = text(p, "clientId", 200);
        if (lease && lease.clientId !== clientId) throw new HarnessError("USER_EDIT_CONFLICT", "Another client owns this edit");
        if (p.baseStateRevision !== state.revision) throw new HarnessError("STALE_USER_STATE", "Checkpoint is stale", { currentRevision: state.revision });
        validateJson(artifact.widget.stateSchema, p.values); const next = { ...state, revision: state.revision + 1, values: object(p.values) };
        if (JSON.stringify(next.values).length > 128 * 1024) throw new HarnessError("INVALID_INPUT", "Checkpoint exceeds size limit");
        host.store.put("userState", state.id, thread.id, next);
        if (lease) host.store.put("lease", state.id, thread.id, { ...lease, expiresAt: Date.now() + 30000 });
        return next;
      }
      case "artifact.expand": case "artifact.pin": case "artifact.archive": {
        const artifact = host.artifact(thread.id, p.artifactId);
        if (command.type === "artifact.archive" && (artifact.pinned || host.lease(artifact.stateId))) throw new HarnessError("USER_EDIT_CONFLICT", "Unpin and finish editing before archiving");
        const next = { ...artifact, ...(command.type === "artifact.expand" ? { placement: p.expanded ? "expanded" : "inline" } : command.type === "artifact.pin" ? { pinned: p.pinned === true } : { lifecycle: "archived" }), updatedAt: now() } as ArtifactRecord;
        host.store.put("artifact", artifact.id, thread.id, next); return next;
      }
      case "request.withdraw": {
        const request = host.request(thread.id, p.requestId, p.revision);
        host.store.put("request", request.id, thread.id, { ...request, revision: request.revision + 1, status: "withdrawn" });
        for (const op of host.store.all<Operation>("operation", thread.id).filter(o => o.status === "prepared")) {
          const next: Operation = { ...op, status: "cancelled", revision: op.revision + 1 };
          host.store.put("operation", op.id, thread.id, next); host.operationData(next);
        }
        host.updateGateStatus(thread.id); return { withdrawn: true };
      }
      case "request.respond": return host.acceptRequest(thread, host.request(thread.id, p.requestId, p.revision), p.response);
      case 'request.detail': {
        if(['stopped','interrupted','failed'].includes(thread.status))throw new HarnessError('RESUME_REQUIRED','Resume this task before asking for another explanation');
        const request=host.request(thread.id,p.requestId,p.revision);
        if(!request.presentation||!['explain','examples','more-options'].includes(String(p.kind)))throw new HarnessError('INVALID_INPUT','This question has no requested detail');
        if(p.kind!=='more-options'&&!request.presentation.options.some(option=>option.id===p.optionId))throw new HarnessError('INVALID_INPUT','Unknown option');
        const prior=request.detailRequests?.find(detail=>detail.kind===p.kind&&detail.optionId===p.optionId&&host.store.get<Outbox>('outbox',detail.id)?.status!=='handled');if(prior){if(prior.status!=='pending')host.store.put('request',request.id,thread.id,{...request,revision:request.revision+1,detailRequests:request.detailRequests?.map(item=>item.id===prior.id?{...item,status:'pending',error:undefined}:item)});return {inputId:prior.id,pending:true};}
        if((request.detailRequests?.filter(detail=>detail.status==='pending').length??0)>=4)throw new HarnessError('REQUEST_BUSY','Wait for the pending explanation before adding more');
        const detail={id:command.id,kind:p.kind as 'explain'|'examples'|'more-options',...(p.kind!=='more-options'?{optionId:String(p.optionId)}:{}),status:'pending' as const};
        host.store.put('request',request.id,thread.id,{...request,detailRequests:[...(request.detailRequests??[]).filter(item=>item.status==='pending'),detail]});
        host.enqueueInput({id:command.id,threadId:thread.id,content:JSON.stringify({type:'question-detail',requestId:request.id,baseRevision:request.revision,kind:detail.kind,optionId:detail.optionId,instruction:'Explain this option, give relevant examples, or add alternatives as requested. Update this SAME pending question with ui_request_input requestId/baseRevision. Preserve responseSchema, existing option IDs and the user selection. This request does not consume the decision or authorize any operation.'}),status:'persisted',runId:null});
        return {inputId:command.id,pending:true};
      }
      case "action.submit": return host.acceptAction(thread, p, command.id);
      case "operation.approve": {
        host.assertMutation(thread.id); const op = host.store.get<Operation>("operation", text(p, "operationId", 200));
        if (!op || op.threadId !== thread.id) throw new HarnessError("NOT_FOUND", "Operation not found");
        if (op.revision !== p.revision || op.status !== "prepared") throw new HarnessError("STALE_REVISION", "Operation has changed; review it again");
        host.projectTrust.assertApproval(op, thread);
        const next = { ...op, approved: true }; host.store.put("operation", op.id, thread.id, next);
        if (host.effectFlags.enabled("security.authorityV1")) { const approval = host.effects.issueApproval(next, thread); host.store.put("approval", approval.approvalId, thread.id, approval); }
        return next;
      }
      case "operation.reject": {
        const op = host.store.get<Operation>("operation", text(p, "operationId", 200));
        if (!op || op.threadId !== thread.id || op.status !== "prepared" || op.revision !== p.revision) throw new HarnessError("STALE_REVISION", "This prepared operation is no longer available");
        const next: Operation = { ...op, status: "cancelled", approved: false };
        host.store.put("operation", op.id, thread.id, next); host.operationData(next);
        const input: Outbox = { id: command.id, threadId: thread.id, content: "The user declined prepared operation " + op.id + ": " + op.description, status: "persisted", runId: null };
        host.enqueueInput(input); return next;
      }
      default: throw new HarnessError("UNKNOWN_COMMAND", "Unknown command: " + command.type);
    }
  }
}
