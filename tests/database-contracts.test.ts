import { describe, expect, it } from 'vitest';
import {
  DATABASE_LIMITS, databaseAttachmentV1Schema, databaseCellSchema, databaseColumnSchema,
  databaseConnectionV1Schema, databaseEngineSchema, databaseQueryResultV1Schema,
  databaseSchemaV1Schema, databaseTargetSchema, databaseTlsSchema,
} from '../packages/contracts/database.ts';

const SQLITE = { path: '/data/app.db', identity: { dev: '2049', ino: '8675309' } };
const NETWORK = { host: 'db.internal', port: 5432, database: 'orders', user: 'reader', tls: 'require' as const, secretRefId: 'ref-1' };
const SQLITE_CONNECTION = { id: '3f6a2a52-1f2f-4b01-9d4f-1f2f3f4f5f6f', version: 1 as const, label: 'local sqlite', engine: 'sqlite' as const, sqlite: SQLITE, createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z' };
const PG_CONNECTION = { id: '8f6a2a52-1f2f-4b01-9d4f-1f2f3f4f5f6f', version: 1 as const, label: 'analytics', engine: 'postgres' as const, network: NETWORK, createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z' };
const COLUMN = { name: 'id', type: 'integer', nullable: false, primaryKey: true };

describe('databaseConnectionV1Schema', () => {
  it('parses a sqlite connection', () => {
    expect(databaseConnectionV1Schema.safeParse(SQLITE_CONNECTION).success).toBe(true);
  });
  it('parses a postgres connection', () => {
    expect(databaseConnectionV1Schema.safeParse(PG_CONNECTION).success).toBe(true);
  });
  it('rejects a sqlite engine with a network block', () => {
    expect(databaseConnectionV1Schema.safeParse({ ...SQLITE_CONNECTION, network: NETWORK }).success).toBe(false);
  });
  it('rejects a postgres engine without a network block', () => {
    const { network: _, ...noNetwork } = PG_CONNECTION;
    expect(databaseConnectionV1Schema.safeParse(noNetwork).success).toBe(false);
  });
  it('rejects port 0', () => {
    expect(databaseConnectionV1Schema.safeParse({ ...PG_CONNECTION, network: { ...NETWORK, port: 0 } }).success).toBe(false);
  });
  it('rejects a label of 81 chars', () => {
    expect(databaseConnectionV1Schema.safeParse({ ...SQLITE_CONNECTION, label: 'x'.repeat(81) }).success).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(databaseConnectionV1Schema.safeParse({ ...SQLITE_CONNECTION, extra: true }).success).toBe(false);
  });
});

describe('supporting database schemas', () => {
  it('parses engines and tls modes', () => {
    expect(databaseEngineSchema.safeParse('mysql').success).toBe(true);
    expect(databaseEngineSchema.safeParse('oracle').success).toBe(false);
    expect(databaseTlsSchema.safeParse('verify-full').success).toBe(true);
    expect(databaseTlsSchema.safeParse('sometimes').success).toBe(false);
  });
  it('parses an attachment', () => {
    const attachment = { id: 'aa6a2a52-1f2f-4b01-9d4f-1f2f3f4f5f6f', version: 1, threadId: 't-1', connectionId: SQLITE_CONNECTION.id, writable: false, createdAt: '2026-11-21T00:00:00Z' };
    expect(databaseAttachmentV1Schema.safeParse(attachment).success).toBe(true);
  });
  it('parses both target shapes and rejects unknown keys', () => {
    expect(databaseTargetSchema.safeParse({ resourceId: 'res-1', path: '/x.db' }).success).toBe(true);
    expect(databaseTargetSchema.safeParse({ attachmentId: SQLITE_CONNECTION.id }).success).toBe(true);
    expect(databaseTargetSchema.safeParse({ attachmentId: SQLITE_CONNECTION.id, drop: true }).success).toBe(false);
  });
  it('parses columns and cell representations', () => {
    expect(databaseColumnSchema.safeParse(COLUMN).success).toBe(true);
    expect(databaseCellSchema.safeParse('v').success).toBe(true);
    expect(databaseCellSchema.safeParse(3.5).success).toBe(true);
    expect(databaseCellSchema.safeParse(null).success).toBe(true);
    expect(databaseCellSchema.safeParse({ kind: 'bytes', length: 4, sha256: 'a'.repeat(64), previewHex: '00ff' }).success).toBe(true);
    expect(databaseCellSchema.safeParse({ kind: 'truncated', preview: 'abc', length: 4096 }).success).toBe(true);
    expect(databaseCellSchema.safeParse({ kind: 'unknown' }).success).toBe(false);
  });
  it('parses a query result and rejects 1001 rows', () => {
    const result = { version: 1, engine: 'sqlite', connectionLabel: 'local', sqlSha256: 'a'.repeat(64),
      columns: [COLUMN], rows: [['id']], rowCount: 1, truncated: false, elapsedMs: 2, executedAt: '2026-11-21T00:00:00Z' };
    expect(databaseQueryResultV1Schema.safeParse(result).success).toBe(true);
    const oversized = { ...result, rows: Array.from({ length: 1001 }, () => ['x']) };
    expect(databaseQueryResultV1Schema.safeParse(oversized).success).toBe(false);
  });
  it('parses a schema document', () => {
    const doc = { version: 1, engine: 'postgres', serverVersion: '16.2', truncated: false, digest: 'b'.repeat(64),
      schemas: [{ name: 'public', objects: [{ kind: 'table', name: 'orders', approxRows: 42, columns: [COLUMN],
        foreignKeys: [{ columns: ['customer_id'], references: { table: 'customers', columns: ['id'] } }],
        indexes: [{ name: 'orders_pkey', columns: ['id'], unique: true }] }] }] };
    expect(databaseSchemaV1Schema.safeParse(doc).success).toBe(true);
  });
});

describe('DATABASE_LIMITS', () => {
  it('is immutable and bounded', () => {
    expect(DATABASE_LIMITS.maxRows).toBe(1000);
    expect(DATABASE_LIMITS.maxSerializedBytes).toBe(8 * 1024 * 1024);
    expect(DATABASE_LIMITS.maxConcurrentPerConnection).toBe(2);
    expect(DATABASE_LIMITS.maxHistory).toBe(50);
  });
});
