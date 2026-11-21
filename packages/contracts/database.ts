import { z } from 'zod';

export const DATABASE_LIMITS = { maxRows: 1000, defaultRows: 100, maxColumns: 200, maxSerializedBytes: 8 * 1024 * 1024,
  maxCellDisplayBytes: 4096, maxCellFullBytes: 1024 * 1024, maxSchemaObjects: 2000, defaultTimeoutMs: 15_000, maxTimeoutMs: 30_000,
  connectTimeoutMs: 10_000, maxConcurrentPerConnection: 2, maxSqlChars: 32_000, maxHistory: 50 } as const;
export const databaseEngineSchema = z.enum(['sqlite', 'postgres', 'mysql']);
export const databaseTlsSchema = z.enum(['disable', 'prefer', 'require', 'verify-full']);
export const databaseConnectionV1Schema = z.strictObject({
  id: z.string().uuid(), version: z.literal(1), label: z.string().min(1).max(80), engine: databaseEngineSchema,
  sqlite: z.strictObject({ path: z.string().min(1).max(4096), identity: z.strictObject({ dev: z.string(), ino: z.string() }) }).optional(),
  network: z.strictObject({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), database: z.string().min(1).max(128),
    user: z.string().min(1).max(128), tls: databaseTlsSchema, secretRefId: z.string().min(1).max(200) }).optional(),
  createdAt: z.string(), updatedAt: z.string() }).refine(c => (c.engine === 'sqlite') === Boolean(c.sqlite) && (c.engine !== 'sqlite') === Boolean(c.network));
export const databaseAttachmentV1Schema = z.strictObject({ id: z.string().uuid(), version: z.literal(1), threadId: z.string(),
  connectionId: z.string().uuid(), writable: z.boolean(), createdAt: z.string() });
export const databaseTargetSchema = z.union([
  z.strictObject({ resourceId: z.string().min(1).max(200), path: z.string().max(1024).optional() }),
  z.strictObject({ attachmentId: z.string().uuid() }) ]);
export const databaseColumnSchema = z.strictObject({ name: z.string(), type: z.string(), nullable: z.boolean().optional(), primaryKey: z.boolean().optional() });
export const databaseCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null(),
  z.strictObject({ kind: z.literal('bytes'), length: z.number().int(), sha256: z.string(), previewHex: z.string().max(128) }),
  z.strictObject({ kind: z.literal('truncated'), preview: z.string(), length: z.number().int() })]);
export const databaseQueryResultV1Schema = z.strictObject({ version: z.literal(1), engine: databaseEngineSchema, connectionLabel: z.string(),
  sqlSha256: z.string(), columns: z.array(databaseColumnSchema).max(200), rows: z.array(z.array(databaseCellSchema)).max(1000),
  rowCount: z.number().int(), truncated: z.boolean(), truncatedReason: z.enum(['limit', 'bytes', 'columns']).optional(),
  elapsedMs: z.number().int(), executedAt: z.string(), source: z.strictObject({ table: z.strictObject({ schema: z.string().optional(), name: z.string(),
    primaryKey: z.array(z.string()) }).optional() }).optional() });
export const databaseSchemaV1Schema = z.strictObject({ version: z.literal(1), engine: databaseEngineSchema, serverVersion: z.string().optional(),
  schemas: z.array(z.strictObject({ name: z.string(), objects: z.array(z.strictObject({ kind: z.enum(['table', 'view']), name: z.string(),
    approxRows: z.number().nullable(), columns: z.array(databaseColumnSchema), foreignKeys: z.array(z.strictObject({ columns: z.array(z.string()),
    references: z.strictObject({ schema: z.string().optional(), table: z.string(), columns: z.array(z.string()) }) })),
    indexes: z.array(z.strictObject({ name: z.string(), columns: z.array(z.string()), unique: z.boolean() })) })) })),
  truncated: z.boolean(), digest: z.string() });

export type DatabaseEngine = z.infer<typeof databaseEngineSchema>;
export type DatabaseTls = z.infer<typeof databaseTlsSchema>;
export type DatabaseConnectionV1 = z.infer<typeof databaseConnectionV1Schema>;
export type DatabaseAttachmentV1 = z.infer<typeof databaseAttachmentV1Schema>;
export type DatabaseTarget = z.infer<typeof databaseTargetSchema>;
export type DatabaseColumn = z.infer<typeof databaseColumnSchema>;
export type DatabaseCell = z.infer<typeof databaseCellSchema>;
export type DatabaseQueryResultV1 = z.infer<typeof databaseQueryResultV1Schema>;
export type DatabaseSchemaV1 = z.infer<typeof databaseSchemaV1Schema>;
