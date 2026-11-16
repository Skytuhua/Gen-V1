import { randomUUID } from "node:crypto";
import { HarnessError, type RunContext, type RuntimeCallbacks } from "../contracts/index.ts";
import type {MemoryCheckpointAckV1,MemoryCheckpointRequestV1} from '../contracts/memory-checkpoint.ts';
import {MEMORY_CHECKPOINT_TIMEOUT_MS,validateMemoryCheckpointAck} from '../runtime/memory-checkpoint.ts';

export interface ToolRequest { type: "tool.call"; requestId: string; ctx: RunContext; toolCallId: string; name: string; args: Record<string, unknown> }
export interface ToolReply { type: "tool.result"; requestId: string; ctx: RunContext; toolCallId: string; value?: unknown; error?: string }
export function sameContext(a: RunContext | undefined, b: RunContext): boolean {
  return !!a && a.threadId === b.threadId && a.runId === b.runId && a.epoch === b.epoch;
}

export async function routeToolCall(request: ToolRequest, expected: RunContext, allowed: ReadonlySet<string>, onTool: RuntimeCallbacks["onTool"]): Promise<ToolReply> {
  if (!sameContext(request.ctx, expected)) throw new HarnessError("PI_STALE_RUN", "Stale tool IPC context.");
  if (!allowed.has(request.name)) throw new HarnessError("PI_TOOL_DENIED", "Tool is not in the host allowlist.");
  if (!request.requestId || !request.toolCallId || typeof request.args !== "object" || !request.args || Array.isArray(request.args)) throw new HarnessError("PI_IPC_INVALID", "Invalid tool IPC request.");
  const call = { name: request.name, args: request.args, toolCallId: request.toolCallId };
  const value = await onTool(call, expected);
  return { type: "tool.result", requestId: request.requestId, toolCallId: request.toolCallId, ctx: expected, value };
}

export class ToolBridge {
  private pending = new Map<string, { toolCallId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }>();
  private closed = false;
  constructor(private readonly ctx: RunContext, private readonly send: (message: ToolRequest) => void) {}
  call(toolCallId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error("Pi tool callback aborted."));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(requestId); cleanup(); reject(new Error("Pi tool callback aborted.")); };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.set(requestId, { toolCallId, resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ type: "tool.call", requestId, toolCallId, ctx: this.ctx, name, args }); }
      catch { abort(); }
    });
  }
  receive(reply: ToolReply) {
    if (reply.type !== "tool.result" || !sameContext(reply.ctx, this.ctx)) return;
    const pending = this.pending.get(reply.requestId);
    if (!pending || pending.toolCallId !== reply.toolCallId) return;
    this.pending.delete(reply.requestId); pending.cleanup();
    if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply.value);
  }
  close() {
    this.closed = true;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error("Pi worker disconnected; tool outcome is unavailable.")); }
    this.pending.clear();
  }
}

export interface CheckpointRequest {type:'memory.checkpoint';request:MemoryCheckpointRequestV1}
export interface CheckpointReply {type:'memory.checkpoint.result';requestId:string;ctx:RunContext;value?:unknown;error?:string}

/** One bounded native attempt, with replies isolated from the model tool channel. */
export class CheckpointBridge {
 private pending?:{request:MemoryCheckpointRequestV1;resolve:(value:MemoryCheckpointAckV1)=>void;reject:(error:Error)=>void;cleanup:()=>void};
 private closed=false;
 constructor(private readonly ctx:RunContext,private readonly send:(value:CheckpointRequest)=>void,private readonly timeoutMs=MEMORY_CHECKPOINT_TIMEOUT_MS){}
 call(request:MemoryCheckpointRequestV1,signal?:AbortSignal):Promise<MemoryCheckpointAckV1>{
  if(this.closed||signal?.aborted||this.pending||!sameContext(request.ctx,this.ctx))return Promise.reject(new HarnessError('MEMORY_CHECKPOINT_BLOCKED','The native checkpoint has no current attempt authority.'));
  return new Promise((resolve,reject)=>{
   const abort=()=>{if(this.pending?.request.requestId!==request.requestId)return;this.pending=undefined;cleanup();reject(new HarnessError('MEMORY_CHECKPOINT_BLOCKED','The native checkpoint was cancelled or timed out.'));};
   const timer=setTimeout(abort,this.timeoutMs);timer.unref?.();
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   this.pending={request,resolve,reject,cleanup};signal?.addEventListener('abort',abort,{once:true});
   try{this.send({type:'memory.checkpoint',request});}catch{abort();}
  });
 }
 receive(reply:CheckpointReply):void{
  const pending=this.pending;if(!pending||reply.type!=='memory.checkpoint.result'||!sameContext(reply.ctx,this.ctx)||reply.requestId!==pending.request.requestId)return;
  this.pending=undefined;pending.cleanup();
  try{if(reply.error)throw new HarnessError('MEMORY_CHECKPOINT_BLOCKED','Required checkpoint persistence failed.');pending.resolve(validateMemoryCheckpointAck(reply.value,pending.request));}catch(error){pending.reject(error instanceof Error?error:new Error('Invalid checkpoint receipt.'));}
 }
 close():void{this.closed=true;const pending=this.pending;this.pending=undefined;if(pending){pending.cleanup();pending.reject(new HarnessError('MEMORY_CHECKPOINT_BLOCKED','The native checkpoint owner disconnected.'));}}
}
