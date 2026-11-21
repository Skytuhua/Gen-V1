import { z } from "zod";

export const FILE_MENTION_LIMITS = {
  maxMentions: 8,
  maxFileBytes: 1024 * 1024,        // matches ProjectTools.file read limit
  maxInjectedBytesPerFile: 64 * 1024,
  maxInjectedBytesPerMessage: 192 * 1024,
  maxQueryChars: 200,
  maxSuggestions: 50,
  defaultSuggestions: 20,
} as const;

export const fileMentionPathSchema = z.string().min(1).max(1024)
  .refine(p => !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && !p.split("/").includes(".."),
          "Mention paths are project-relative POSIX paths.");

export const fileMentionV1Schema = z.strictObject({ path: fileMentionPathSchema });
export const fileMentionsV1Schema = z.array(fileMentionV1Schema)
  .max(FILE_MENTION_LIMITS.maxMentions)
  .refine(list => new Set(list.map(m => m.path)).size === list.length, "Each file can be mentioned once per message.");
export type FileMentionV1 = z.infer<typeof fileMentionV1Schema>;

export const sentFileMentionV1Schema = z.strictObject({
  path: fileMentionPathSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(), truncated: z.boolean(),
});
export type SentFileMentionV1 = z.infer<typeof sentFileMentionV1Schema>;

export const fileSuggestionsQuerySchema = z.strictObject({
  threadId: z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),
  q: z.string().max(FILE_MENTION_LIMITS.maxQueryChars).default(""),
  limit: z.coerce.number().int().min(1).max(FILE_MENTION_LIMITS.maxSuggestions).default(FILE_MENTION_LIMITS.defaultSuggestions),
});

export const fileSuggestionsResponseSchema = z.strictObject({
  enabled: z.boolean(), projectId: z.string(), threadId: z.string(), query: z.string(),
  items: z.array(z.strictObject({ path: z.string(), name: z.string(), directory: z.string() })),
  complete: z.boolean(), limitReason: z.enum(["entries", "time"]).optional(),
});
