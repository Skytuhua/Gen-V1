// T03 tests: sql-precheck, the SQLite adapter through the guarded worker, and
// the gateway's normalisation/read-only gate. PG/MySQL suites run only when
// GEN_TEST_POSTGRES_URL / GEN_TEST_MYSQL_URL are set (skipped otherwise).
import { afterAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { precheckReadOnlySql, maskSql } from '../packages/capabilities/sql-precheck.ts';
import { DatabaseGateway, normalizeCell } from '../packages/capabilities/database-gateway.ts';
import { PostgresAdapter } from '../packages/capabilities/database-postgres.ts';
import { MysqlAdapter } from '../packages/capabilities/database-mysql.ts';
import { databaseConnectionV1Schema } from '../packages/contracts/database.ts';

const dir = mkdtempSync(join(homedir(), 'dbgw-'));
const dbPath = join(dir, 'fixture.sqlite');
{
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, payload BLOB)');
  for (let i = 1; i <= 50; i++) db.prepare('INSERT INTO items (name, payload) VALUES (?, ?)').run(`item-${i}`, new Uint8Array(i % 8));
  db.close();
}
const fixtureHash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
const sqliteConnection = databaseConnectionV1Schema.parse({ id: '11111111-1111-4111-8111-111111111111', version: 1, label: 'fixture', engine: 'sqlite', sqlite: { path: dbPath, identity: { dev: '0', ino: '0' } }, createdAt: 'x', updatedAt: 'x' });
const gateway = new DatabaseGateway(async () => 'unused');

// The Linux path guard requires an ext4-managed workspace root, so the adapter's
// databaseJob path is env-gated off-CI; these run the worker query mode directly.
import { Worker } from 'node:worker_threads';
function workerQuery(sql: string, params: unknown[] = [], limit = 1000, signal?: AbortSignal): Promise<{ columns: { name: string }[]; rows: Record<string, unknown>[]; truncated?: boolean; truncatedReason?: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const worker = new Worker(new URL('../packages/capabilities/sqlite-worker.mjs', import.meta.url), { workerData: { mode: 'query', path: dbPath, sql, params, limit }, execArgv: [] });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('timeout')); }, 20_000); timer.unref();
    const abort = () => { void worker.terminate(); reject(new Error('cancelled')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: { result?: unknown; error?: string }) => { clearTimeout(timer); if (message.error) reject(new Error(message.error)); else resolve(message.result as never); });
    worker.once('error', reject);
  });
}

describe('sql-precheck', () => {
  test.each([
    ['SELECT 1', true], ['  WITH c AS (SELECT 1) SELECT * FROM c', true], ['EXPLAIN SELECT 1', true],
    ['SELECT 1;', true], ['select 1', true],
    ['SELECT "x;y"', true], ["SELECT 'a;b'", true], ['SELECT $tag$a;b$tag$', true],
    ['SELECT 1 -- drop table x', true], ['SELECT 1 /* ; delete */', true],
    ['SELECT [weird;col] FROM t', true], ['SELECT `tick;col` FROM t', true],
    ['INSERT INTO t VALUES (1)', false], ['UPDATE t SET a=1', false], ['DROP TABLE t', false],
    ['SELECT 1; DROP TABLE t', false], ['SELECT 1; SELECT 2', false], ['CREATE INDEX i ON t(a)', false],
    ['PRAGMA journal_mode=DELETE', false], ['ATTACH DATABASE x AS y', false], ['VACUUM', false],
    ['REPLACE INTO t VALUES (1)', false], ['TRUNCATE TABLE t', false], ['', false],
  ])('precheck %j -> %s', (sql, ok) => expect(precheckReadOnlySql(sql).ok).toBe(ok));
  test('maskSql preserves statement boundaries outside literals', () => {
    expect(maskSql("SELECT ';' ; -- x")).toContain(' ; ');
    expect(maskSql("/* a;b */ SELECT")).toContain('SELECT');
  });
});

