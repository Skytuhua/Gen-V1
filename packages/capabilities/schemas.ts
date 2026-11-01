import { z } from "zod";
const id = z.string().min(1).max(200);
export const relativePath = z.string().min(1).max(1024).refine(s => !s.includes("\0") && !/^(?:[a-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)|:/.test(s), "Path must stay within a resource grant");
const resource = { resourceId: id, path: relativePath.optional() };
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const statement = z.strictObject({ sql: z.string().min(1).max(32_000), params: z.array(z.union([z.string().max(100_000), z.number().finite(), z.null()])).max(200).optional(), expectedChanges: z.number().int().min(0).max(1_000_000).optional() });
const point = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const placement = { page: z.number().int().min(1), x: z.number().min(0), y: z.number().min(0), width: z.number().positive().max(2000), height: z.number().positive().max(2000) };
export const toolSchemas = {
  repository_files: z.strictObject({ ...resource, limit: z.number().int().min(1).max(1000).optional() }),
  repository_read: z.strictObject(resource),
  repository_status: z.strictObject({ resourceId: id }),
  repository_diff: z.strictObject({ resourceId: id, path: relativePath.optional(), staged: z.boolean().optional() }),
  repository_log: z.strictObject({ resourceId: id, limit: z.number().int().min(1).max(50).optional() }),
  file_replace_prepare: z.strictObject({ ...resource, content: z.string().max(2 * 1024 * 1024), expectedSha256: sha }),
  repository_test_prepare: z.strictObject({ resourceId: id, testFile: relativePath.refine(s => /(?:^|[\\/])[^\\/]+\.test\.(?:[cm]?[jt]s)$/.test(s) && !s.startsWith("-"), "Name one .test.js/.mjs/.cjs/.ts file"), recipe: z.literal("node-test").optional() }),
  text_import: z.strictObject({ ...resource, title: z.string().max(300).optional() }),
  knowledge_publish: z.strictObject({ sources: z.array(z.strictObject(resource)).min(1).max(20), title: z.string().min(1).max(300), value: z.json() }),
  database_inspect: z.strictObject({ ...resource, table: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(500).optional() }),
  database_prepare: z.strictObject({ ...resource, mode: z.enum(["transaction", "migration"]), statements: z.array(statement).min(1).max(100) }),
  pdf_inspect: z.strictObject(resource),
  pdf_prepare: z.strictObject({ ...resource, exportResourceId: id, outputPath: relativePath.refine(s => s.toLowerCase().endsWith(".pdf")), fields: z.record(z.string().min(1).max(300), z.union([z.string().max(10_000), z.boolean(), z.array(z.string().max(1000)).max(100)])).optional(), signatures: z.array(z.union([z.strictObject({ kind: z.literal("typed"), text: z.string().min(1).max(200), ...placement }), z.union([z.strictObject({ kind: z.literal("drawn"), points: z.array(point).min(2).max(2000), ...placement }), z.strictObject({ kind: z.literal("drawn"), strokes: z.array(z.array(point).min(2).max(2000)).min(1).max(1000).refine(strokes => strokes.reduce((sum, stroke) => sum + stroke.length, 0) <= 2000, "At most 2000 total signature points"), ...placement })]), z.strictObject({ kind: z.literal("image"), resourceId: id.refine(value => !/[\u0000-\u0020/\\?#]/.test(value) && ![".", ".."].includes(value)), ...placement })])).max(20).optional() }),
};
export type ToolName = keyof typeof toolSchemas;
export type DatabaseArgs = z.infer<typeof toolSchemas.database_prepare>;
export type PdfArgs = z.infer<typeof toolSchemas.pdf_prepare>;
export const descriptions: Record<ToolName, string> = {
  repository_files: "List granted project files (bounded, excludes .git/node_modules, never follows symlinks).",
  repository_read: "Read one granted UTF-8 source file with SHA-256 and provenance.",
  repository_status: "Read actual git status of the granted repository; no staging or commits.",
  repository_diff: "Read actual git diff, with external diff, textconv and fsmonitor disabled.",
  repository_log: "Read bounded real repository commit history.",
  file_replace_prepare: "Prepare a single existing UTF-8 file replacement conditional on its exact SHA-256; execution requires approval.",
  repository_test_prepare: "Prepare exactly node --test -- <named testFile> in a granted project. Approval authorizes running that file's code with local user privileges; no arbitrary shell recipe.",
  text_import: "Import a granted UTF-8 source document as reusable data with exact SHA-256 provenance. No network fetch.",
  knowledge_publish: "Publish derived structured data referencing granted source documents and their hashes. Provenance identifies synthesis, not independently verified truth.",
  database_inspect: "Inspect a selected external SQLite database: integrity, schema, real counts and bounded rows. WAL databases are unsupported; harness storage is denied by the host resolver.",
  database_prepare: "Prepare an external SQLite transaction/migration with database version, integrity checks, bounded SQL, exact expected DML counts and rollback on mismatch. No ATTACH/extension/PRAGMA or harness database access.",
  pdf_inspect: "Inspect local PDF pages, supported form fields and best-effort unencrypted text streams. No OCR or complete custom-font extraction.",
  pdf_prepare: "Prepare supported PDF form fill and visual typed/drawn/PNG signature placement in a NEW local PDF export. No certificate signatures, OCR or email delivery; existing exports are never overwritten.",
};
