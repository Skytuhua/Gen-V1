import {z} from 'zod';
import {executionProfileV1Schema, rootRelativePathSchema, sha256HexSchema} from './execution-profile.ts';
import {toolOwnerSchema} from './tool-effects.ts';
import {browserChecklistSchema, verificationRecipeV1Schema, workspaceIdentityV1Schema} from './verification.ts';
import {AgentWorkAdmissionV1Schema} from './agent-work.ts';
import {verificationRepairIntentSchema} from './verification-repair.ts';

const id = z.string().min(1).max(160);
export const verificationCheckSelectorSchema = z.union([
  z.strictObject({phase: z.enum(['BOOTSTRAP', 'BUILD', 'TEST', 'START', 'READINESS'])}),
  z.strictObject({checklistItemId: id}),
]);
export const verificationRequirementPlanSchema = z.strictObject({id, checks: z.array(verificationCheckSelectorSchema).min(1).max(32)});
const readinessSchema = z.strictObject({host: z.enum(['127.0.0.1', 'localhost']), port: z.number().int().min(1).max(65535), path: z.string().min(1).max(2048).refine(path => path.startsWith('/') && !path.startsWith('//') && !/[\r\n\\]/.test(path), 'Readiness requires a relative HTTP path')});
const uniquePaths = (max: number) => z.array(rootRelativePathSchema).max(max).refine(paths => new Set(paths).size === paths.length, 'Digest input paths must be unique');
export const verificationQaRequestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(4096).refine(value => new TextEncoder().encode(value).byteLength <= 4096, 'QA instructions must fit within 4096 bytes'),
  budget: z.strictObject({tokens: z.number().int().min(1).max(100_000), ms: z.number().int().min(1000).max(600_000)}),
});
export const verificationQaIntentSchema = z.strictObject({
  admission: AgentWorkAdmissionV1Schema.refine(value => value.role === 'QA' && value.grantSubset.length === 0 && value.budget.tokens !== null && value.budget.tokens <= 100_000 && value.budget.ms !== null && value.budget.ms <= 600_000, 'QA requires bounded read-only work'),
  model: z.strictObject({modelId: id, accountId: id.nullable(), thinkingLevel: z.string().max(100).nullable()}),
});
export const verificationPrepareSchema = z.strictObject({
  recipeId: z.string().min(1).max(100).optional(), baseRevision: z.number().int().min(0).optional(), profileId: id,
  phases: verificationRecipeV1Schema.shape.phases,
  sourceFiles: uniquePaths(512).refine(paths => paths.length > 0, 'Verification requires declared source inputs'), dependencyFiles: uniquePaths(64),
  readiness: readinessSchema.optional(), checklist: browserChecklistSchema.optional(), qa: verificationQaRequestSchema.optional(),
  requirements: z.array(verificationRequirementPlanSchema).min(1).max(128).refine(values => new Set(values.map(value => value.id)).size === values.length, 'Requirement IDs must be unique'),
}).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({code: 'custom', message});
  const phases = new Set(value.phases.map(phase => phase.name));
  if (phases.has('START') !== phases.has('READINESS') || phases.has('READINESS') !== Boolean(value.readiness)) fail('START and READINESS require each other and an exact endpoint');
  if (phases.has('BROWSER') !== Boolean(value.checklist) || phases.has('BROWSER') && !phases.has('READINESS')) fail('BROWSER requires an approved checklist and owned readiness');
  if (!value.phases.some(phase => ['BOOTSTRAP', 'BUILD', 'TEST', 'START'].includes(phase.name))) fail('A recipe requires an executable phase');
  const checklist = value.checklist;
  if (checklist) {
    if (checklist.viewport.width > 8192 || checklist.viewport.height > 8192 || checklist.viewport.width * checklist.viewport.height > 16_777_216) fail('Browser viewport exceeds the screenshot bound');
    if (value.readiness && !checklist.approvedOrigins.includes(`http://${value.readiness.host}:${value.readiness.port}`)) fail('The checklist must include the owned readiness origin');
    for (const origin of checklist.approvedOrigins) try {const parsed = new URL(origin); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) fail('Browser origins must be exact HTTP origins');} catch {fail('Browser origin is invalid');}
    for (const step of checklist.steps) if ('checklistItemId' in step && !checklist.items.includes(step.checklistItemId)) fail('A browser step references an undeclared item');
    for (const item of checklist.items) if (!checklist.steps.some(step => step.kind.startsWith('ASSERT_') && 'checklistItemId' in step && step.checklistItemId === item)) fail('Each browser item requires an executed assertion');
  }
  for (const requirement of value.requirements) {
    if (new Set(requirement.checks.map(check => JSON.stringify(check))).size !== requirement.checks.length) fail('Requirement selectors must be unique');
    for (const check of requirement.checks) if ('phase' in check ? !phases.has(check.phase) : !checklist?.items.includes(check.checklistItemId)) fail('A required check is outside the proposed recipe');
  }
});
export type VerificationPrepareInput = z.infer<typeof verificationPrepareSchema>;
/** A rerun chooses the current retained execution; the host reconstructs its
 * recipe and captures a fresh source, owner and environment approval. */
export const verificationRerunSchema = z.strictObject({executionId: id});

export const verificationBindingMetadataSchema = z.strictObject({
  profile: executionProfileV1Schema, profileDigest: sha256HexSchema, backendId: id, platformProofRef: z.string().min(1).max(500), environmentId: id,
  browserRequired: z.boolean(), rootIdentity: workspaceIdentityV1Schema,
  executables: z.array(z.strictObject({id: z.string().min(1).max(100), canonicalPath: z.string().min(1).max(4096), sha256: sha256HexSchema})).max(64),
});
/** Host-created approval metadata. This schema is never a model input. */
export const verificationIntentSchema = z.strictObject({
  version: z.literal(1), owner: toolOwnerSchema, executionId: id, baseRecipeRevision: z.number().int().min(0), priorDeclarationDigest: sha256HexSchema,
  recipe: verificationRecipeV1Schema, binding: verificationBindingMetadataSchema,
  sourceFiles: uniquePaths(512), dependencyFiles: uniquePaths(64), sourceCut: z.strictObject({codeDigest: sha256HexSchema, dependencyDigest: sha256HexSchema}),
  readiness: readinessSchema.nullable(), checklist: browserChecklistSchema.nullable(), requirements: z.array(verificationRequirementPlanSchema).min(1).max(128), qa: verificationQaIntentSchema.optional(), repair: verificationRepairIntentSchema.optional(),
});
export type VerificationIntent = z.infer<typeof verificationIntentSchema>;
export const verificationOperationArgumentsSchema = z.strictObject({intent: verificationIntentSchema});
