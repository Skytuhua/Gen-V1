// MySQL adapter (T03) over `mysql2/promise`. Read-only enforcement is
// precheckReadOnlySql + a START TRANSACTION READ ONLY per query.
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import type { FieldPacket } from 'mysql2';
import { HarnessError } from '../contracts/index.ts';
import type { DatabaseSchemaV1, DatabaseTls } from '../contracts/database.ts';
import type { AdapterQuery, DatabaseAdapter, RawQueryResult } from './database-gateway.ts';

interface Network { host: string; port: number; database: string; user: string; tls: DatabaseTls }
function ssl(tls: DatabaseTls) {
  if (tls === 'disable') return undefined;
  if (tls === 'prefer' || tls === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}
export class MysqlAdapter implements DatabaseAdapter {
  private connection: mysql.Connection | null = null;
  constructor(private readonly network: Network, private readonly password: string) {}
  private async connect(timeoutMs = 15_000): Promise<mysql.Connection> {
    if (this.connection) return this.connection;
    this.connection = await mysql.createConnection({ ...this.network, password: this.password, ssl: ssl(this.network.tls), connectTimeout: timeoutMs });
    return this.connection;
  }
  async test(): Promise<{ serverVersion?: string }> {
    const connection = await this.connect(10_000);
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
    return { serverVersion: rows[0]?.version };
  }
  async schema(): Promise<DatabaseSchemaV1> {
    const connection = await this.connect();
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, TABLE_TYPE AS kind, TABLE_ROWS AS approxRows
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 2000`, [this.network.database]);
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE = 'YES' AS nullable, COLUMN_KEY = 'PRI' AS primaryKey
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [this.network.database]);
    const objects = tables.map(table => ({
      kind: String(table.kind).includes('VIEW') ? 'view' as const : 'table' as const,
      name: table.name, approxRows: table.approxRows == null ? null : Number(table.approxRows),
      columns: columns.filter(column => column.table === table.name).map(column => ({ name: column.name, type: column.type, nullable: Boolean(column.nullable), primaryKey: Boolean(column.primaryKey) })),
      foreignKeys: [], indexes: [],
    }));
    const digest = createHash('sha256').update(JSON.stringify(objects)).digest('hex');
    return { version: 1, engine: 'mysql', schemas: [{ name: this.network.database, objects }], truncated: tables.length >= 2000, digest };
  }
  async query(request: AdapterQuery): Promise<RawQueryResult> {
    const connection = await this.connect(request.timeoutMs);
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    try {
      const bounded = `SELECT * FROM (${request.sql}) AS __gen_q LIMIT ${Math.floor(request.limit)}`;
      const [rows, fields] = await connection.query({ sql: bounded, timeout: request.timeoutMs }, request.params as unknown[]);
      const columns = (fields ?? []).map((field: FieldPacket) => ({ name: String(field.name), type: String(field.columnType) }));
      return { columns, rows: rows as Record<string, unknown>[], truncated: (rows as unknown[]).length >= request.limit, truncatedReason: (rows as unknown[]).length >= request.limit ? 'limit' : undefined };
    } finally {
      await connection.query('SET SESSION TRANSACTION READ WRITE').catch(() => {});
    }
  }
  /** DML only (D7): one transaction, digest re-check, expectedChanges, rollback on mismatch. */
  async executeWrite(args: { statements: { sql: string; params?: unknown[]; expectedChanges?: number }[]; mode: 'transaction' | 'migration'; schemaDigest: string; signal?: AbortSignal }): Promise<{ changes: number; schemaDigest: string }> {
    if (args.mode === 'migration') throw new HarnessError('CAPABILITY_DENIED', 'MySQL attachments accept DML transactions only');
    const connection = await this.connect(30_000);
    await connection.query('SET SESSION TRANSACTION READ WRITE');
    try {
      await connection.beginTransaction();
      const before = await this.schema();
      if (before.digest !== args.schemaDigest) throw new HarnessError('PRECONDITION_FAILED', 'Database schema changed since preparation');
      let changes = 0;
      for (const statement of args.statements) {
        const [result] = await connection.query<mysql.ResultSetHeader>(statement.sql, statement.params as unknown[]);
        if (statement.expectedChanges !== undefined && Number(result.affectedRows ?? 0) !== statement.expectedChanges)
          throw new HarnessError('DATABASE_ERROR', `Statement affected ${result.affectedRows ?? 0} rows; expected ${statement.expectedChanges}. Rolled back.`);
        changes += Number(result.affectedRows ?? 0);
      }
      await connection.commit();
      const after = await this.schema();
      return { changes, schemaDigest: after.digest };
    } catch (cause) {
      await connection.rollback().catch(() => {});
      throw cause;
    }
  }
  async close(): Promise<void> { await this.connection?.end().catch(() => {}); this.connection = null; }
}
