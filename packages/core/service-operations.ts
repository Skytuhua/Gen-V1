import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import {
  HarnessError,
  type DataRecord,
  type Operation,
  type ResourceGrant,
  type RunContext,
  type Thread,
  type ApprovedWriteOrigin,
  type CompletedWriteReceipt,
  type WriteHookDiagnostic,
} from "../contracts/index.ts";
import type { SendModeV1 } from "../contracts/source-selection.ts";
import type { DomainContext } from "../capabilities/index.ts";
import { Store } from "../storage/store.ts";
import { assertNotStorage, canonical, inside } from "./security.ts";
import { ToolEffectLedger, createToolEffectFlags, ownerFor } from "./tool-effects.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { EditJournal, workspaceOwnerScope } from "../workspace/edit-journal.ts";
import { CheckpointService } from "../workspace/checkpoints.ts";
import type { WorkbenchQueuedInput } from "./source-workbench.ts";
import type { HostOperationExecutor } from "./service.ts";

type Outbox = WorkbenchQueuedInput & {
  messageId?: string;
  completedWrite?: CompletedWriteReceipt;
  hookClaimed?: boolean;
  hookDiagnostic?: WriteHookDiagnostic;
  sendMode?: SendModeV1;
};

export interface ServiceOperationsHost {
  store: Store;
  effects: ToolEffectLedger;
  effectFlags: ReturnType<typeof createToolEffectFlags>;
  aborts: Map<string, AbortController>;
  closed(): boolean;
  assertMutation(id: string): void;
  thread(id: string): Thread;
  context(
    threadId: string,
    signal?: AbortSignal,
    operationId?: string,
    authority?: RunContext,
    completedWrite?: (evidence: { path: string; sha256: string; bytes: number }) => void,
    preWrite?: (evidence: { path: string; bytes: Uint8Array; sha256: string }) => Promise<void>,
  ): DomainContext;
  operationExecutor(kind: string): HostOperationExecutor | undefined;
  queue(): Promise<void>;
  setQueue(promise: Promise<void>): void;
  retainController(control: AbortController): void;
  releaseController(threadId: string, control: AbortController): void;
  operationData(operation: Operation, progress?: { message: string; counts?: unknown }): void;
  enqueueInput(input: Outbox): void;
  deliverOutbox(threadId: string): Promise<void>;
  background(promise: Promise<unknown>): void;
  approvedWriteHooks(): boolean;
}

export class ServiceOperations {
  private m08Journal?: EditJournal;
  private m08Checkpoints?: CheckpointService;
  private m08PreimageDigests = new Map<string, string>();
  private m08PendingReceipts: { operation: Operation; evidence: { path: string; sha256: string; bytes: number } }[] = [];

  constructor(private readonly host: ServiceOperationsHost) {}

