import { describe, expect, it } from 'vitest';
import { HarnessError } from '../packages/contracts/index.ts';
import { validateStatements } from '../packages/capabilities/database.ts';
import type { DatabaseArgs } from '../packages/capabilities/schemas.ts';
import { parseRepositoryTestOperation, requireRepositoryTestBinding, type RepositoryTestBinding } from '../packages/capabilities/repository-test-binding.ts';
import { context7OperationArgsSchema } from '../packages/integrations/context7-execution.ts';

const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as HarnessError).code; } };
const hash = 'a'.repeat(64);

const args = (mode: 'transaction' | 'migration', statements: DatabaseArgs['statements']): DatabaseArgs => ({ resourceId: 'db1', mode, statements });

describe('validateStatements', () => {
  it('accepts DML with expectedChanges in transaction mode', () => {
    expect(() => validateStatements(args('transaction', [
      { sql: "INSERT INTO t VALUES (?)", params: ['a'], expectedChanges: 1 },
      { sql: 'UPDATE t SET x = 1', expectedChanges: 0 },
      { sql: 'DELETE FROM t', expectedChanges: 3 },
    ]))).not.toThrow();
  });
  it('accepts schema verbs only in migration mode', () => {
    const ddl = [{ sql: 'CREATE TABLE t (x INTEGER)' }, { sql: 'ALTER TABLE t ADD COLUMN y' }, { sql: 'DROP TABLE t' }];
    expect(() => validateStatements(args('migration', ddl))).not.toThrow();
    for (const statement of ddl) {
      expect(code(() => validateStatements(args('transaction', [statement])))).toBe('INVALID_SQL');
    }
  });
  it.each([
    'SELECT 1',
    'WITH x AS (SELECT 1) DELETE FROM t',
    'insert into t values (1)', // lowercase verb is normalized
    'SHOW TABLES',
    'SET x = 1',
    ';',
    'not sql at all',
  ])('handles verb boundary for %j', sql => {
    const outcome = code(() => validateStatements(args('transaction', [{ sql, expectedChanges: 1 }])));
    if (sql === 'insert into t values (1)') expect(outcome).toBe(null);
    else expect(outcome).toBe('INVALID_SQL');
  });
  it.each([
    'INSERT INTO t VALUES (1); SELECT 2',
    'INSERT INTO t VALUES (1) -- comment',
    'INSERT INTO t VALUES (1) /* comment */',
    'UPDATE t SET x = "a;b"',
    'DELETE FROM t WHERE x = 1; DROP TABLE t',
  ])('rejects multi-statement or comment syntax %j', sql => {
    expect(code(() => validateStatements(args('transaction', [{ sql, expectedChanges: 1 }])))).toBe('INVALID_SQL');
  });
  it('allows a single trailing semicolon', () => {
    expect(() => validateStatements(args('transaction', [{ sql: 'DELETE FROM t;', expectedChanges: 1 }]))).not.toThrow();
    expect(code(() => validateStatements(args('transaction', [{ sql: 'DELETE FROM t;;', expectedChanges: 1 }])))).toBe('INVALID_SQL');
  });
  it('requires expectedChanges on every DML statement', () => {
    for (const sql of ['INSERT INTO t VALUES (1)', 'UPDATE t SET x = 1', 'DELETE FROM t']) {
      expect(code(() => validateStatements(args('transaction', [{ sql }])))).toBe('INVALID_SQL');
      expect(code(() => validateStatements(args('migration', [{ sql }])))).toBe('INVALID_SQL');
    }
  });
  it.each([
    'INSERT INTO t SELECT load_extension(x)',
    'CREATE VIRTUAL TABLE t USING fts5(x)',
    'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END'.replace('; END', ''),
    'CREATE TEMP TABLE t (x)',
    'INSERT INTO t VALUES ("PRAGMA")',
  ])('rejects unsafe construct %j', sql => {
    expect(code(() => validateStatements(args('migration', [{ sql, expectedChanges: 0 }])))).toBe('INVALID_SQL');
  });
});

const fileIdentity = (path: string) => ({ path, dev: '1', ino: '2', bytes: 10, sha256: hash });
const binding = (testFile = 'src/a.test.ts'): RepositoryTestBinding => ({
  version: 1,
  executable: fileIdentity(process.execPath),
  cwd: { path: '/work', dev: '1', ino: '3' },
  test: fileIdentity('/work/src/a.test.ts'),
  argv: ['--test', '--', testFile],
  definition: { id: 'repository_test_prepare', version: 1, schemaDigest: hash, executorBinding: 'domain-prepare' },
});

describe('parseRepositoryTestOperation', () => {
  it('parses prepared args with and without a binding', () => {
    expect(parseRepositoryTestOperation({ resourceId: 'r1', testFile: 'src/a.test.ts' })).toEqual({ resourceId: 'r1', testFile: 'src/a.test.ts' });
    const bound = { resourceId: 'r1', testFile: 'src/a.test.ts', recipe: 'node-test', executionBinding: binding() };
    expect(parseRepositoryTestOperation(bound)).toEqual(bound);
  });
  it.each([
    {},
    { resourceId: 'r1' },
    { resourceId: 'r1', testFile: 'a.spec.ts' },
    { resourceId: 'r1', testFile: '/abs/a.test.ts' },
    { resourceId: 'r1', testFile: '../a.test.ts' },
    { resourceId: 'r1', testFile: '-flag/a.test.ts' },
    { resourceId: 'r1', testFile: 'a.test.ts', recipe: 'shell' },
    { resourceId: 'r1', testFile: 'a.test.ts', extra: 1 },
    { resourceId: 'r1', testFile: 'a.test.ts', executionBinding: { version: 2 } },
    { resourceId: 'r1', testFile: 'a.test.ts', executionBinding: { ...binding(), argv: ['--other'] } },
  ])('rejects %j', value => {
    expect(code(() => parseRepositoryTestOperation(value))).toBe('INVALID_OPERATION');
  });
  it('accepts every supported test-file extension', () => {
    for (const testFile of ['a.test.js', 'a.test.mjs', 'a.test.cjs', 'a.test.ts', 'sub/dir/b.test.ts']) {
      expect(parseRepositoryTestOperation({ resourceId: 'r', testFile }).testFile).toBe(testFile);
    }
  });
});

