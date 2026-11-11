import { z } from "zod";

/** Read-only contracts. These identifiers do not authorize Git or review writes. */
export const CODE_REVIEW_LIMITS = {
  files: 1000,
  remoteFiles: 300,
  patchBytes: 256 * 1024,
  hashBytes: 32 * 1024 * 1024,
  snapshots: 8,
} as const;
export const ComparisonScopeSchema = z.strictObject({ scope: z.enum(["staged", "worktree"]) });
export const ComparisonFileRequestSchema = z.strictObject({
  comparisonId: z.string().regex(/^[a-f0-9]{64}$/),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
});
export type ComparisonFileRequest = z.infer<typeof ComparisonFileRequestSchema>;
export interface LocalComparisonIdentity {
  kind: "local";
  id: string;
  scope: "staged" | "worktree";
  headOid: string;
  branch: string;
  /** Complete local read snapshot, separate from the existing action revision. */
  revision: string;
  base: { kind: "commit" | "index"; revision: string };
  head: { kind: "index" | "worktree"; revision: string };
}
export interface PullRequestComparisonIdentity {
  kind: "pull-request";
  id: string;
  repo: string;
  number: number;
  pullRequestId: string;
  baseOid: string;
  headOid: string;
  mergeBaseOid: string;
  baseRef: string;
  headRef: string;
  semantics: "merge-base";
}
export type ComparisonIdentity = LocalComparisonIdentity | PullRequestComparisonIdentity;
export interface ComparisonFile {
  path: string;
  oldPath?: string;
  status: string;
  index?: string;
  worktree?: string;
  untracked: boolean;
  additions: number | null;
  deletions: number | null;
  blobOid?: string;
  patchUnavailable?: "unsupported-file" | "unsupported-path";
}
export interface ComparisonCheck {
  name: string;
  status: "pending" | "passed" | "failed" | "neutral" | "unknown";
}
export interface CodeReviewComparison {
  identity: ComparisonIdentity;
  files: ComparisonFile[];
  filesTruncated: boolean;
  checks: ComparisonCheck[];
  observedAt: string;
  access: { mode: "managed" | "legacy" | "remote"; untrackedIncluded: boolean };
}
export type ComparisonRead =
  | { state: "loading" }
  | { state: "error"; error: { code: string; message: string } }
  | { state: "ready" | "empty"; value: CodeReviewComparison };
export interface ComparisonPatch {
  identity: ComparisonIdentity;
  file: ComparisonFile;
  state: "text" | "empty" | "untracked" | "binary" | "truncated" | "unavailable";
  /** Never contains a partial patch. Treat repository content as inert text. */
  text: string | null;
  reason?: "patch-omitted" | "unsupported-path" | "conflict" | "resource-limit" | "unsupported-file";
}