  async dispatchOperation(id: string): Promise<unknown> {
    const host = this.host;
    const requested = host.store.get<Operation>('operation', id);
    if (!requested) throw new HarnessError('NOT_FOUND', 'Operation unavailable');
    const control = host.aborts.get(requested.threadId) ?? new AbortController();
    host.aborts.set(requested.threadId, control);
    host.retainController(control);
    const previous = host.queue();
    let release!: () => void;
    host.setQueue(new Promise<void>(resolve => { release = resolve; }));
    await previous;
    try {
      // Capture cancellation before waiting. Stop followed by Resume must not
      // lend a new run's controller to an already queued effect.
      if (host.closed() || control.signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Queued operation was stopped');
      return await this.executeOperation(id, control);
    } finally { host.releaseController(requested.threadId, control); release(); }
  }

  private async executeOperation(id: string, control: AbortController): Promise<unknown> {
    const host = this.host;
    const op = host.store.get<Operation>("operation", id);
    if (!op) throw new HarnessError("NOT_FOUND", "Operation unavailable");
    if (["succeeded", "failed", "cancelled"].includes(op.status)) return op;
    if (op.status !== "prepared") throw new HarnessError("RECONCILIATION_REQUIRED", "An operation is already running or has an uncertain outcome");
    host.assertMutation(op.threadId);
    if (!op.approved) throw new HarnessError("APPROVAL_REQUIRED", "Approve this prepared operation first");
    const markStarted = () => { const started: Operation = { ...op, status: "running" }; host.store.put("operation", id, op.threadId, started); host.operationData(started); return { operationId: id }; };
    if (host.effectFlags.enabled("audit.effectsV1") || host.effectFlags.enabled("security.authorityV1")) {
      try {
        host.effects.verifyOperationApproval(op, host.thread(op.threadId));
        host.effects.admitOperationDispatch(op, host.thread(op.threadId), markStarted);
      } catch (error) {
        if (error instanceof HarnessError && error.code === "APPROVAL_REQUIRED") {
          const current = host.store.get<Operation>("operation", id);
          if (current?.status === "prepared" && current.approved && current.revision === op.revision)
            host.store.internal("operation.approval_required", op.threadId, () => {
              const review = { ...current, approved: false };
              host.store.put("operation", id, op.threadId, review); host.operationData(review);
              return { operationId: id };
            });
        }
        throw error;
      }
    } else host.store.internal("operation.started", op.threadId, markStarted);
    try {
      const domain = await import("../capabilities/index.ts");
      if (host.effectFlags.enabled("audit.effectsV1") || host.effectFlags.enabled("security.authorityV1")) {
        // Module loading yields after admission. Revalidate the durable owner
        // before the executor can submit an effect; the approval stays spent.
        const admitted = host.effects.get("operation:" + id + "@" + op.revision), current = host.thread(op.threadId);
        const owner = admitted?.owner;
        if (!owner || admitted.state !== "DISPATCHED" || owner.threadId !== current.id || owner.runId !== (current.runId ?? null)
          || owner.epoch !== current.epoch || owner.accountBinding !== (current.accountId ?? null)
          || owner.projectId !== (current.projectId ?? null) || owner.workspaceId !== (current.workspaceId ?? null))
          throw new HarnessError("AUTHORITY_DENIED", "The admitted owner changed before dispatch");
      }
      let writeEvidence:{path:string;sha256:string;bytes:number}|undefined;
      const hostExecutor=host.operationExecutor(op.kind),running={...op,status:'running' as const};
      const result = hostExecutor
        ? await hostExecutor(running,Object.freeze({signal:control.signal,owner:Object.freeze(ownerFor(host.thread(op.threadId))),authenticatedApprovals:host.effectFlags.enabled('security.authorityV1')}))
        : await domain.executeDomainOperation(running, host.context(op.threadId, control.signal, op.id,undefined,evidence=>{writeEvidence=evidence;},evidence=>this.captureEditPreimage(op,evidence)));
      if (result && typeof result === "object" && "exitCode" in result && (result.exitCode !== 0 || ("cancelled" in result && result.cancelled) || ("timedOut" in result && result.timedOut))) {
        throw new HarnessError("OPERATION_FAILED", "The check did not finish successfully", result);
      }
      const renewedGrant = await this.replacementGrant(op, result);
      if (!host.closed()) host.store.internal("operation.succeeded", op.threadId, () => { const ended: Operation = { ...op, status: "succeeded", result }; if (renewedGrant) host.store.put("resource", renewedGrant.id, op.threadId, renewedGrant); host.store.put("operation", id, op.threadId, ended); host.operationData(ended); this.enqueueOperationResult(ended,writeEvidence); return { operationId: id }; });
      // Journal receipts append in their own transactions — Store rejects a
      // nested transaction, so they must run after the success commit returns.
      for(const pending of this.m08PendingReceipts.splice(0))this.recordEditReceipt(pending.operation,pending.evidence);
      if (host.effectFlags.enabled("audit.effectsV1") || host.effectFlags.enabled("security.authorityV1")) host.effects.settle("operation:" + id + "@" + op.revision, { value: result }, "SUCCEEDED");
      host.background(host.deliverOutbox(op.threadId));
      return result;
    } catch (error) {
      if (!host.closed()) host.store.internal("operation.failed", op.threadId, () => { const ended: Operation = { ...op, status: control.signal.aborted || error instanceof HarnessError && error.code === "OPERATION_OUTCOME_UNKNOWN" ? "unknown" : "failed", error: error instanceof Error ? error.message : String(error), ...(error instanceof HarnessError && error.details ? { result: error.details } : {}) }; host.store.put("operation", id, op.threadId, ended); host.operationData(ended); this.enqueueOperationResult(ended); return { operationId: id }; });
      if ((host.effectFlags.enabled("audit.effectsV1") || host.effectFlags.enabled("security.authorityV1")) && host.effects.get("operation:" + id + "@" + op.revision)) host.effects.settle("operation:" + id + "@" + op.revision, { error: error instanceof Error ? error.message : String(error) }, control.signal.aborted || error instanceof HarnessError && error.code === "OPERATION_OUTCOME_UNKNOWN" ? "UNKNOWN_EXTERNAL_OUTCOME" : "FAILED");
      host.background(host.deliverOutbox(op.threadId));
      throw error;
    }
  }

  private async replacementGrant(operation: Operation, result: unknown): Promise<ResourceGrant | null> {
    const host = this.host;
    if (operation.kind !== "file.replace" || typeof operation.args.resourceId !== "string" || operation.args.path) return null;
    const grant = host.store.get<ResourceGrant>("resource", operation.args.resourceId);
    if (!grant || grant.threadId !== operation.threadId || !grant.identity || !result || typeof result !== "object" || !("sha256" in result)) return null;
    // An approved atomic replacement deliberately changes this file's identity.
    // Pin only the opened file whose bytes match the executor's recorded result.
    try {
      if (await canonical(grant.path) !== grant.path) return null;
      assertNotStorage(grant.path, host.store.dataDir);
      const file = await open(grant.path, "r");
      try {
        const info = await file.stat({ bigint: true });
        if (info.size > 8 * 1024 * 1024 || createHash("sha256").update(await file.readFile()).digest("hex") !== result.sha256 || await canonical(grant.path) !== grant.path) return null;
        return { ...grant, identity: { dev: String(info.dev), ino: String(info.ino) } };
      } finally { await file.close(); }
    } catch { return null; }
  }

  /** M08: capture the preimage checkpoint and journal preparation for an
   *  approved managed-workspace write, before the bytes change. Best effort:
   *  checkpoint capture failures never abort an already-approved write. */
  private async captureEditPreimage(op: Operation, evidence: {path:string;bytes:Uint8Array;sha256:string}): Promise<void> {
    const host = this.host;
    if(!capabilityEnabled('workspace.provenanceV1')&&!capabilityEnabled('workspace.checkpointsV1'))return;
    const thread=host.store.get<Thread>('thread',op.threadId);
    if(!thread?.projectId||!thread.workspaceId)return;
    const binding=host.store.get<{id:string;threadId:string;projectId:string;path:string;gitDirectory?:string|null;identity?:unknown}>('workspaceBinding',thread.workspaceId);
    if(!binding||binding.id!==thread.workspaceId||binding.threadId!==thread.id||binding.projectId!==thread.projectId||!inside(binding.path,evidence.path))return;
    const owner=workspaceOwnerScope(thread.projectId,thread.id,binding),path=relative(binding.path,evidence.path).split(sep).join('/');
    this.m08PreimageDigests.set(op.id,evidence.sha256);
    try{
      if(capabilityEnabled('workspace.checkpointsV1')){
        const info=await stat(evidence.path).catch(()=>null);
        await (this.m08Checkpoints??=new CheckpointService(host.store)).createFromBytes({owner,files:[{path,data:Buffer.from(evidence.bytes),identity:info?{dev:String(info.dev),ino:String(info.ino)}:null}],label:`Before ${op.description}`,provenance:{kind:'guarded_write',operationId:op.id}});
      }
    }catch{/* a failed snapshot never blocks an approved write */}
    try{
      if(capabilityEnabled('workspace.provenanceV1'))(this.m08Journal??=new EditJournal(host.store)).prepareStructuredEdit({invocationId:'op:'+op.id,owner,repositoryId:owner.projectId,path,beforeDigest:evidence.sha256});
    }catch{/* journal preparation is best effort */}
  }

  /** M08: record a proven edit receipt for a completed managed-workspace write. */
  private recordEditReceipt(operation: Operation,evidence:{path:string;sha256:string;bytes:number}): void {
    const host = this.host;
    if(!capabilityEnabled('workspace.provenanceV1'))return;
    try{
      const thread=host.store.get<Thread>('thread',operation.threadId);
      if(!thread?.projectId||!thread.workspaceId)return;
      const binding=host.store.get<{id:string;threadId:string;projectId:string;path:string;gitDirectory?:string|null;identity?:unknown}>('workspaceBinding',thread.workspaceId);
      if(!binding||binding.id!==thread.workspaceId||binding.threadId!==thread.id||binding.projectId!==thread.projectId||!inside(binding.path,evidence.path))return;
      const owner=workspaceOwnerScope(thread.projectId,thread.id,binding),path=relative(binding.path,evidence.path).split(sep).join('/'),beforeDigest=this.m08PreimageDigests.get(operation.id)??null;
      this.m08PreimageDigests.delete(operation.id);
      (this.m08Journal??=new EditJournal(host.store)).recordProvenEdit({invocationId:'op:'+operation.id,owner,repositoryId:owner.projectId,workspaceIdentity:owner.binding,path,beforeIdentity:null,beforeDigest,afterDigest:evidence.sha256,boundedBlobRefs:[]});
    }catch{/* journal receipts never block the outbox */}
  }

  private enqueueOperationResult(operation: Operation,writeEvidence?:{path:string;sha256:string;bytes:number}): void {
    const host = this.host;
    const data = host.store.get<DataRecord>("data", operation.id), input: Outbox = {
      id: "operation-result:" + operation.id, threadId: operation.threadId, status: "persisted", runId: null,
      content: "Executor receipt: operation " + operation.id + " (" + operation.kind + ") is " + operation.status + ". " + (operation.error ?? "") + " Inspect evidence data " + data?.id + "@" + data?.revision + " and the operation ledger before continuing. Do not repeat a completed effect."
    };
    if(host.approvedWriteHooks()&&operation.kind==='file.replace'&&operation.status==='succeeded'){
      const capture=host.store.get<{revision:number;origin?:ApprovedWriteOrigin;unavailable?:'scope_unavailable'|'no_project'}>('operationWriteOrigin',operation.id);
      if(capture?.revision===operation.revision&&capture.origin&&writeEvidence){input.completedWrite={operationId:operation.id,revision:operation.revision,inputId:input.id,origin:capture.origin,...writeEvidence};this.m08PendingReceipts.push({operation,evidence:writeEvidence});}
      else input.hookDiagnostic={operationId:operation.id,revision:operation.revision,inputId:input.id,status:capture?.unavailable??'scope_unavailable',message:'No authenticated source/project write origin was captured; no hook was run.'};
    }
    if (!host.store.get("outbox", input.id)) host.enqueueInput(input);
    if(input.hookDiagnostic)host.operationData(operation);
  }
}
