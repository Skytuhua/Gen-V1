import { randomUUID } from "node:crypto";
import type { RunContext, RuntimeEvent, RuntimeUsage } from "../contracts/index.ts";
import { safeError } from "./sdk.ts";
import { messageInputIds } from "./input-envelope.ts";

interface State { isIdle: boolean; isCompacting?: boolean; isRetrying?: boolean }
type Event = { type: string; [key: string]: any };
function text(content: unknown): string {
  return typeof content === "string" ? content : Array.isArray(content) ? content.filter(c => c?.type === "text" && typeof c.text === "string").map(c => c.text).join("") : "";
}
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export class EventNormalizer {
  private messageId: string | undefined;
  private inputIds = new Set<string>();
  private collectingInputs = false;
  private responseInputIds: string[] = [];
  constructor(private readonly ctx: RunContext, private readonly output: (event: RuntimeEvent) => void) {}
  emit(type: string, payload: Record<string, unknown> = {}) { this.output({ ...payload, ...this.ctx, type }); }
  accept(event: Event, state: State) {
    switch (event.type) {
      case "message_start":
        if (event.message?.role === "user") {
          const inputIds = messageInputIds(event.message, this.ctx);
          if (inputIds.length) {
            if (!this.collectingInputs) this.inputIds.clear();
            for (const id of inputIds) this.inputIds.add(id);
            this.collectingInputs = true;
            // SDK queue preflight is insufficient: the envelope has now entered a turn.
            this.emit("input.processing", { inputIds });
          }
        } else if (event.message?.role === "assistant") {
          this.messageId = randomUUID();
          this.responseInputIds = [...this.inputIds];
          this.collectingInputs = false;
        }
        break;
      case "message_update":
        if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
          this.messageId ??= randomUUID();
          this.emit("assistant.delta", { messageId: this.messageId, delta: event.assistantMessageEvent.delta });
        }
        break;
      case "message_end":
        if (event.message?.role === "assistant") {
          this.messageId ??= randomUUID();
          this.emit("assistant.message", { messageId: this.messageId, content: text(event.message.content), inputIds: [...this.responseInputIds] });
          this.messageId = undefined;
          if (event.message.stopReason === "error") this.emit("error", { message: safeError(new Error(event.message.errorMessage || "Pi provider request failed. Check subscription authentication with pnpm agent:login.")) });
        }
        break;
      case "tool_execution_start": case "tool_execution_update": case "tool_execution_end":
        this.emit("activity", { message: `${event.toolName ?? "Tool"}: ${event.type === "tool_execution_start" ? "running" : event.type === "tool_execution_end" ? event.isError ? "failed" : "finished" : "progress"}`, toolCallId: event.toolCallId });
        break;
      case "compaction_start": this.emit("compaction.start", { reason: event.reason }); break;
      case "compaction_end":
        this.emit("compaction.end", { reason: event.reason, aborted: event.aborted, willRetry: event.willRetry });
        if (event.errorMessage) this.emit("error", { message: safeError(new Error(event.errorMessage)) });
        break;
      case "auto_retry_start": this.emit("activity", { message: `Pi is retrying (${event.attempt}/${event.maxAttempts}).` }); break;
      case "auto_retry_end": if (!event.success && event.finalError) this.emit("error", { message: safeError(new Error(event.finalError)) }); break;
      case "agent_settled":
        if (state.isIdle && !state.isCompacting && !state.isRetrying) this.emit("settled", { aborted: event.aborted === true });
        break;
    }
  }
  usage(context: { tokens: number | null; contextWindow: number; percent: number | null } | undefined,
      stats: { tokens: { input: number; output: number }; cost: number } | undefined, activity: RuntimeUsage["activity"]) {
    this.emit("usage", { usage: {
      contextTokens: number(context?.tokens), contextWindow: number(context?.contextWindow), inputTokens: number(stats?.tokens.input),
      outputTokens: number(stats?.tokens.output), cost: null, activity, sessionPercent: null, weeklyPercent: null,
    } satisfies RuntimeUsage });
  }
}
