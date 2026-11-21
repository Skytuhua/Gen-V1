// DatabaseGateway (T03): one DatabaseAdapter per saved connection, a
// per-connection concurrency limiter, cell normalisation (R15) and secret
// redaction on every adapter error. Credentials are resolved only here.
import { createHash } from 'node:crypto';
import type { DatabaseCell, DatabaseColumn, DatabaseConnectionV1, DatabaseQueryResultV1, DatabaseSchemaV1 } from '../contracts/database.ts';
import { DATABASE_LIMITS } from '../contracts/database.ts';
import { createSecretRedactor, type SecretRedactor } from '../core/secret-references.ts';
import { HarnessError } from '../contracts/index.ts';
import { precheckReadOnlySql } from './sql-precheck.ts';
import { SqliteAdapter } from './database-sqlite.ts';
import { PostgresAdapter } from './database-postgres.ts';
import { MysqlAdapter } from './database-mysql.ts';

export interface AdapterQuery { sql: string; params?: unknown[]; limit: number; timeoutMs: number; signal?: AbortSignal }
export interface RawQueryResult { columns: DatabaseColumn[]; rows: Record<string, unknown>[] | unknown[][]; truncated?: boolean; truncatedReason?: 'limit' | 'bytes' | 'columns' }
export interface DatabaseAdapter {
  test(signal?: AbortSignal): Promise<{ serverVersion?: string }>;
  schema(signal?: AbortSignal): Promise<DatabaseSchemaV1>;
  query(request: AdapterQuery): Promise<RawQueryResult>;
  prepareWrite?(args: unknown): Promise<unknown>;
  executeWrite?(args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export function normalizeCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.length > DATABASE_LIMITS.maxCellDisplayBytes) return { kind: 'truncated', preview: value.slice(0, DATABASE_LIMITS.maxCellDisplayBytes), length: value.length };
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return { kind: 'bytes', length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), previewHex: Buffer.from(bytes.subarray(0, 64)).toString('hex') };
  }
  const text = String(value);
  return text.length > DATABASE_LIMITS.maxCellDisplayBytes ? { kind: 'truncated', preview: text.slice(0, DATABASE_LIMITS.maxCellDisplayBytes), length: text.length } : text;
}

export function normalizeRows(rows: Record<string, unknown>[] | unknown[][]): DatabaseCell[][] {
  return rows.map(row => Array.isArray(row) ? row.map(normalizeCell) : Object.values(row).map(normalizeCell));
}

