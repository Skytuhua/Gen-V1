import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HarnessError } from "../contracts/index.ts";
import type { ApprovalV1, ToolEffectRecord } from "../contracts/tool-effects.ts";
import { observationFreshness } from "./effect-recovery.ts";
import { TOOL_COVERAGE_NOTES } from "./tool-authority.ts";
import type { Store } from "../storage/store.ts";

/** Bounded read-only invocation/observation pages through the existing
 * read-model boundary. A scope retains a bounded, immutable observation cut;
 * current owner checks still apply before any captured data is released. */

const target = z.strictObject({ threadId: z.string().min(1).max(200) });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = target.extend({ scopeKey: hash });
const invocationPageSchema = scope.extend({
  limit: z.number().int().min(1).max(50).default(25),
  cursor: z.string().max(2048).optional(),
  invocationId: z.string().max(400).optional(),
});
const observationQuerySchema = scope.extend({ invocationId: z.string().min(1).max(400) });

/** Public ledger metadata is an explicit allowlist. Private commitments and
 * future host authentication fields stay outside every captured read DTO. */
type PublicOwner = Pick<ToolEffectRecord["owner"], "threadId" | "runId" | "epoch" | "projectId" | "workspaceId" | "accountBinding">;
type PublicTransition = Pick<ToolEffectRecord["transitions"][number], "from" | "to" | "at" | "note">;
export type PublicToolEffect = Pick<ToolEffectRecord, "effectId" | "invocationId" | "attemptId" | "parentInvocationId" | "threadId"
  | "toolId" | "publicRedactedSummary" | "targetPreconditions" | "approvalId" | "state" | "providerReceiptRef"
  | "createdAt" | "updatedAt" | "outcome"> & { owner: PublicOwner; transitions: PublicTransition[] };
export type PublicApproval = Pick<ApprovalV1, "approvalId" | "operationId" | "targetPreconditions"
  | "issuedAt" | "expiresAt" | "remainingUses" | "issuer"> & { owner: PublicOwner };

function publicOwner(owner: ToolEffectRecord["owner"]): PublicOwner {
  return { threadId: owner.threadId, runId: owner.runId, epoch: owner.epoch,
    projectId: owner.projectId, workspaceId: owner.workspaceId, accountBinding: owner.accountBinding };
}
function publicEffect(effect: ToolEffectRecord): PublicToolEffect {
  return {
    effectId: effect.effectId, invocationId: effect.invocationId, attemptId: effect.attemptId,
    parentInvocationId: effect.parentInvocationId, threadId: effect.threadId, toolId: effect.toolId,
    owner: publicOwner(effect.owner), publicRedactedSummary: effect.publicRedactedSummary,
    targetPreconditions: effect.targetPreconditions, approvalId: effect.approvalId, state: effect.state,
    providerReceiptRef: effect.providerReceiptRef, createdAt: effect.createdAt, updatedAt: effect.updatedAt,
    transitions: effect.transitions.map(item => ({ from: item.from, to: item.to, at: item.at,
      ...(item.note === undefined ? {} : { note: item.note }) })),
    ...(effect.outcome === undefined ? {} : { outcome: effect.outcome }),
  };
}
function publicApproval(approval: ApprovalV1): PublicApproval {
  return { approvalId: approval.approvalId, operationId: approval.operationId, owner: publicOwner(approval.owner),
    targetPreconditions: approval.targetPreconditions, issuedAt: approval.issuedAt, expiresAt: approval.expiresAt,
    remainingUses: approval.remainingUses, issuer: approval.issuer };
}

interface ThreadBinding { id: string; accountId?: string | null; projectId?: string | null; workspaceId?: string | null }
interface SnapshotRow { invocationId: string; lastSeq: number; body: string; approval: string | null }
interface Scope { threadId: string; accountId: string | null; projectId: string | null; workspaceId: string | null; revoked: boolean;
  sequence: number; rows: SnapshotRow[]; byId: Map<string, SnapshotRow>; bytes: number }