describe('requireRepositoryTestBinding', () => {
  it('passes when expected and actual match including the test hash', () => {
    const bound = binding();
    expect(() => requireRepositoryTestBinding(bound, structuredClone(bound), hash)).not.toThrow();
  });
  it('rejects a missing expectation', () => {
    expect(code(() => requireRepositoryTestBinding(undefined, binding(), hash))).toBe('PRECONDITION_FAILED');
  });
  it('rejects drift in any binding field', () => {
    const bound = binding();
    for (const mutate of [
      (b: RepositoryTestBinding) => { b.executable.sha256 = 'b'.repeat(64); },
      (b: RepositoryTestBinding) => { b.cwd.path = '/other'; },
      (b: RepositoryTestBinding) => { b.test.bytes = 11; },
      (b: RepositoryTestBinding) => { b.argv = ['--test', '--', 'b.test.ts']; },
      (b: RepositoryTestBinding) => { b.definition.version = 2; },
    ]) {
      const actual = structuredClone(bound);
      mutate(actual);
      expect(code(() => requireRepositoryTestBinding(bound, actual, hash))).toBe('PRECONDITION_FAILED');
    }
  });
  it('rejects a structurally invalid actual binding', () => {
    // Malformed records fail schema parsing before the comparison.
    expect(() => requireRepositoryTestBinding(binding(), { version: 1 } as unknown as RepositoryTestBinding, hash)).toThrow();
  });
  it('rejects a test-hash mismatch', () => {
    expect(code(() => requireRepositoryTestBinding(binding(), binding(), 'f'.repeat(64)))).toBe('PRECONDITION_FAILED');
    expect(code(() => requireRepositoryTestBinding(binding(), binding(), undefined))).toBe('PRECONDITION_FAILED');
  });
});

const file = (path: string) => ({ path, dev: '1', ino: '2', size: '10', mtimeNs: '5', ctimeNs: '5', sha256: hash });
const owner = { threadId: 't', runId: 'r', epoch: 1, projectId: null, workspaceId: null, accountBinding: null };
const context7Args = () => ({
  version: 1,
  request: { id: 'context7', action: 'list_tools' },
  reference: {
    refId: 'context7.' + crypto.randomUUID(), purpose: 'Context7 documentation', owner: 'personal/context7',
    destination: { kind: 'process-env', executableSha256: hash, envName: 'CONTEXT7_API_KEY' }, revoked: false,
  },
  binding: {
    version: 1, executable: file('/bin/node'), entry: file('/p/entry.js'), manifest: file('/p/m.js'), packageManifest: file('/p/package.json'),
    cwd: { path: '/p', dev: '1', ino: '9' }, argv: ['entry.js'],
    definition: { id: 'integration_prepare', version: 1, schemaDigest: hash, executorBinding: 'domain-prepare' },
  },
  owner, modelId: 'm/1',
});

describe('context7OperationArgsSchema', () => {
  it('accepts a well-formed stored operation', () => {
    expect(context7OperationArgsSchema.parse(context7Args())).toMatchObject({ version: 1 });
  });
  it('accepts a call_tool request with a named tool', () => {
    const value = context7Args();
    value.request = { id: 'context7', action: 'call_tool', tool: 'resolve-library-id', args: { q: 'react' } } as typeof value.request;
    expect(context7OperationArgsSchema.safeParse(value).success).toBe(true);
  });
  it.each([
    ['missing request', (v: any) => { v.request = undefined; }],
    ['list_tools with a tool name', (v: any) => { v.request = { ...v.request, tool: 'x' }; }],
    ['call_tool without a tool', (v: any) => { v.request = { id: 'context7', action: 'call_tool' }; }],
    ['bad refId shape', (v: any) => { v.reference.refId = 'context7.nope'; }],
    ['revoked reference', (v: any) => { v.reference.revoked = true; }],
    ['wrong owner', (v: any) => { v.reference.owner = 'other'; }],
    ['wrong env name', (v: any) => { v.reference.destination.envName = 'OTHER'; }],
    ['empty argv', (v: any) => { v.binding.argv = []; }],
    ['relative executable', (v: any) => { v.binding.executable.path = 'rel/node'; }],
    ['non-hex sha256', (v: any) => { v.binding.entry.sha256 = 'z'.repeat(64); }],
    ['wrong definition id', (v: any) => { v.binding.definition.id = 'other'; }],
    ['wrong executor binding', (v: any) => { v.binding.definition.executorBinding = 'x'; }],
    ['missing modelId', (v: any) => { v.modelId = ''; }],
    ['extra top-level key', (v: any) => { v.extra = 1; }],
  ])('rejects %s', (_name, mutate) => {
    const value = context7Args();
    mutate(value as never);
    expect(context7OperationArgsSchema.safeParse(value).success).toBe(false);
  });
});
