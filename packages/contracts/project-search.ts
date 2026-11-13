import { z } from 'zod';

const unicode = z.string().refine(value => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value, 'Use valid Unicode.');
export const projectSearchIdSchema = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const hostFiles = new Set(['harness.sqlite', 'harness.sqlite-wal', 'harness.sqlite-shm', '.host-lease.sqlite', '.host-lease.sqlite-wal', '.host-lease.sqlite-shm']);
/** Storage location checks also run against the live host before traversal/read. */
export const projectSearchPathSchema = unicode.refine(value =>
  new TextEncoder().encode(value).byteLength <= 1024 && !/[\\:\0]/.test(value) && value.split('/').every(part =>
    part.length > 0 && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) &&
    part.toLowerCase() !== '.git' && part.toLowerCase() !== '.harness-directory-guard' && !hostFiles.has(part.toLowerCase())), 'Choose an ordinary project-relative path.');

export const projectOwnerSchema = z.strictObject({
  projectId: projectSearchIdSchema, threadId: projectSearchIdSchema.nullable(),
  workingCopyId: projectSearchIdSchema.nullable(), binding: sha256,
});
export const searchRequestSchema = z.strictObject({
  threadId: projectSearchIdSchema.optional(),
  q: unicode.transform(value => value.trim()).refine(value => [...value].length >= 1 && [...value].length <= 200, 'Use 1–200 code points.'),
  limit: z.number().int().min(1).max(100).optional(), cursor: unicode.optional(),
});
export const searchMatchSchema = z.strictObject({
  path: projectSearchPathSchema, kind: z.enum(['path', 'text']),
  line: z.number().int().positive().nullable(), column: z.number().int().positive().nullable(),
  preview: unicode.refine(value => [...value].length <= 512), sha256,
}).refine(value => value.kind === 'path' ? value.line === null && value.column === null : value.line !== null && value.column !== null);
export const searchIssueSchema = z.strictObject({
  path: projectSearchPathSchema.nullable(),
  reason: z.enum(['excluded', 'binary', 'too_large', 'unreadable', 'changed', 'file_limit', 'byte_limit', 'match_limit', 'timeout', 'response_limit']),
});
export const searchResponseSchema = z.strictObject({
  owner: projectOwnerSchema, matches: z.array(searchMatchSchema).max(1000), nextCursor: unicode.nullable(),
  complete: z.boolean(), issues: z.array(searchIssueSchema).max(100), issuesTruncated: z.boolean(), exclusions: z.array(unicode),
  limits: z.strictObject({ files: z.number().int().positive(), bytes: z.number().int().positive(), matches: z.number().int().positive(), timeoutMs: z.number().int().positive(), fileBytes: z.number().int().positive() }),
});

export type ProjectOwner = z.infer<typeof projectOwnerSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchMatch = z.infer<typeof searchMatchSchema>;
export type SearchIssue = z.infer<typeof searchIssueSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
