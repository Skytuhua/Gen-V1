import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HarnessError } from "../contracts/index.ts";
import type { ToolEffectRecord } from "../contracts/tool-effects.ts";
import { observationFreshness } from "./effect-recovery.ts";
import { TOOL_COVERAGE_NOTES } from "./tool-authority.ts";
import type { Store } from "../storage/store.ts";

/** Bounded read-only invocation/observation pages through the existing
 * read-model boundary: owner-scoped scopeKeys, opaque cursors carrying the
 * sequence fence, no cross-owner probing. */

const target = z.strictObject({ threadId: z.string().min(1).max(200) });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = target.extend({ scopeKey: hash });
export const invocationPageSchema = scope.extend({
  limit: z.number().int().min(1).max(50).default(25),
  cursor: z.string().max(2048).optional(),
  invocationId: z.string().max(400).optional(),
});
export const observationQuerySchema = scope.extend({ invocationId: z.string().min(1).max(400) });

interface Scope { threadId: string; accountId: string | null; revoked: boolean }

export class ToolEffectReadModels {
  readonly authority = "personal" as const;
  private readonly scopes = new Map<string, Scope>();
  constructor(private readonly store: Store) {}

  private encode(value: { scope: string; position: number }): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }
  private decode(cursor: string, scopeKey: string): { position: number } {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { scope?: string; position?: number };
      if (value.scope !== scopeKey || typeof value.position !== "number" || value.position < 0) throw new Error("cursor_mismatch");
      return { position: value.position };
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("RESYNC_REQUIRED", "This ledger cursor no longer matches; reopen the page");
    }
  }

  private scoped(scopeKey: string): Scope {
    const found = this.scopes.get(scopeKey);
    if (!found || found.revoked) throw new HarnessError("RESYNC_REQUIRED", "This ledger view expired; reopen it");
    return found;
  }

  /** Opens an owner-fenced view of a thread's ledger. */
  context(input: unknown): { authority: "personal"; threadId: string; scopeKey: string; sequence: number; coverage: string[]; freshness: "CURRENT" | "STALE" | "INDETERMINATE" } {
    const parsed = target.parse(input);
    const thread = this.store.get<{ id: string; accountId?: string | null }>("thread", parsed.threadId);
    if (!thread) throw new HarnessError("NOT_FOUND", "Thread unavailable");
    const scopeKey = randomBytes(32).toString("hex");
    this.scopes.set(scopeKey, { threadId: thread.id, accountId: thread.accountId ?? null, revoked: false });
    if (this.scopes.size > 512) this.scopes.delete(this.scopes.keys().next().value!);
    return { authority: this.authority, threadId: thread.id, scopeKey, sequence: this.store.sequence, coverage: TOOL_COVERAGE_NOTES, freshness: "CURRENT" };
  }

  /** Pages tool-effect transition events in sequence order. */
  invocations(input: unknown): { effects: (ToolEffectRecord & { lastSeq: number })[]; nextCursor: string | null; freshness: "CURRENT" | "STALE" | "INDETERMINATE"; sequence: number } {
    const parsed = invocationPageSchema.parse(input);
    const found = this.scoped(parsed.scopeKey);
    let position = parsed.cursor ? this.decode(parsed.cursor, parsed.scopeKey).position : -1;
    const fence = this.store.sequence;
    const byInvocation = new Map<string, ToolEffectRecord & { lastSeq: number }>();
    while (position < fence && byInvocation.size < parsed.limit) {
      const events = this.store.eventsAfter(position, 200);
      if (!events.length) break;
      for (const event of events) {
        if (event.seq > fence) { position = fence; break; }
        if (byInvocation.size >= parsed.limit) break;
        position = event.seq;
        if (!event.type.startsWith("toolEffect.")) continue;
        const raw = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
        const id = (raw as { result?: { invocationId?: string } } | null)?.result?.invocationId;
        if (!id) continue;
        const effect = this.store.get<ToolEffectRecord>("toolEffect", id);
        if (!effect || effect.threadId !== found.threadId) continue;
        if (parsed.invocationId && id !== parsed.invocationId) continue;
        byInvocation.set(id, { ...effect, lastSeq: event.seq });
      }
    }
    const effects = [...byInvocation.values()];
    const nextCursor = position < fence ? this.encode({ scope: parsed.scopeKey, position }) : null;
    return { effects, nextCursor, freshness: observationFreshness(this.store, fence), sequence: fence };
  }

  /** Returns one effect with its retained transitions — no cross-owner reads. */
  observations(input: unknown): { effect: ToolEffectRecord; freshness: "CURRENT" | "STALE" | "INDETERMINATE" } {
    const parsed = observationQuerySchema.parse(input);
    const found = this.scoped(parsed.scopeKey);
    const effect = this.store.get<ToolEffectRecord>("toolEffect", parsed.invocationId);
    if (!effect || effect.threadId !== found.threadId) throw new HarnessError("NOT_FOUND", "Tool effect unavailable");
    return { effect, freshness: observationFreshness(this.store, this.store.sequence) };
  }

  dispose(): void { this.scopes.clear(); }
}
