import {z} from 'zod';
import type {StartRun} from './index.ts';
import {skillReferenceSchema, type SkillReference} from './skill-catalog.ts';

const identity = z.string().min(1).max(240);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Host-only Send context. No filesystem paths, credentials or resource grants. */
export const skillInvocationAuthoritySchema = z.strictObject({
  kind: z.literal('personal'), authorityId: identity, threadId: identity,
  projectId: identity.nullable(), workspaceId: identity.nullable(), accountId: identity.nullable(),
  authorityRevision: hash,
});
export type SkillInvocationAuthority = z.infer<typeof skillInvocationAuthoritySchema>;
export const boundSkillReferenceSchema = skillReferenceSchema.refine(ref => ref.scope.kind === 'personal');
/** Data only: selecting a reference neither reads its body nor admits a Send. */
export type BoundSkillReference = z.infer<typeof boundSkillReferenceSchema>;
export function bindSkillReference(reference: SkillReference): BoundSkillReference {
  return boundSkillReferenceSchema.parse(reference);
}

/** message.send payload. Omit skills for an ordinary send; never drop an invalid pin. */
export const skillInvocationSendPayloadSchema = z.strictObject({
  content: z.string().min(1).max(64 * 1024), modelId: z.string().min(1).max(300),
  thinkingLevel: z.string().min(1).max(240).nullable().optional(),
  skills: z.array(boundSkillReferenceSchema).min(1).max(8),
});
export type SkillInvocationSendPayload = z.infer<typeof skillInvocationSendPayloadSchema>;
export const skillInvocationRequestSchema = z.strictObject({commandId: identity, payload: skillInvocationSendPayloadSchema});
export type SkillInvocationRequest = z.infer<typeof skillInvocationRequestSchema>;
export interface AdmittedSkillFile {readonly path: string; readonly bytes: number; readonly digest: string}
export interface AdmittedSkillGuidance {
  readonly inputId: string;
  readonly trust: 'untrusted-guidance';
  readonly reference: SkillReference;
  readonly entry: AdmittedSkillFile & {readonly path: 'SKILL.md'; readonly text: string};
  readonly supportingFiles: readonly (AdmittedSkillFile & {readonly handle: string})[];
}
/** Explicit transport seam; existing Service/Pi do not consume this field yet. */
export interface RuntimeStartInput extends StartRun {readonly admittedSkillGuidance: readonly AdmittedSkillGuidance[]}
