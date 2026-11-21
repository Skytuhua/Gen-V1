// SQLite adapter (T03): routes reads through the existing snapshot-based
// guarded worker path (databaseJob) so WAL/journal guards stay intact.
import type { DomainContext } from './index.ts';
import type { DatabaseSchemaV1 } from '../contracts/database.ts';
import { HarnessError } from '../contracts/index.ts';
import { databaseJob } from './database.ts';
import type { AdapterQuery, DatabaseAdapter, RawQueryResult } from './database-gateway.ts';

/** Extract column names + primary key flags from a CREATE TABLE statement.
 * Depth-1 comma split; covers inline `… PRIMARY KEY` and table-level
 * `PRIMARY KEY(a,b)` constraints. Anything unparseable yields [] (grid
 * editing stays disabled). */
function sqliteColumns(sql: string): { name: string; type: string; nullable: boolean; primaryKey: boolean }[] {
  const open = sql.indexOf('('); if (open < 0) return [];
  let depth = 0, close = -1;
  for (let index = open; index < sql.length; index++) { if (sql[index] === '(') depth++; else if (sql[index] === ')' && --depth === 0) { close = index; break; } }
  if (close < 0) return [];
  const parts: string[] = []; let last = open + 1; depth = 0;
  for (let index = last; index < close; index++) { const char = sql[index]!; if (char === '(') depth++; else if (char === ')') depth--; else if (char === ',' && depth === 0) { parts.push(sql.slice(last, index)); last = index + 1; } }
  parts.push(sql.slice(last, close));
  const unquote = (token: string) => token.trim().replace(/^["'`\[]|["'`\]]$/g, '');
  const tablePk = /^\s*primary\s+key\s*\(([^)]*)\)/i;
  const pkNames = new Set<string>();
  for (const part of parts) { const match = tablePk.exec(part); if (match) for (const name of match[1]!.split(',')) pkNames.add(unquote(name).toLowerCase()); }
  const columns: { name: string; type: string; nullable: boolean; primaryKey: boolean }[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || /^(constraint|primary|foreign|unique|check|exclude)\b/i.test(trimmed)) continue;
    const name = unquote(trimmed.split(/\s+/)[0]!);
    const primaryKey = /\bprimary\s+key\b/i.test(trimmed) || pkNames.has(name.toLowerCase());
    columns.push({ name, type: (trimmed.split(/\s+/)[1] ?? '').toUpperCase() || 'unknown', nullable: !/\bnot\s+null\b/i.test(trimmed) && !primaryKey, primaryKey });
  }
  return columns;
}

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
    const objects = (result.schema as { type: string; name: string; sql?: string }[] ?? []).map(definition => ({
      kind: definition.type === 'view' ? 'view' as const : 'table' as const,
      name: definition.name, approxRows: null, columns: sqliteColumns(definition.sql ?? ''), foreignKeys: [], indexes: [],
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
