import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Sha256Hex } from '../contracts/hashing.ts';
import { HarnessError } from "../contracts/index.ts";
import type { Store } from "../storage/store.ts";
import {
  checkpointScopeSchema,
  editReceiptV1Schema,
  type CheckpointScope,
  type EditReceiptV1,
} from "../contracts/workspace-checkpoints.ts";

// M08 provenance journal. Receipts are append-only Store entities written from
// synchronous Store.internal callbacks — the host stays the sole SQLite writer
// and no receipt writer ever awaits inside a projection callback. A structured
// (approved) edit records a prepared marker before the write and the proven
// receipt only after the write is confirmed; a shell window proves nothing
// about which agent authored a line, so unattributed writes are recorded as
// process-window evidence instead of guessing an author. Two agents editing
// the same path keep independent receipts — the journal never merges them.

const EDIT_JOURNAL_KIND = "workspaceEditReceipt" as const;
const EDIT_JOURNAL_PREPARED_KIND = "workspaceEditPrepared" as const;

export const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

interface StoredReceipt extends EditReceiptV1 {
  journalId: string;
}

interface PreparedEdit {
  version: 1;
  invocationId: string;
  owner: CheckpointScope;
  repositoryId: string;
  path: string;
  beforeDigest: string | null;
  createdAt: string;
}

const ownerParse = (owner: CheckpointScope) => checkpointScopeSchema.parse(owner);

/** Stable scope binding: digests the exact worktree/family identity a receipt names. */
export function checkpointScope(input: {
  projectId: string;
  threadId: string | null;
  workingCopyId: string | null;
  binding: unknown;
}): CheckpointScope {
  const scope = {
    projectId: input.projectId,
    threadId: input.threadId,
    workingCopyId: input.workingCopyId,
    binding: sha256hex(JSON.stringify(input.binding)),
  };
  return checkpointScopeSchema.parse(scope);
}

/** Host-computed checkpoint owner for a thread's managed binding. Routes and
 *  the operation pipeline must agree on the digested binding material. */
export function workspaceOwnerScope(
  projectId: string,
  threadId: string | undefined,
  workspace: { id: string; path: string; gitDirectory?: string | null; identity?: unknown } | undefined,
): CheckpointScope {
  return checkpointScope({
    projectId,
    threadId: threadId ?? null,
    workingCopyId: workspace?.id ?? null,
    binding: {
      path: workspace?.path ?? null,
      workingCopyId: workspace?.id ?? null,
      gitDirectory: workspace?.gitDirectory ?? null,
      identity: workspace?.identity ?? null,
    },
  });
}

const preparedSchema = z.strictObject({
  version: z.literal(1),
  invocationId: z.string().min(1).max(200),
  owner: checkpointScopeSchema,
  repositoryId: z.string().min(1).max(200),
  path: z.string().min(1).max(1024),
  beforeDigest: Sha256Hex.nullable(),
  createdAt: z.iso.datetime(),
});

const sameScope = (a: CheckpointScope, b: CheckpointScope) =>
  a.projectId === b.projectId && a.threadId === b.threadId && a.workingCopyId === b.workingCopyId && a.binding === b.binding;

export class EditJournal {
  constructor(private readonly store: Store) {}

  /** A prepared marker survives a crash between admission and the confirmed write. */
  prepareStructuredEdit(input: {
    invocationId: string;
    owner: CheckpointScope;
    repositoryId: string;
    path: string;
    beforeDigest: string | null;
  }): PreparedEdit {
    const prepared: PreparedEdit = preparedSchema.parse({
      version: 1,
      invocationId: input.invocationId,
      owner: ownerParse(input.owner),
      repositoryId: input.repositoryId,
      path: input.path,
      beforeDigest: input.beforeDigest,
      createdAt: new Date().toISOString(),
    });
    this.store.internal("workspace.edit.prepare", input.owner.threadId, () => {
      this.store.put(EDIT_JOURNAL_PREPARED_KIND, prepared.invocationId + "|" + prepared.path, prepared.owner.threadId, prepared);
    });
    return prepared;
  }

  /** Append after a confirmed write. before/after bytes are captured only through approved file access upstream. */
  recordProvenEdit(input: {
    invocationId: string;
    owner: CheckpointScope;
    workspaceIdentity: string;
    repositoryId: string;
    path: string;
    beforeIdentity: { dev: string; ino: string } | null;
    beforeDigest: string | null;
    afterDigest: string;
    boundedBlobRefs?: EditReceiptV1["boundedBlobRefs"];
  }): EditReceiptV1 {
    const receipt = this.append({
      version: 1,
      invocationId: input.invocationId,
      owner: ownerParse(input.owner),
      workspaceIdentity: input.workspaceIdentity,
      repositoryId: input.repositoryId,
      path: input.path,
      beforeIdentity: input.beforeIdentity,
      beforeDigest: input.beforeDigest,
      afterDigest: input.afterDigest,
      boundedBlobRefs: input.boundedBlobRefs ?? [],
      attribution: "STRUCTURED_EDIT_PROVED",
      createdAt: new Date().toISOString(),
    });
    this.store.internal("workspace.edit.prepared.consumed", input.owner.threadId, () => {
      const marker = this.store.get<PreparedEdit>(EDIT_JOURNAL_PREPARED_KIND, input.invocationId + "|" + input.path);
      if (marker && marker.invocationId === input.invocationId && marker.path === input.path)
        this.store.put(EDIT_JOURNAL_PREPARED_KIND, marker.invocationId + "|" + marker.path, marker.owner.threadId, { ...marker, consumed: receipt });
    });
    return receipt;
  }

