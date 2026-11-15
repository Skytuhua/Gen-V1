import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { editReceiptV1Schema } from "../packages/contracts/workspace-checkpoints.ts";
import { checkpointScope, EditJournal, sha256hex } from "../packages/workspace/edit-journal.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-journal-v3-"));
  roots.push(root);
  const store = new Store(join(root, "state"));
  stores.push(store);
  const journal = new EditJournal(store);
  const owner = checkpointScope({ projectId: "project", threadId: "thread", workingCopyId: "wc-1", binding: { path: "/w", family: "f" } });
  return { store, journal, owner };
}

it("records a proven structured edit only after the confirmed write", async () => {
  const { journal, owner } = await fixture();
  journal.prepareStructuredEdit({ invocationId: "inv-1", owner, repositoryId: "repo", path: "src/a.ts", beforeDigest: sha256hex("before") });
  expect(journal.pendingPrepared(owner)).toHaveLength(1);
  expect(journal.receipts(owner)).toHaveLength(0);
  const receipt = journal.recordProvenEdit({
    invocationId: "inv-1",
    owner,
    workspaceIdentity: sha256hex("workspace"),
    repositoryId: "repo",
    path: "src/a.ts",
    beforeIdentity: { dev: "1", ino: "2" },
    beforeDigest: sha256hex("before"),
    afterDigest: sha256hex("after"),
    boundedBlobRefs: [{ ref: sha256hex("blob"), bytes: 5, retention: "AVAILABLE" }],
  });
  expect(editReceiptV1Schema.parse(receipt).attribution).toBe("STRUCTURED_EDIT_PROVED");
  expect(journal.pendingPrepared(owner)).toHaveLength(0);
  expect(journal.attribution(owner, "src/a.ts")).toBe("proven");
});

it("keeps conflicting edits to the same path as independent receipts", async () => {
  const { journal, owner } = await fixture();
  journal.recordProvenEdit({ invocationId: "inv-a", owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "src/shared.ts", beforeIdentity: null, beforeDigest: sha256hex("v0"), afterDigest: sha256hex("v1") });
  journal.recordProvenEdit({ invocationId: "inv-b", owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "src/shared.ts", beforeIdentity: null, beforeDigest: sha256hex("v1"), afterDigest: sha256hex("v2") });
  const receipts = journal.receipts(owner, { path: "src/shared.ts" });
  expect(receipts.map((entry) => entry.invocationId)).toEqual(["inv-a", "inv-b"]);
  expect(receipts[1]!.beforeDigest).toBe(sha256hex("v1"));
});

it("marks shell-window changes process-window-only and unexplained files unattributed", async () => {
  const { journal, owner } = await fixture();
  journal.recordProcessWindow({ invocationId: "shell-1", owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "gen/out.txt", afterDigest: sha256hex("x") });
  journal.recordUnattributed({ owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "mystery.bin" });
  expect(journal.attribution(owner, "gen/out.txt")).toBe("process-window");
  expect(journal.attribution(owner, "mystery.bin")).toBe("unattributed");
  expect(journal.attribution(owner, "never.seen")).toBe("unattributed");
});

it("admits receipts with no digest when file access lacked read authority", async () => {
  const { journal, owner } = await fixture();
  const receipt = journal.recordProvenEdit({ invocationId: "inv-9", owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "readonly/none.txt", beforeIdentity: null, beforeDigest: null, afterDigest: sha256hex("y") });
  expect(editReceiptV1Schema.parse(receipt).beforeDigest).toBeNull();
});

it("isolates receipts to the admitted owner scope", async () => {
  const { journal, owner } = await fixture();
  const other = checkpointScope({ projectId: "project", threadId: "other", workingCopyId: "wc-2", binding: { path: "/w2", family: "f2" } });
  journal.recordProvenEdit({ invocationId: "inv-1", owner, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "a.ts", beforeIdentity: null, beforeDigest: null, afterDigest: sha256hex("z") });
  expect(journal.receipts(other)).toHaveLength(0);
  expect(() => journal.requireOwned(owner, other)).toThrow(expect.objectContaining({ code: "CAPABILITY_DENIED" }));
});

it("leaves a prepared marker as recovery evidence when no write completed", async () => {
  const { journal, owner } = await fixture();
  journal.prepareStructuredEdit({ invocationId: "inv-crash", owner, repositoryId: "repo", path: "src/crashed.ts", beforeDigest: null });
  const pending = journal.pendingPrepared(owner);
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ invocationId: "inv-crash", path: "src/crashed.ts" });
});

it("rejects receipts that miss their scope or write journal state outside a transaction", async () => {
  const { store, journal, owner } = await fixture();
  expect(() => store.put("workspaceEditReceipt", "x", null, {})).toThrow();
  expect(() =>
    journal.recordProvenEdit({ invocationId: "bad", owner: { ...owner, binding: "nope" }, workspaceIdentity: sha256hex("w"), repositoryId: "repo", path: "a.ts", beforeIdentity: null, beforeDigest: null, afterDigest: sha256hex("z") }),
  ).toThrow();
});
