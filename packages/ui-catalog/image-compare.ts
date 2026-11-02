import { z } from 'zod';

const resourceId = z.string().min(1).max(200).refine(value => !/[\u0000-\u0020/\\?#]/.test(value) && !['.', '..'].includes(value), 'Use a granted resource ID, never a URL');
const stateKey = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
export const IMAGE_COMPARE_SCHEMAS = {
  ImageCompare: z.strictObject({ beforeResourceId: resourceId, afterResourceId: resourceId, stateKey, beforeLabel: z.string().min(1).max(120).optional(), afterLabel: z.string().min(1).max(120).optional(), title: z.string().max(300).optional() }),
};
export const IMAGE_COMPARE_EXAMPLES = {
  ImageCompare: { beforeResourceId: 'before-image', afterResourceId: 'after-image', stateKey: 'imageComparison', beforeLabel: 'Before', afterLabel: 'After' },
};
export const IMAGE_COMPARE_DESCRIPTIONS = {
  ImageCompare: 'Compare two granted source images with immediate pointer/keyboard reveal and an optional side-by-side view. stateKey saves {percent:0..100,mode:"overlay"|"split"}; defaults to 50% overlay. Use the same stateKey through revisions. Both resource IDs must belong to this thread; URLs are not allowed. This is a visual comparison only and never rewrites either image.',
};
export type ImageCompareProps = z.infer<typeof IMAGE_COMPARE_SCHEMAS.ImageCompare>;
