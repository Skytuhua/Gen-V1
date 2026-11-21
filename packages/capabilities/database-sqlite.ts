// SQLite adapter (T03): routes reads through the existing snapshot-based
// guarded worker path (databaseJob) so WAL/journal guards stay intact.
import type { DomainContext } from './index.ts';
import type { DatabaseSchemaV1 } from '../contracts/database.ts';
import { HarnessError } from '../contracts/index.ts';
import { databaseJob } from './database.ts';
import type { AdapterQuery, DatabaseAdapter, RawQueryResult } from './database-gateway.ts';

export class SqliteAdapter implements DatabaseAdapter {
  constructor(private readonly path: string, private readonly ctx?: DomainContext) {}
  private requireCtx(signal?: AbortSignal): DomainContext {
    if (this.ctx) return this.ctx;
    return {
      signal: signal ?? new AbortController().signal,
      progress: () => {},
    } as unknown as DomainContext;
  }
  async test(signal?: AbortSignal): Promise<{ serverVersion?: string }> {
    const result = await databaseJob({ mode: 'inspect', path: this.path }, this.requireCtx(signal));
    return { serverVersion: `sqlite ${String(result.journalMode ?? '')}`.trim() || 'sqlite' };
  }
  async schema(signal?: AbortSignal): Promise<DatabaseSchemaV1> {
    const result = await databaseJob({ mode: 'inspect', path: this.path }, this.requireCtx(signal));
    const objects = (result.schema as { type: string; name: string }[] ?? []).map(definition => ({
      kind: definition.type === 'view' ? 'view' as const : 'table' as const,
      name: definition.name, approxRows: null, columns: [], foreignKeys: [], indexes: [],
    }));
    return { version: 1, engine: 'sqlite', schemas: [{ name: 'main', objects }], truncated: false, digest: String(result.resourceVersion ?? '') };
  }
  async query(request: AdapterQuery): Promise<RawQueryResult> {
    const result = await databaseJob({ mode: 'query', path: this.path, sql: request.sql, params: request.params ?? [], limit: request.limit }, this.requireCtx(request.signal));
    return {
      columns: (result.columns as { name: string; type: string }[] ?? []).map(column => ({ name: column.name, type: column.type })),
      rows: (result.rows as Record<string, unknown>[]) ?? [],
      truncated: Boolean(result.truncated), truncatedReason: result.truncatedReason as 'limit' | 'bytes' | undefined,
    };
  }
  async prepareWrite(): Promise<unknown> { throw new HarnessError('DATABASE_ERROR', 'SQLite writes go through databaseJob execute mode (T04+)'); }
  async executeWrite(): Promise<unknown> { throw new HarnessError('DATABASE_ERROR', 'SQLite writes go through databaseJob execute mode (T04+)'); }
  async close(): Promise<void> { /* Worker-bound; nothing persistent to close. */ }
}
