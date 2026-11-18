import { z } from 'zod';
import { sha256HexSchema } from './execution-profile.ts';

/** The current personal Context7 reference only. No value, resolver, or digest
 * of a credential is part of this public metadata boundary. */
export const context7SecretReferenceMetadataSchema = z.strictObject({
  refId: z.string().regex(/^context7\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  purpose: z.literal('Context7 documentation'),
  owner: z.literal('personal/context7'),
  destination: z.strictObject({
    kind: z.literal('process-env'),
    executableSha256: sha256HexSchema,
    envName: z.literal('CONTEXT7_API_KEY'),
  }),
  revoked: z.literal(false),
});
export type Context7SecretReferenceMetadata = z.infer<typeof context7SecretReferenceMetadataSchema>;

export const integrationSecretReferenceStatusSchema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  configured: z.boolean(),
  references: z.array(context7SecretReferenceMetadataSchema).max(1),
  unavailableReason: z.string().min(1).max(200).optional(),
}).superRefine((value, ctx) => {
  if ((!value.enabled || !value.configured) && (value.references.length || value.unavailableReason !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Disabled or unconfigured integrations have no active reference or custody status.' });
  }
  if (value.enabled && value.configured && (value.references.length === 1) === (value.unavailableReason !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Configured integrations expose one current reference or an unavailable status.' });
  }
});
export type IntegrationSecretReferenceStatus = z.infer<typeof integrationSecretReferenceStatusSchema>;

/** Model input names the one action, never its credential or launch binding. */
export const integrationPrepareArgsSchema = z.strictObject({
  id: z.literal('context7'), action: z.enum(['list_tools', 'call_tool']),
  tool: z.string().min(1).max(200).optional(), args: z.record(z.string(), z.json()).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'call_tool' ? !value.tool : value.tool !== undefined || value.args !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Choose tool discovery or one named Context7 tool call.' });
  }
  if (JSON.stringify(value).length > 128 * 1024) ctx.addIssue({ code: 'custom', message: 'Context7 arguments exceed their bound.' });
});
export type IntegrationPrepareArgs = z.infer<typeof integrationPrepareArgsSchema>;