  /** A process window observed a change without an attributable structured edit. */
  recordProcessWindow(input: {
    invocationId: string;
    owner: CheckpointScope;
    workspaceIdentity: string;
    repositoryId: string;
    path: string;
    beforeDigest?: string | null;
    afterDigest?: string | null;
  }): EditReceiptV1 {
    return this.append({
      version: 1,
      invocationId: input.invocationId,
      owner: ownerParse(input.owner),
      workspaceIdentity: input.workspaceIdentity,
      repositoryId: input.repositoryId,
      path: input.path,
      beforeIdentity: null,
      beforeDigest: input.beforeDigest ?? null,
      afterDigest: input.afterDigest ?? null,
      boundedBlobRefs: [],
      attribution: "PROCESS_WINDOW_ONLY",
      createdAt: new Date().toISOString(),
    });
  }

  recordUnattributed(input: {
    owner: CheckpointScope;
    workspaceIdentity: string;
    repositoryId: string;
    path: string;
    beforeDigest?: string | null;
    afterDigest?: string | null;
  }): EditReceiptV1 {
    return this.append({
      version: 1,
      invocationId: "process:" + randomUUID(),
      owner: ownerParse(input.owner),
      workspaceIdentity: input.workspaceIdentity,
      repositoryId: input.repositoryId,
      path: input.path,
      beforeIdentity: null,
      beforeDigest: input.beforeDigest ?? null,
      afterDigest: input.afterDigest ?? null,
      boundedBlobRefs: [],
      attribution: "UNATTRIBUTED",
      createdAt: new Date().toISOString(),
    });
  }

  private append(receipt: EditReceiptV1): EditReceiptV1 {
    const stored: StoredReceipt = { ...editReceiptV1Schema.parse(receipt), journalId: "receipt-" + randomUUID() };
    this.store.internal("workspace.edit.receipt", receipt.owner.threadId, () => {
      this.store.put(EDIT_JOURNAL_KIND, stored.journalId, stored.owner.threadId, stored);
    });
    const { journalId: _internal, ...external } = stored;
    void _internal;
    return external;
  }

  /** Conflicting receipts from different invocations stay independent and in order. */
  receipts(owner: CheckpointScope, filter?: { path?: string; repositoryId?: string }): StoredReceipt[] {
    const scope = ownerParse(owner);
    return this.store
      .all<StoredReceipt>(EDIT_JOURNAL_KIND)
      .filter(
        (entry) =>
          sameScope(entry.owner, scope) &&
          (!filter?.path || entry.path === filter.path) &&
          (!filter?.repositoryId || entry.repositoryId === filter.repositoryId),
      );
  }

  /** Prepared markers never consumed by a confirmed write are recovery evidence. */
  pendingPrepared(owner: CheckpointScope): PreparedEdit[] {
    const scope = ownerParse(owner);
    return this.store
      .all<PreparedEdit & { consumed?: unknown }>(EDIT_JOURNAL_PREPARED_KIND)
      .filter((entry) => sameScope(entry.owner, scope) && entry.consumed === undefined);
  }

  /** Best-effort attribution of a path for review: the newest receipt decides. */
  attribution(owner: CheckpointScope, path: string): "proven" | "process-window" | "unattributed" {
    const entries = this.receipts(owner, { path });
    if (!entries.length) return "unattributed";
    const last = entries[entries.length - 1];
    if (last.attribution === "STRUCTURED_EDIT_PROVED") return "proven";
    if (last.attribution === "PROCESS_WINDOW_ONLY") return "process-window";
    return "unattributed";
  }

  /** A hunk can auto-enter a selective commit only when every receipt covering it is proven
   *  and the live bytes still equal the newest proven postimage — a later change made
   *  outside the journal has no receipt and stays unattributed. */
  hunkAttribution(owner: CheckpointScope, path: string, currentDigest: string | null): "proven" | "process-window" | "unattributed" {
    const entries = this.receipts(owner, { path });
    if (!entries.length) return "unattributed";
    if (entries.some((entry) => entry.attribution === "UNATTRIBUTED")) return "unattributed";
    if (entries.some((entry) => entry.attribution === "PROCESS_WINDOW_ONLY")) return "process-window";
    return entries[entries.length - 1]!.afterDigest === currentDigest ? "proven" : "unattributed";
  }

  requireOwned(owner: CheckpointScope, scope: CheckpointScope): void {
    if (!sameScope(owner, scope)) throw new HarnessError("CAPABILITY_DENIED", "The journal scope does not match the admitted owner.");
  }
}
