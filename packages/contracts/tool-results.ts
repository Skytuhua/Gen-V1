import { z } from 'zod';
import { toolOwnerSchema, type ToolOwner } from './tool-effects.ts';

/** M12 prerequisite subset: private host results, not public DataRecords. */
export const TOOL_RESULT_LIMITS = Object.freeze({
  maxResultBytes: 8 * 1024 * 1024,
  maxProgramBytes: 64 * 1024 * 1024,
  maxThreadBytes: 128 * 1024 * 1024,
  maxRangeBytes: 64 * 1024,
  maxGrants: 256,
});
export interface ToolResultLimits { maxResultBytes: number; maxProgramBytes: number; maxThreadBytes: number }
const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const privateToolResultRefSchema = z.string().regex(/^result_[a-f0-9]{32}$/);
export const toolResultStatusSchema = z.enum(['SUCCEEDED', 'FAILED']);
export type ToolResultStatus = z.infer<typeof toolResultStatusSchema>;
export const toolResultGrantSchema = z.strictObject({
  resourceId: id,
  grantDigest: hash,
  path: z.string().min(1).max(1024).refine(path => !path.includes('\0')).optional(),
});
export type ToolResultGrantV1 = z.infer<typeof toolResultGrantSchema>;
export const toolResultErrorSchema = z.strictObject({ code: id, message: z.string().max(8192), details: z.unknown().optional() });
export type ToolResultErrorV1 = z.infer<typeof toolResultErrorSchema>;
export type ToolResultContentType = 'application/json' | 'text/plain';

export interface ToolResultMetadataV1 {
  resultRef: string;
  revision: 1;
  sha256: string;
  bytes: number;
  status: ToolResultStatus;
  contentType: ToolResultContentType;
}
interface ResultCommon {
  owner: ToolOwner;
  programId: string;
  invocationId?: string;
  grants: readonly ToolResultGrantV1[];
  /** Host-reserved identity for atomic replay settlement; never worker supplied. */
  resultRef?: string;
  contentType?: ToolResultContentType;
}
export type SaveToolResult = ResultCommon & (
  { status: 'SUCCEEDED'; value: unknown; error?: never } |
  { status: 'FAILED'; error: ToolResultErrorV1; value?: never }
);
/** Host-only return. Never send this complete object through public snapshots or ledgers. */
export type PrivateToolResultRead = ToolResultMetadataV1 & { grants: ToolResultGrantV1[] } & (
  { status: 'SUCCEEDED'; value: unknown; error?: never } |
  { status: 'FAILED'; error: ToolResultErrorV1; value?: never }
);
export interface ToolResultReadOptions { programId?: string; signal?: AbortSignal }
export interface ToolResultRange extends ToolResultMetadataV1 {
  offset: number;
  end: number;
  nextOffset: number | null;
  totalBytes: number;
  text: string;
  units: 'UTF-8 bytes';
}

/** All six authority fields are exact. Invalid, extra or omitted fields do not match. */
export function sameToolOwner(a: ToolOwner, b: ToolOwner): boolean {
  const left = toolOwnerSchema.safeParse(a), right = toolOwnerSchema.safeParse(b);
  if (!left.success || !right.success) return false;
  return left.data.threadId === right.data.threadId && left.data.runId === right.data.runId &&
    left.data.epoch === right.data.epoch && left.data.projectId === right.data.projectId &&
    left.data.workspaceId === right.data.workspaceId && left.data.accountBinding === right.data.accountBinding;
}
