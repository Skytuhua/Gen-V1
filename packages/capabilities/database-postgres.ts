// PostgreSQL adapter (T03) over the `pg` driver. Read-only enforcement is
// precheckReadOnlySql + a READ ONLY transaction per query.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import type { DatabaseSchemaV1, DatabaseTls } from '../contracts/database.ts';
import type { AdapterQuery, DatabaseAdapter, RawQueryResult } from './database-gateway.ts';

interface Network { host: string; port: number; database: string; user: string; tls: DatabaseTls }
function ssl(tls: DatabaseTls) {
  if (tls === 'disable') return false;
  if (tls === 'prefer' || tls === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}
export class PostgresAdapter implements DatabaseAdapter {
  private client: pg.Client | null = null;
  constructor(private readonly network: Network, private readonly password: string) {}
  private async connect(timeoutMs = 15_000): Promise<pg.Client> {
    if (this.client) return this.client;
    const client = new pg.Client({ ...this.network, password: this.password, ssl: ssl(this.network.tls), connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs, query_timeout: timeoutMs });
    await client.connect();
    this.client = client;
    return client;
  }
  async test(): Promise<{ serverVersion?: string }> {
    const client = await this.connect(10_000);
    const { rows } = await client.query<{ version: string }>('SHOW server_version');
    return { serverVersion: rows[0]?.version };
  }
  async schema(): Promise<DatabaseSchemaV1> {
    const client = await this.connect();
    const { rows } = await client.query<{ schema: string; name: string; kind: string; approxRows: number | null }>(
      `SELECT n.nspname AS schema, c.relname AS name, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind,
              CASE WHEN c.relkind IN ('r','p') THEN c.reltuples::bigint ELSE NULL END AS "approxRows"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
         AND c.relkind IN ('r','p','v','m') ORDER BY n.nspname, c.relname LIMIT 2000`);
    const columnsResult = await client.query<{ schema: string; table: string; name: string; type: string; nullable: boolean; primaryKey: boolean }>(
      `SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS name, c.data_type AS type,
              c.is_nullable = 'YES' AS nullable,
              EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                      WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_name = c.table_name AND k.column_name = c.column_name AND k.table_schema = c.table_schema) AS "primaryKey"
       FROM information_schema.columns c WHERE c.table_schema NOT IN ('pg_catalog','information_schema')`);
    const bySchema = new Map<string, Map<string, { kind: 'table' | 'view'; name: string; approxRows: number | null; columns: { name: string; type: string; nullable: boolean; primaryKey: boolean }[]; foreignKeys: []; indexes: [] }>>();
    let truncated = false;
    for (const row of rows) {
      if (!bySchema.get(row.schema)?.set(row.name, { kind: row.kind as 'table' | 'view', name: row.name, approxRows: row.approxRows, columns: [], foreignKeys: [], indexes: [] })) {
        bySchema.set(row.schema, new Map([[row.name, { kind: row.kind as 'table' | 'view', name: row.name, approxRows: row.approxRows, columns: [], foreignKeys: [], indexes: [] }]]));
      }
    }
    for (const column of columnsResult.rows) bySchema.get(column.schema)?.get(column.table)?.columns.push({ name: column.name, type: column.type, nullable: column.nullable, primaryKey: column.primaryKey });
    const schemas = [...bySchema.entries()].map(([name, tables]) => ({ name, objects: [...tables.values()] }));
    if (rows.length >= 2000) truncated = true;
    const digest = createHash('sha256').update(JSON.stringify(schemas)).digest('hex');
    return { version: 1, engine: 'postgres', serverVersion: String((client as unknown as { serverVersion?: string }).serverVersion ?? 'unknown'), schemas, truncated, digest };
  }
  async query(request: AdapterQuery): Promise<RawQueryResult> {
    const client = await this.connect(request.timeoutMs);
    const abort = () => { void client.query(`SELECT pg_cancel_backend(${(client as unknown as { processID?: number }).processID})`).catch(() => {}); };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const bounded = `SELECT * FROM (${request.sql}) AS __gen_q LIMIT ${Math.floor(request.limit)}`;
      const result = await client.query(bounded, request.params as unknown[]);
      const columns = (result.fields ?? []).map((field: { name: string; dataTypeID: number }) => ({ name: field.name, type: String(field.dataTypeID) }));
      return { columns, rows: result.rows as Record<string, unknown>[], truncated: result.rows.length >= request.limit, truncatedReason: result.rows.length >= request.limit ? 'limit' : undefined };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      request.signal?.removeEventListener('abort', abort);
    }
  }
  /** One transaction: digest re-check, per-statement expectedChanges, rollback on any mismatch. */
  async executeWrite(args: { statements: { sql: string; params?: unknown[]; expectedChanges?: number }[]; mode: 'transaction' | 'migration'; schemaDigest: string; signal?: AbortSignal }): Promise<{ changes: number; schemaDigest: string }> {
    const client = await this.connect(30_000);
    try {
      await client.query('BEGIN');
      const before = await this.schema();
      if (before.digest !== args.schemaDigest) throw new HarnessError('PRECONDITION_FAILED', 'Database schema changed since preparation');
      let changes = 0;
      for (const statement of args.statements) {
        const result = await client.query(statement.sql, statement.params as unknown[]);
        if (statement.expectedChanges !== undefined && (result.rowCount ?? 0) !== statement.expectedChanges)
          throw new HarnessError('DATABASE_ERROR', `Statement affected ${result.rowCount ?? 0} rows; expected ${statement.expectedChanges}. Rolled back.`);
        changes += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      const after = await this.schema();
      return { changes, schemaDigest: after.digest };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {});
      throw cause;
    }
  }
  async close(): Promise<void> { await this.client?.end().catch(() => {}); this.client = null; }
}