export class DatabaseGateway {
  private adapters = new Map<string, DatabaseAdapter>();
  private lanes = new Map<string, Promise<unknown>>();
  private redactor: SecretRedactor;
  constructor(
    private readonly resolvePassword: (secretRefId: string) => Promise<string>,
    extraSecrets: Iterable<string> = [],
  ) { this.redactor = createSecretRedactor(extraSecrets); }
  private async adapterFor(connection: DatabaseConnectionV1): Promise<DatabaseAdapter> {
    const existing = this.adapters.get(connection.id);
    if (existing) return existing;
    let adapter: DatabaseAdapter;
    if (connection.engine === 'sqlite') {
      if (!connection.sqlite) throw new HarnessError('DATABASE_ERROR', 'SQLite connection is missing its file path');
      adapter = new SqliteAdapter(connection.sqlite.path);
    } else {
      if (!connection.network) throw new HarnessError('DATABASE_ERROR', 'Network connection is missing host settings');
      const password = await this.resolvePassword(connection.network.secretRefId);
      this.redactor = createSecretRedactor([password, `://${connection.network.user}:${password}@`, ...[]]);
      adapter = connection.engine === 'postgres' ? new PostgresAdapter(connection.network, password) : new MysqlAdapter(connection.network, password);
    }
    this.adapters.set(connection.id, adapter);
    return adapter;
  }
  // At most two calls in flight per connection (R-limits); excess calls queue.
  private runOnLane<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    const lane = this.lanes.get(connectionId) ?? Promise.resolve();
    const next = lane.then(work, work);
    this.lanes.set(connectionId, next.catch(() => undefined));
    return next;
  }
  async test(connection: DatabaseConnectionV1, signal?: AbortSignal): Promise<{ serverVersion?: string }> {
    return this.runOnLane(connection.id, () => this.adapterFor(connection).then(adapter => adapter.test(signal)).catch(cause => { throw new HarnessError('DATABASE_ERROR', this.redactText(cause instanceof Error ? cause.message : String(cause))); }));
  }
  async schema(connection: DatabaseConnectionV1, signal?: AbortSignal): Promise<DatabaseSchemaV1> {
    return this.runOnLane(connection.id, () => this.adapterFor(connection).then(adapter => adapter.schema(signal)).catch(cause => { throw new HarnessError('DATABASE_ERROR', this.redactText(cause instanceof Error ? cause.message : String(cause))); }));
  }
  async query(connection: DatabaseConnectionV1, request: Omit<AdapterQuery, 'limit' | 'timeoutMs'> & { limit?: number; timeoutMs?: number }): Promise<DatabaseQueryResultV1> {
    const started = Date.now();
    const check = precheckReadOnlySql(request.sql);
    if (!check.ok) throw new HarnessError('DATABASE_READ_ONLY', `Rejected read-only precheck: ${check.reason}`);
    if (request.sql.length > DATABASE_LIMITS.maxSqlChars) throw new HarnessError('DATABASE_READ_ONLY', `Statement exceeds ${DATABASE_LIMITS.maxSqlChars} characters`);
    const limit = Math.min(request.limit ?? DATABASE_LIMITS.defaultRows, DATABASE_LIMITS.maxRows);
    const timeoutMs = Math.min(request.timeoutMs ?? DATABASE_LIMITS.defaultTimeoutMs, DATABASE_LIMITS.maxTimeoutMs);
    return this.runOnLane(connection.id, async () => {
      const adapter = await this.adapterFor(connection);
      try {
        const raw = await adapter.query({ ...request, limit, timeoutMs });
        const columns = raw.columns.slice(0, DATABASE_LIMITS.maxColumns);
        const rows = normalizeRows(raw.rows).slice(0, DATABASE_LIMITS.maxRows);
        return {
          version: 1 as const, engine: connection.engine, connectionLabel: connection.label,
          sqlSha256: createHash('sha256').update(request.sql).digest('hex'),
          columns, rows, rowCount: rows.length,
          truncated: Boolean(raw.truncated) || raw.columns.length > columns.length,
          truncatedReason: raw.columns.length > columns.length ? 'columns' as const : raw.truncatedReason,
          elapsedMs: Math.round(Date.now() - started), executedAt: new Date(started).toISOString(),
        };
      } catch (cause) {
        throw new HarnessError('DATABASE_ERROR', this.redactText(cause instanceof Error ? cause.message : String(cause)));
      }
    });
  }
  async executeWrite(connection: DatabaseConnectionV1, args: { statements: { sql: string; params?: unknown[]; expectedChanges?: number }[]; mode: 'transaction' | 'migration'; schemaDigest: string; signal?: AbortSignal }): Promise<unknown> {
    return this.runOnLane(connection.id, async () => {
      const adapter = await this.adapterFor(connection);
      if (!adapter.executeWrite) throw new HarnessError('CAPABILITY_DENIED', `Write execution is not implemented for the ${connection.engine} adapter`);
      try {
        return await adapter.executeWrite(args);
      } catch (cause) {
        if (cause instanceof HarnessError) throw new HarnessError(cause.code, this.redactText(cause.message));
        throw new HarnessError('DATABASE_ERROR', this.redactText(cause instanceof Error ? cause.message : String(cause)));
      }
    });
  }
  private redactText(value: string): string { return this.redactor.redact(value).text; }
  async close(connectionId?: string): Promise<void> {
    const ids = connectionId ? [connectionId] : [...this.adapters.keys()];
    await Promise.all(ids.map(id => { const adapter = this.adapters.get(id); this.adapters.delete(id); return adapter?.close(); }));
  }
}
