import { z } from "zod";

/** M01 evidence contract vendored for M02: the milestone verification manifest
 * is validated against this schema before it is written to
 * docs/implementation/v3/. PARTIAL records known gaps; BLOCKED records source
 * drift or unmet prerequisites. */
export const commandEvidenceSchema = z.strictObject({
  command: z.string(),
  exitCode: z.number().int(),
  stdoutDigest: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number(),
});
export type CommandEvidence = z.infer<typeof commandEvidenceSchema>;

export const sourceLockSchema = z.strictObject({
  baseSha: z.string(),
  headSha: z.string(),
  auditAncestor: z.string(),
  worktreeRoot: z.string(),
  recordedAt: z.string(),
});
export type SourceLockV3 = z.infer<typeof sourceLockSchema>;

export const implementationEvidenceSchema = z.strictObject({
  milestone: z.string(),
  branch: z.string(),
  status: z.enum(["PASS", "PARTIAL", "BLOCKED"]),
  sourceLock: sourceLockSchema,
  commands: z.array(commandEvidenceSchema),
  flags: z.record(z.string(), z.boolean()),
  dependencies: z.record(z.string(), z.string()),
  notes: z.array(z.string()),
});
export type ImplementationEvidenceV3 = z.infer<typeof implementationEvidenceSchema>;