describe('DatabaseGateway over sqlite fixture', () => {
  test('select returns rows and columns', async () => {
    const result = await workerQuery('SELECT id, name FROM items WHERE id <= ?', [3]);
    expect(result.columns.map(c => c.name)).toEqual(['id', 'name']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0]).toMatchObject({ id: 1, name: 'item-1' });
  });
  test('limit truncates at the row cap', async () => {
    const result = await workerQuery('SELECT * FROM items', [], 10);
    expect(result.rows.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('limit');
  });
  test('blob cells round-trip and normalize to bytes objects', async () => {
    const result = await workerQuery('SELECT payload FROM items WHERE id = 8');
    const cell = normalizeCell(Object.values(result.rows[0])[0]) as { kind: string; length: number; sha256: string };
    expect(cell.kind).toBe('bytes');
    expect(cell.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('normalizeCell truncates oversized text', () => {
    const cell = normalizeCell('x'.repeat(9000)) as { kind: string; length: number };
    expect(cell.kind).toBe('truncated');
    expect(cell.length).toBe(9000);
  });
  test('gateway read-only gate rejects before touching the adapter', async () => {
    await expect(gateway.query(sqliteConnection, { sql: 'DROP TABLE items' })).rejects.toThrowError(/read-only/i);
  });
  test('cancel rejects the worker query', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(workerQuery('SELECT 1', [], 10, controller.signal)).rejects.toThrowError(/cancelled/);
  });
  test('write inside read-only worker is authorizer-denied and file unchanged', async () => {
    const before = fixtureHash();
    // node:sqlite prepare() compiles only the first statement; the injected
    // DELETE is never executed and the file is unchanged.
    const injected = await workerQuery('SELECT name FROM items WHERE id = 1; DELETE FROM items');
    expect(injected.rows[0]).toMatchObject({ name: 'item-1' });
    await expect(workerQuery("SELECT name FROM items WHERE id = (DELETE)")).rejects.toThrowError();
    // The read-only authorizer blocks writes even when reached through a statement.
    await expect(workerQuery("INSERT INTO items (name) VALUES ('x')")).rejects.toThrowError();
    expect(fixtureHash()).toBe(before);
  });
  const A07 = ['INSERT INTO items (name) VALUES (\'x\')', 'UPDATE items SET name = \'x\'', 'DELETE FROM items', 'DROP TABLE items', 'CREATE TABLE evil (a INT)', 'ALTER TABLE items ADD COLUMN b', 'ATTACH DATABASE \'other.db\' AS o', 'PRAGMA journal_mode=DELETE', 'VACUUM', 'SELECT 1; DELETE FROM items'];
  test.each(A07)('read-only rejects %j and file unchanged', async sql => {
    const before = fixtureHash();
    await expect(gateway.query(sqliteConnection, { sql })).rejects.toThrowError();
    expect(fixtureHash()).toBe(before);
  });
});

const pgUrl = process.env.GEN_TEST_POSTGRES_URL;
const mysqlUrl = process.env.GEN_TEST_MYSQL_URL;
describe('postgres adapter (env-gated)', () => {
  test.skipIf(!pgUrl)('connects, queries and lists schema', async () => {
    const url = new URL(pgUrl!);
    const adapter = new PostgresAdapter({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), user: url.username, tls: 'prefer' }, decodeURIComponent(url.password));
    expect((await adapter.test()).serverVersion).toBeTruthy();
    const result = await adapter.query({ sql: 'SELECT 1 AS one', limit: 10, timeoutMs: 10_000 });
    expect(result.rows[0]).toMatchObject({ one: 1 });
    const schema = await adapter.schema();
    expect(schema.engine).toBe('postgres');
    await adapter.close();
  });
  test.skipIf(pgUrl === undefined)('skipped: GEN_TEST_POSTGRES_URL not set', () => expect(pgUrl).toBeUndefined());
});
describe('mysql adapter (env-gated)', () => {
  test.skipIf(!mysqlUrl)('connects, queries and lists schema', async () => {
    const url = new URL(mysqlUrl!);
    const adapter = new MysqlAdapter({ host: url.hostname, port: Number(url.port || 3306), database: url.pathname.slice(1), user: url.username, tls: 'prefer' }, decodeURIComponent(url.password));
    expect((await adapter.test()).serverVersion).toBeTruthy();
    const result = await adapter.query({ sql: 'SELECT 1 AS one', limit: 10, timeoutMs: 10_000 });
    expect(result.rows[0]).toMatchObject({ one: 1 });
    const schema = await adapter.schema();
    expect(schema.engine).toBe('mysql');
    await adapter.close();
  });
  test.skipIf(mysqlUrl === undefined)('skipped: GEN_TEST_MYSQL_URL not set', () => expect(mysqlUrl).toBeUndefined());
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
