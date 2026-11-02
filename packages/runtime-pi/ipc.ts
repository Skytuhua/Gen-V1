import { randomUUID } from "node:crypto";
import { HarnessError, type RunContext, type RuntimeCallbacks } from "../contracts/index.ts";

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