interface Cursor { scope: string; position: number; filter: string; limit: number }
const MAX_SNAPSHOT_ROWS = 10_000;
const MAX_SCOPE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export class ToolEffectReadModels {
  readonly authority = "personal" as const;
  private readonly scopes = new Map<string, Scope>();
  private readonly cursorKey = randomBytes(32);
  private snapshotBytes = 0;
  constructor(private readonly store: Store) {}

  private encode(value: Cursor): string {
    const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    return body + "." + createHmac("sha256", this.cursorKey).update(body).digest("hex");
  }
  private decode(cursor: string, scopeKey: string, filter: string, limit: number, size: number): number {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (!body || !signature || extra !== undefined || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("cursor_signature");
      const expected = createHmac("sha256", this.cursorKey).update(body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("cursor_signature");
      const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Cursor;
      if (!value || Object.keys(value).length !== 4 || value.scope !== scopeKey || value.filter !== filter || value.limit !== limit
        || !Number.isSafeInteger(value.position) || value.position < 0 || value.position > size) throw new Error("cursor_mismatch");
      return value.position;
    } catch {
      throw new HarnessError("RESYNC_REQUIRED", "This ledger cursor no longer matches; reopen the page");
    }
  }

  private dropScope(key: string): void {
    const found = this.scopes.get(key);
    if (found) this.snapshotBytes -= found.bytes;
    this.scopes.delete(key);
  }

  /** Events contain transition metadata, not historical entity bodies. Capture
   * current authorized bodies once, synchronously under the sole host writer.
   * SQL bounds each materialized row before it enters JavaScript memory. */
  private capture(found: Scope): void {
    const rows = this.store.db.prepare(`
      WITH origins AS (
        SELECT json_extract(payload,'$.result.invocationId') AS id, MIN(seq) AS first_seq
        FROM events WHERE seq <= ? AND thread_id = ? AND type LIKE 'toolEffect.%'
          AND json_type(payload,'$.result.invocationId') = 'text'
          AND COALESCE(json_extract(payload,'$.result.reused'),0) = 0
          AND json_extract(payload,'$.result.state') IN ('DISPATCHED','PREPARED','DENIED')
        GROUP BY json_extract(payload,'$.result.invocationId')
      ), captured AS (
        SELECT e.id, origins.first_seq, e.body, a.body AS approval,
          length(CAST(e.body AS BLOB)) + COALESCE(length(CAST(a.body AS BLOB)),0) AS bytes
        FROM origins JOIN entities e ON e.kind='toolEffect' AND e.id=origins.id
        LEFT JOIN entities a ON a.kind='approval' AND a.id=json_extract(e.body,'$.approvalId')
        WHERE e.thread_id = ? AND json_extract(e.body,'$.threadId') = ?
          AND json_extract(e.body,'$.owner.threadId') = ?
          AND json_extract(e.body,'$.owner.accountBinding') IS ?
          AND json_extract(e.body,'$.owner.projectId') IS ?
          AND json_extract(e.body,'$.owner.workspaceId') IS ?
      )
      SELECT id, first_seq, bytes,
        CASE WHEN bytes <= ? THEN body END AS body,
        CASE WHEN bytes <= ? THEN approval END AS approval
      FROM captured ORDER BY first_seq,id LIMIT ?
    `).iterate(found.sequence, found.threadId, found.threadId, found.threadId, found.threadId,
      found.accountId, found.projectId, found.workspaceId, MAX_SCOPE_BYTES, MAX_SCOPE_BYTES, MAX_SNAPSHOT_ROWS + 1);
    for (const value of rows) {
      const row = value as { id: string; first_seq: number; bytes: number; body: string | null; approval: string | null };
      if (found.rows.length >= MAX_SNAPSHOT_ROWS || row.body === null || found.bytes + row.bytes > MAX_SCOPE_BYTES)
        throw new HarnessError("LEDGER_SNAPSHOT_LIMIT", "This ledger view exceeds the bounded snapshot limit; no partial view was opened");
      const body = JSON.stringify(publicEffect(JSON.parse(row.body) as ToolEffectRecord));
      const approval = row.approval ? JSON.stringify(publicApproval(JSON.parse(row.approval) as ApprovalV1)) : null;
      const entry = { invocationId: row.id, lastSeq: row.first_seq, body, approval };
      found.rows.push(entry); found.byId.set(row.id, entry); found.bytes += row.bytes;
    }
  }

  private scoped(scopeKey: string, threadId: string): Scope {
    const found = this.scopes.get(scopeKey);
    if (!found || found.revoked || found.threadId !== threadId)
      throw new HarnessError("RESYNC_REQUIRED", "This ledger view expired; reopen it");
    const current = this.store.get<ThreadBinding>("thread", found.threadId);
    if (!current || current.id !== found.threadId || (current.accountId ?? null) !== found.accountId
      || (current.projectId ?? null) !== found.projectId || (current.workspaceId ?? null) !== found.workspaceId) {
      found.revoked = true;
      this.dropScope(scopeKey);
      throw new HarnessError("RESYNC_REQUIRED", "This ledger owner changed; reopen the view");
    }
    return found;
  }

  private owns(effect: ToolEffectRecord, found: Scope): boolean {
    return effect.threadId === found.threadId && effect.owner.threadId === found.threadId
      && effect.owner.accountBinding === found.accountId && effect.owner.projectId === found.projectId
      && effect.owner.workspaceId === found.workspaceId;
  }

  /** Opens an owner-fenced view of a thread's ledger. */
  context(input: unknown): { authority: "personal"; threadId: string; scopeKey: string; sequence: number; coverage: string[]; freshness: "CURRENT" | "STALE" | "INDETERMINATE" } {
    const parsed = target.parse(input);
    const thread = this.store.get<ThreadBinding>("thread", parsed.threadId);
    if (!thread || thread.id !== parsed.threadId) throw new HarnessError("NOT_FOUND", "Thread unavailable");
    const scopeKey = randomBytes(32).toString("hex");
    const found: Scope = { threadId: thread.id, accountId: thread.accountId ?? null, projectId: thread.projectId ?? null,
      workspaceId: thread.workspaceId ?? null, revoked: false, sequence: this.store.sequence, rows: [], byId: new Map(), bytes: 0 };
    this.capture(found);
    while (this.scopes.size && (this.scopes.size >= 512 || this.snapshotBytes + found.bytes > MAX_TOTAL_BYTES))
      this.dropScope(this.scopes.keys().next().value!);
    this.scopes.set(scopeKey, found); this.snapshotBytes += found.bytes;
    return { authority: this.authority, threadId: thread.id, scopeKey, sequence: found.sequence, coverage: TOOL_COVERAGE_NOTES, freshness: "CURRENT" };
  }

  /** Pages one captured view. Refresh requires a new context; later settlement
   * is historical data for a newer view, never a mutation of this cursor cut. */
  invocations(input: unknown): { effects: (PublicToolEffect & { lastSeq: number })[]; nextCursor: string | null; freshness: "CURRENT" | "STALE" | "INDETERMINATE"; sequence: number } {
    const parsed = invocationPageSchema.parse(input);
    const found = this.scoped(parsed.scopeKey, parsed.threadId);
    const filter = parsed.invocationId ?? "";
    let position = parsed.cursor ? this.decode(parsed.cursor, parsed.scopeKey, filter, parsed.limit, found.rows.length) : 0;
    const effects: (PublicToolEffect & { lastSeq: number })[] = [];
    while (position < found.rows.length && effects.length < parsed.limit) {
      const row = found.rows[position++]!;
      if (filter && row.invocationId !== filter) continue;
      const current = this.store.get<ToolEffectRecord>("toolEffect", row.invocationId);
      if (!current || !this.owns(current, found)) continue;
      const effect = JSON.parse(row.body) as PublicToolEffect;
      effects.push({ ...effect, lastSeq: row.lastSeq });
    }
    const nextCursor = position < found.rows.length ? this.encode({ scope: parsed.scopeKey, position, filter, limit: parsed.limit }) : null;
    return { effects, nextCursor, freshness: observationFreshness(this.store, found.sequence), sequence: found.sequence };
  }

  /** Returns one effect with its retained transitions and the approval that
   * consumed it — no cross-owner reads. */
  observations(input: unknown): { effect: PublicToolEffect; approval: PublicApproval | null; freshness: "CURRENT" | "STALE" | "INDETERMINATE" } {
    const parsed = observationQuerySchema.parse(input);
    const found = this.scoped(parsed.scopeKey, parsed.threadId);
    const row = found.byId.get(parsed.invocationId);
    const current = this.store.get<ToolEffectRecord>("toolEffect", parsed.invocationId);
    if (!row || !current || !this.owns(current, found)) throw new HarnessError("NOT_FOUND", "Tool effect unavailable");
    const effect = JSON.parse(row.body) as PublicToolEffect;
    const capturedApproval = row.approval ? JSON.parse(row.approval) as PublicApproval : null;
    const currentApproval = capturedApproval ? this.store.get<ApprovalV1>("approval", capturedApproval.approvalId) : null;
    const ownsApproval = (approval: { owner: PublicOwner } | null): boolean => Boolean(approval
      && approval.owner.threadId === effect.owner.threadId && approval.owner.runId === effect.owner.runId
      && approval.owner.epoch === effect.owner.epoch && approval.owner.accountBinding === effect.owner.accountBinding
      && approval.owner.projectId === effect.owner.projectId && approval.owner.workspaceId === effect.owner.workspaceId);
    const approval = ownsApproval(capturedApproval) && ownsApproval(currentApproval) ? capturedApproval : null;
    return { effect, approval, freshness: observationFreshness(this.store, found.sequence) };
  }

  dispose(): void { this.scopes.clear(); this.snapshotBytes = 0; }
}
