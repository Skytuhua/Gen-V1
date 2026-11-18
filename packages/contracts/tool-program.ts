import { z } from 'zod';
import { toolOwnerSchema, type ToolOwner } from './tool-effects.ts';

export const DEFAULT_PROGRAM_LIMITS = Object.freeze({
  deadlineMs: 30_000, maxCalls: 64, maxConcurrentCalls: 4,
  maxOutputBytes: 256 * 1024, memoryBytes: 128 * 1024 * 1024,
});
/** The entire serialized inputs array, including brackets/commas and its root node.
 * 4 MiB leaves more than 3 MiB for escaped source/protocol framing in Python's
 * 8 MiB frame. These bound retained input data, not whole-process memory/RSS. */
export const PROGRAM_INPUT_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxNodes: 100_000, maxDepth: 64 });
const integer = (max: number) => z.number().int().positive().max(max);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(200);
const uniqueNames = z.array(id).max(64).refine(names => new Set(names).size === names.length, 'Tool names must be unique');
export const programInputRefsSchema = z.array(id).max(64)
  .refine(refs => new Set(refs).size === refs.length, 'Input references must be unique')
  .meta({ uniqueItems: true });
export const programLimitsSchema = z.strictObject({
  deadlineMs: integer(DEFAULT_PROGRAM_LIMITS.deadlineMs),
  maxCalls: integer(DEFAULT_PROGRAM_LIMITS.maxCalls),
  maxConcurrentCalls: integer(DEFAULT_PROGRAM_LIMITS.maxConcurrentCalls),
  maxOutputBytes: integer(DEFAULT_PROGRAM_LIMITS.maxOutputBytes),
  memoryBytes: integer(DEFAULT_PROGRAM_LIMITS.memoryBytes),
}).refine(limits => limits.maxConcurrentCalls <= limits.maxCalls, 'Concurrency cannot exceed the call budget');
export type ProgramLimits = z.infer<typeof programLimitsSchema>;
export const programErrorSchema = z.strictObject({ code: id, message: z.string().max(2048), originalResultRef: id.nullable() });
export type ProgramError = z.infer<typeof programErrorSchema>;
export const programStateSchema = z.enum(['PREPARED', 'RUNNING', 'WAITING_TOOL', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']);
export const toolProgramV1Schema = z.strictObject({
  version: z.literal(1), programId: id, owner: toolOwnerSchema,
  language: z.enum(['JAVASCRIPT', 'PYTHON']), sourceDigest: digest,
  runtimeFingerprint: digest, toolRegistryDigest: digest, allowedTools: uniqueNames,
  inputRefs: programInputRefsSchema, limits: programLimitsSchema, state: programStateSchema,
  resultRef: id.nullable(), createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(), deadlineAt: z.number().int().nonnegative().nullable(),
  elapsedMs: z.number().int().nonnegative(), nestedCallCount: z.number().int().min(0).max(64),
  error: programErrorSchema.nullable(),
});
export type ToolProgramV1 = z.infer<typeof toolProgramV1Schema>;
export const nestedCallV1Schema = z.strictObject({
  version: z.literal(1), parentProgramId: id, stableCallKey: z.string().regex(/^call:(?:0|[1-9][0-9]?)$/),
  invocationId: id, owner: toolOwnerSchema, toolName: id, definitionDigest: digest,
  argumentsCommitment: z.string().min(1), resultRef: id.nullable(), effectClass: z.literal('READ_RETRYABLE'),
  state: z.enum(['PREPARED', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']),
  error: programErrorSchema.nullable(),
});
export type NestedCallV1 = z.infer<typeof nestedCallV1Schema>;
export const programJournalV1Schema = z.strictObject({
  version: z.literal(1), programId: id, sourceDigest: digest, runtimeFingerprint: digest,
  toolRegistryDigest: digest, startSeed: digest, startClock: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative(), issuedCallKeys: z.array(id).max(64),
  committedIssuedCount: z.number().int().min(0).max(64),
  deliveries: z.array(z.strictObject({
    stableCallKey: id, resultRef: id, state: z.enum(['SUCCEEDED', 'FAILED']),
    issuedCount: z.number().int().min(1).max(64), clock: z.number().int().nonnegative(),
  })).max(64),
}).refine(journal => journal.committedIssuedCount === journal.issuedCallKeys.length, 'Every issued identity must be committed')
  .refine(journal => new Set(journal.issuedCallKeys).size === journal.issuedCallKeys.length, 'Issued identities must be unique');
export type ProgramJournalV1 = z.infer<typeof programJournalV1Schema>;

export const pythonKernelIdentitySchema = z.strictObject({
  owner: toolOwnerSchema, interpreterDigest: digest, configurationDigest: digest,
  cwdIdentity: id, toolRegistryDigest: digest, executionProfileDigest: digest,
});
export type PythonKernelIdentity = z.infer<typeof pythonKernelIdentitySchema>;
export const pythonKernelV1Schema = z.strictObject({
  version: z.literal(1), kernelId: id, key: digest, identity: pythonKernelIdentitySchema,
  generation: z.number().int().positive(), state: z.enum(['READY', 'RUNNING', 'RESET_REQUIRED', 'STOPPED', 'UNKNOWN']),
  activeProgramId: id.nullable(), retainedState: z.boolean(), updatedAt: z.number().int().nonnegative(),
  error: programErrorSchema.nullable(),
});
export type PythonKernelV1 = z.infer<typeof pythonKernelV1Schema>;

/** Private host-to-executor protocol. It is not a model result or an authority token. */
export interface ProgramToolDelivery { value: unknown; resultRef: string; clock: number }
export interface ProgramExecutionRequest {
  source: string;
  inputValues: readonly unknown[];
  limits: ProgramLimits;
  startSeed: string;
  startClock: number;
  signal: AbortSignal;
  call(stableCallKey: string, name: string, args: Record<string, unknown>): Promise<ProgramToolDelivery>;
  /** Durable host acknowledgement before the executor resolves a tool promise. */
  beforeDelivery?(stableCallKey: string, issuedCount: number): Promise<number>;
}
export interface ProgramBackendProof {
  backendId: string;
  language: ToolProgramV1['language'];
  runtimeFingerprint: string;
  platform: string;
  isolation: 'WASM_NO_HOST_IMPORTS' | 'M03_CONFINED_PROCESS';
  /** The memory object that the selected backend actually constrains. */
  memoryScope: 'GUEST_WASM_LINEAR' | 'INTERPRETER_ADDRESS_SPACE' | 'SYNTHETIC_CONTRACT';
  memoryLimitBytes: number;
  hardMemoryLimit: boolean;
  /** null means aggregate worker/launcher/host memory is unsupported, not bounded by memoryLimitBytes. */
  wholeExecutorMemoryLimitBytes: number | null;
  tested: boolean;
  evidenceRef: string;
}
export interface ProgramExecutor {
  readonly proof: ProgramBackendProof;
  execute(request: ProgramExecutionRequest): Promise<unknown>;
  stop(): Promise<void>;
}
export interface ProgramView {
  program: ToolProgramV1;
  calls: NestedCallV1[];
  sourceRefs: string[];
  aggregate?: unknown;
}
export interface ProgramOwnerContext {
  owner: ToolOwner;
  signal: AbortSignal;
}
