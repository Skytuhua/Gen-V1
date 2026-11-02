import { z } from 'zod';

const stateKey = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const resourceId = z.string().min(1).max(200).refine(value => !/[\u0000-\u0020/\\?#]/.test(value) && !['.', '..'].includes(value), 'Use a granted resource ID, never a URL');
const resourcePath = z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f:]/.test(value) && !/^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value), 'Path must stay within the resource grant');
const signatureBox = z.strictObject({
  page: z.number().int().min(1).max(200),
  x: z.number().finite().min(0), y: z.number().finite().min(0),
  width: z.number().finite().positive().max(2000), height: z.number().finite().positive().max(2000),
});

/** Child-free trusted components. Merge these into the host catalog, never a scenario router. */
export const DOCUMENT_SCHEMAS = {
  DocumentPreview: z.strictObject({
    resourceId, resourcePath: resourcePath.optional(), title: z.string().max(300).optional(),
    page: z.number().int().min(1).max(200).optional(), fit: z.enum(['width', 'page']).optional(), exportOperationId: resourceId.optional(),
    fieldStateKeys: z.record(z.string().min(1).max(300), stateKey).refine(value => Object.keys(value).length <= 100, 'At most 100 bound fields').optional(),
    activeFieldStateKey: stateKey.optional(), signatureStateKey: stateKey.optional(), signatureBox: signatureBox.optional(),
  }).refine(value => Boolean(value.signatureStateKey) === Boolean(value.signatureBox), 'Provide both signatureStateKey and signatureBox'),
  SignaturePad: z.strictObject({ stateKey, nameStateKey: stateKey.optional(), label: z.string().max(300).optional(), initialMode: z.enum(['draw', 'type', 'generate', 'upload']).optional() }),
};

export const DOCUMENT_EXAMPLES = {
  DocumentPreview: { resourceId: 'granted-pdf', title: 'Agreement.pdf', page: 1, fieldStateKeys: { Name: 'name', Email: 'email' }, activeFieldStateKey: 'activePdfField' },
  SignaturePad: { stateKey: 'visualSignature', label: 'Visual signature', initialMode: 'draw' },
};

export type DocumentPreviewProps = z.infer<typeof DOCUMENT_SCHEMAS.DocumentPreview>;
export type SignaturePadProps = z.infer<typeof DOCUMENT_SCHEMAS.SignaturePad>;
