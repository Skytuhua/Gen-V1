import { z } from "zod";

// M08 managed-workspace contracts. These records describe provenance, file
// checkpoints, restore plans and selective commits; none of them grant write
// authority by themselves. Read/parse only — every mutation still goes through
// the host-owned Store transaction and the managed operation lock.

const id = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const oid = z.string().regex(/^[0-9a-f]{40}$/);
const time = z.iso.datetime();
const utf8 = (value: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;

// Exact project-relative paths, shared with the frozen checkpoint adapter.
const protectedNames = new Set([".git", ".gen", ".gen-main", "checkpoints", "harness.sqlite", "harness.sqlite-wal", "harness.sqlite-shm", ".host-lease.sqlite", ".host-lease.sqlite-wal", ".host-lease.sqlite-shm", "pi", "artifacts", "official", "accounts", "hermes", "github", "git", "integrations"]);
export const checkpointPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      utf8(value) &&
      new TextEncoder().encode(value).byteLength <= 1024 &&
      !/[\x00:\\]/.test(value) &&
      value.split("/").every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !protectedNames.has(part.toLowerCase()) &&
          !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(part.split(".")[0].replace(/ +$/, "")),
      ),
    "Expected an exact, safe project-relative path.",
  );

const workspaceFileIdentitySchema = z.strictObject({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/) });


// The owner scope matches the existing read-only checkpoint adapter: project +
// owning conversation + working-copy binding digest.
export const checkpointScopeSchema = z.strictObject({
  projectId: id,
  threadId: id.nullable(),
  workingCopyId: id.nullable(),
  binding: sha256,
});
export type CheckpointScope = z.infer<typeof checkpointScopeSchema>;

const EDIT_RECEIPT_ATTRIBUTION = ["STRUCTURED_EDIT_PROVED", "PROCESS_WINDOW_ONLY", "UNATTRIBUTED"] as const;
const editAttributionSchema = z.enum(EDIT_RECEIPT_ATTRIBUTION);


const boundedBlobRefSchema = z.strictObject({
  ref: sha256,
  bytes: z.number().int().nonnegative(),
  retention: z.enum(["AVAILABLE", "EXPIRED", "MISSING"]),
});


export const editReceiptV1Schema = z.strictObject({
  version: z.literal(1),
  invocationId: id,
  owner: checkpointScopeSchema,
  workspaceIdentity: sha256,
  repositoryId: id,
  path: checkpointPathSchema,
  beforeIdentity: workspaceFileIdentitySchema.nullable(),
  beforeDigest: sha256.nullable(),
  afterDigest: sha256.nullable(),
  boundedBlobRefs: z.array(boundedBlobRefSchema).max(4),
  attribution: editAttributionSchema,
  createdAt: time,
});
export type EditReceiptV1 = z.infer<typeof editReceiptV1Schema>;

export const CHECKPOINT_V1_LIMITS = {
  files: 200,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  exclusions: 2000,
} as const;

const checkpointFileV1Schema = z.strictObject({
  path: checkpointPathSchema,
  identity: workspaceFileIdentitySchema.nullable(),
  digest: sha256,
  blobRef: sha256,
});


const checkpointExclusionV1Schema = z.strictObject({
  path: z.string().min(1).max(1024),
  reason: z.enum(["secret", "binary", "too_large", "unsupported"]),
});


export const checkpointV1Schema = z.strictObject({
  version: z.literal(1),
  id,
  scope: checkpointScopeSchema,
  sourceCut: sha256,
  createdAt: time,
  files: z.array(checkpointFileV1Schema).max(CHECKPOINT_V1_LIMITS.files),
  exclusions: z.array(checkpointExclusionV1Schema).max(CHECKPOINT_V1_LIMITS.exclusions),
  retention: z.enum(["AVAILABLE", "EXPIRED", "MISSING"]),
});
export type CheckpointV1 = z.infer<typeof checkpointV1Schema>;

export const RESTORE_STATES = ["PREVIEW", "APPLYING", "APPLIED", "CONFLICT", "PARTIAL_RECOVERY_REQUIRED"] as const;
export const restorePlanV1Schema = z.strictObject({
  version: z.literal(1),
  checkpointId: id,
  scope: checkpointScopeSchema,
  currentRevision: sha256,
  selectedPaths: z.array(checkpointPathSchema).min(1).max(CHECKPOINT_V1_LIMITS.files),
  beforeDigests: z.array(z.strictObject({ path: checkpointPathSchema, digest: sha256.nullable() })).max(CHECKPOINT_V1_LIMITS.files),
  targetDigests: z.array(z.strictObject({ path: checkpointPathSchema, digest: sha256.nullable() })).max(CHECKPOINT_V1_LIMITS.files),
  preRestoreCheckpointId: id.nullable(),
  approvalId: id,
  state: z.enum(RESTORE_STATES),
});
export type RestorePlanV1 = z.infer<typeof restorePlanV1Schema>;

// A commit object created but not attached to the expected branch is recorded
// with observedCommit null or the observed state, never published as success.
const selectiveCommitHunkSchema = z.strictObject({
  path: checkpointPathSchema,
  // Index into the candidate hunk list of the proven pre/post image pair.
  index: z.number().int().nonnegative(),
  digest: sha256,
});
export type SelectiveCommitHunk = z.infer<typeof selectiveCommitHunkSchema>;

export const selectiveCommitV1Schema = z.strictObject({
  version: z.literal(1),
  repositoryIdentity: sha256,
  managedWorktreeId: id,
  expectedHead: oid,
  privateIndexDigest: sha256,
  selectedHunks: z.array(selectiveCommitHunkSchema).max(2000),
  messageDigest: sha256,
  approvalId: id,
  observedCommit: oid.nullable(),
});
export type SelectiveCommitV1 = z.infer<typeof selectiveCommitV1Schema>;

// Provisioning: a reviewed manifest copies only allowlisted non-secret files
// with exact path/size/digest pinning. Secret material is injected as scoped
// SecretRefs at execution instead of being copied.
const provisionManifestEntrySchema = z.strictObject({
  path: checkpointPathSchema,
  digest: sha256,
  bytes: z.number().int().positive().max(1024 * 1024),
});
export const provisionManifestV1Schema = z.strictObject({
  version: z.literal(1),
  id,
  entries: z.array(provisionManifestEntrySchema).min(1).max(200),
  approvedBy: id,
});

export type ProvisionManifestV1 = z.infer<typeof provisionManifestV1Schema>;

// A multi-repository project is a group of independent repository/worktree
// bindings. Every operation selects exactly one repositoryId, or names an
// approved multi-root recipe explicitly. Grants never extend to siblings.
export const repositoryGroupV1Schema = z.strictObject({
  version: z.literal(1),
  id,
  repositories: z
    .array(
      z.strictObject({
        repositoryId: id,
        worktreeBinding: sha256,
        commonDirectoryIdentity: workspaceFileIdentitySchema,
      }),
    )
    .min(1)
    .max(32),
});
export type RepositoryGroupV1 = z.infer<typeof repositoryGroupV1Schema>;
