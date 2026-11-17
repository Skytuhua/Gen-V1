import {z} from 'zod';
import {sha256HexSchema} from './execution-profile.ts';
import {toolOwnerSchema} from './tool-effects.ts';

/** Artifact references are opaque host identifiers. Neither this record nor an
 * observation can supply a path for the evidence reader to open. */
export const verificationArtifactRefSchema = z.string().regex(/^verification-artifact:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const identitySchema = z.strictObject({device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/)});
export const verificationArtifactRootSchema = z.strictObject({
  version: z.literal(1), storage: identitySchema, artifacts: identitySchema, namespace: identitySchema,
});
export type VerificationArtifactRoot = z.infer<typeof verificationArtifactRootSchema>;

export const verificationArtifactRecordSchema = z.strictObject({
  version: z.literal(1),
  ref: verificationArtifactRefSchema,
  owner: toolOwnerSchema,
  executionId: z.string().min(1).max(200),
  kind: z.enum(['LOG', 'SCREENSHOT']),
  mediaType: z.enum(['text/plain; charset=utf-8', 'image/png']),
  sha256: sha256HexSchema,
  byteLength: z.number().int().nonnegative().max(8 * 1024 * 1024),
  viewport: z.strictObject({width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192)}).nullable(),
  truncated: z.boolean(),
  identity: identitySchema,
  createdAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.kind === 'LOG' && (value.mediaType !== 'text/plain; charset=utf-8' || value.viewport !== null || value.byteLength > 64 * 1024))
    ctx.addIssue({code: 'custom', message: 'Invalid verification log metadata'});
  if (value.kind === 'SCREENSHOT' && (value.mediaType !== 'image/png' || !value.viewport || value.truncated || value.viewport.width * value.viewport.height > 16_777_216))
    ctx.addIssue({code: 'custom', message: 'Invalid verification screenshot metadata'});
});
export type VerificationArtifactRecord = z.infer<typeof verificationArtifactRecordSchema>;

/** An internal host input, produced only after reading and hashing the retained
 * bytes. Observation fields and API/model arguments never issue attestations. */
export type VerificationArtifactAttestation = Pick<VerificationArtifactRecord, 'ref' | 'owner' | 'executionId' | 'kind' | 'sha256' | 'byteLength' | 'viewport'>;
