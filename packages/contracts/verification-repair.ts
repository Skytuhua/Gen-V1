import {z} from 'zod';
import {toolOwnerSchema} from './tool-effects.ts';
import {sha256HexSchema} from './execution-profile.ts';

const id = z.string().min(1).max(160), stamp = z.iso.datetime();
export const verificationRepairBudgetSchema = z.strictObject({tokens: z.number().int().min(0).max(300_000), ms: z.number().int().min(1000).max(1_800_000)});
export const verificationRepairStartSchema = z.strictObject({executionId: id, budget: verificationRepairBudgetSchema});
export const verificationRepairNextSchema = z.strictObject({planId: id, revision: z.number().int().positive()});
export const verificationRepairIntentSchema = z.strictObject({planId: id, planRevision: z.number().int().positive(), attempt: z.number().int().min(1).max(3), scopeDigest: sha256HexSchema, deadline: stamp, budget: verificationRepairBudgetSchema});
export const verificationRepairStopSchema = z.enum(['PASSED', 'UNCHANGED_FAILURE', 'BUDGET', 'REVOKED', 'CONFLICT', 'BLOCKED', 'CANCELLED']);
export type VerificationRepairStop = z.infer<typeof verificationRepairStopSchema>;
export const verificationRepairPlanSchema = z.strictObject({
  version: z.literal(1), planId: id, owner: toolOwnerSchema, recipeId: id, scopeDigest: sha256HexSchema,
  baselineExecutionId: id, baselineFailureDigest: sha256HexSchema, budget: verificationRepairBudgetSchema, deadline: stamp,
  revision: z.number().int().positive(), chargedTokens: z.number().int().nonnegative(), pendingOperationId: id.nullable(),
  attempts: z.array(z.strictObject({attempt: z.number().int().min(1).max(3), operationId: id, executionId: id, owner: toolOwnerSchema,
    outcome: z.enum(['RUNNING', 'PASS', 'FAIL', 'BLOCKED', 'CANCELLED', 'UNKNOWN']), failureDigest: sha256HexSchema.nullable(),
    reservedTokens: z.number().int().nonnegative(), observedTokens: z.number().int().nonnegative().nullable(), startedAt: stamp, endedAt: stamp.nullable()})).max(3),
  stopped: verificationRepairStopSchema.nullable(), stopDetail: z.string().max(500).nullable(), createdAt: stamp, updatedAt: stamp,
});
export type VerificationRepairPlan = z.infer<typeof verificationRepairPlanSchema>;

/** Read-only controls for the current durable owner. Commands still revalidate authority. */
export interface VerificationWorkflowView {
  ownerKey: string;
  executionId: string;
  recipeId: string;
  qa: boolean;
  canRerun: boolean;
  canStartRepair: boolean;
  unavailableReason: string | null;
  suggestedBudget: {tokens: number; ms: number};
  repair: {
    planId: string;
    revision: number;
    attempts: number;
    maxAttempts: 3;
    state: 'AWAITING_APPROVAL' | 'RUNNING' | 'READY' | 'BLOCKED' | 'STOPPING' | 'STOPPED';
    remainingTokens: number;
    reservedTokens: number;
    remainingMs: number;
    deadline: string;
    stopped: VerificationRepairStop | null;
    stopDetail: string | null;
    unavailableReason: string | null;
    canContinue: boolean;
    canStop: boolean;
  } | null;
}
