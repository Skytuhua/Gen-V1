import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceLockV3 } from '../packages/contracts/implementation-evidence.ts';
import { runDependencyContracts } from '../scripts/run-dependency-contracts.ts';

const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const directories: string[] = [];
const roots: string[] = [];
afterEach(() => {
  // Remove only the owned link before deleting each disposable Git fixture.
  for (const root of roots.splice(0)) unlinkSync(join(root, 'node_modules'));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const passingTest = [
  "import { expect, test } from 'vitest';",
  "import { value } from '../packages/contracts/index.ts';",
  "test('current contract', () => expect(value).toBe(42));",
].join('\n');

function fixture(body = passingTest) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'm01 contracts ')));
  directories.push(directory);
  const root = join(directory, 'checkout');
  mkdirSync(root);
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const file of ['.gitattributes', 'package.json', 'pnpm-lock.yaml', 'vitest.config.ts'])
    copyFileSync(join(repository, file), join(root, file));
  put('.gitignore', 'node_modules\nignored-output\n');
  put('packages/contracts/index.ts', 'export const value = 42;\n');
  put('packages/contracts/implementation-evidence.ts', 'export const version = 3;\n');
  put('tests/gate.test.ts', body);
  put('tests/second.test.ts', [
    "import { expect, test } from 'vitest';",
    "import { version } from '../packages/contracts/implementation-evidence.ts';",
    "test('evidence contract', () => expect(version).toBe(3));",
  ].join('\n'));
  // A substring CLI filter would also select this neighboring failing file.
  put('tests/gate.test.tsx', "throw new Error('Undeclared neighboring test must not execute');\n");
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  }).trim();
  git('init');
  git('config', 'user.name', 'Compatibility fixture');
  git('config', 'user.email', 'compatibility@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  git('commit', '-m', 'Current dependency contract fixture');
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  roots.push(root);
  const head = git('rev-parse', 'HEAD');
  const blob = (path: string) => git('rev-parse', head + ':' + path);
  const lock: SourceLockV3 = {
    schemaVersion: 3, auditAncestorSha: head, executionBaseSha: head,
    inspectedPaths: [{ path: 'packages/contracts/index.ts', blobSha: blob('packages/contracts/index.ts') }],
    publicContracts: [
      { name: 'runtime-adapter', version: blob('packages/contracts/index.ts'), testIds: ['tests/gate.test.ts', 'tests/second.test.ts'] },
      { name: 'M01.ImplementationEvidenceV3', version: blob('packages/contracts/implementation-evidence.ts'), testIds: ['tests/second.test.ts'] },
    ],
    acceptedDependencyCommits: [head], approvedDrift: [],
  };
  const lockPath = join(directory, 'source-lock.json');
  const saveLock = () => writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  saveLock();
  const out = join(directory, 'execution');
  const run = () => runDependencyContracts(lockPath, out, root);
  return { directory, root, out, lockPath, lock, git, put, saveLock, run };
}

describe('M01 current dependency compatibility execution', () => {
  it('executes exactly the declared files and records current source, commands, and complete assertions', async () => {
    const value = fixture();
    const originalLock = readFileSync(value.lockPath, 'utf8');
    const receipt = await value.run();
    expect(receipt.status, JSON.stringify(receipt.issues)).toBe('PASS');
    expect(receipt.releaseApproved).toBe(false);
    expect(receipt.source?.headSha).toBe(value.lock.executionBaseSha);
    expect(receipt.source?.sourceLockDigest).toBe(createHash('sha256').update(originalLock).digest('hex'));
    expect(receipt.tests).toEqual([
      { testId: 'tests/gate.test.ts', status: 'PASS', passed: 1, failed: 0, unexecuted: 0 },
      { testId: 'tests/second.test.ts', status: 'PASS', passed: 1, failed: 0, unexecuted: 0 },
    ]);
    expect(receipt.contracts.map(contract => contract.status)).toEqual(['PASS', 'PASS']);
    expect(receipt.commands.map(command => command.status)).toEqual(['PASS', 'PASS']);
    expect(receipt.commands[1]!.argv).toContain('vitest');
    for (const command of receipt.commands) {
      expect(command.cwdIdentity).toBe(realpathSync(value.root));
      expect(command.termination).toBe('NONE');
      expect(command.exitCode).toBe(0);
      expect(command.logDigest).toBe(createHash('sha256').update(readFileSync(command.boundedLogRef)).digest('hex'));
    }
    expect(receipt.report?.digest).toBe(createHash('sha256').update(readFileSync(receipt.report!.path)).digest('hex'));
    expect(JSON.parse(readFileSync(join(value.out, 'compatibility.json'), 'utf8'))).toEqual(receipt);
    expect(readFileSync(value.lockPath, 'utf8')).toBe(originalLock);
    expect(readFileSync(join(value.out, 'source-lock.json'), 'utf8')).toBe(originalLock);
  }, 120_000);

  it('reports an observed contract assertion failure as FAIL', async () => {
    const value = fixture(passingTest.replace('toBe(42)', 'toBe(43)'));
    const receipt = await value.run();
    expect(receipt.status, JSON.stringify(receipt.issues)).toBe('FAIL');
    expect(receipt.commands[1]?.status).toBe('FAIL');
    expect(receipt.tests.find(test => test.testId === 'tests/gate.test.ts')).toMatchObject({ status: 'FAIL', failed: 1 });
    expect(receipt.contracts[0]?.status).toBe('FAIL');
  }, 120_000);

  it('blocks named tests whose assertions are skipped even when the command exits successfully', async () => {
    const value = fixture(passingTest.replace("test('current contract'", "test.skip('current contract'"));
    const receipt = await value.run();
    expect(receipt.commands[1]?.status, JSON.stringify(receipt.issues)).toBe('PASS');
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.tests.find(test => test.testId === 'tests/gate.test.ts')).toMatchObject({ status: 'BLOCKED', passed: 0, unexecuted: 1 });
    expect(receipt.issues.map(issue => issue.code)).toContain('CONTRACT_TEST_NOT_EXECUTED');
    expect(receipt.contracts.every(contract => contract.status === 'BLOCKED')).toBe(true);
  }, 120_000);

  it('blocks successful assertions if current tracked source changes during execution', async () => {
    const value = fixture([
      "import { expect, test } from 'vitest';",
      "import { writeFileSync } from 'node:fs';",
      "test('changes owned fixture source', () => {",
      "  writeFileSync('packages/contracts/index.ts', 'export const value = 99;\\n');",
      "  expect(true).toBe(true);",
      "});",
    ].join('\n'));
    const receipt = await value.run();
    expect(receipt.commands[1]?.status, JSON.stringify(receipt.issues)).toBe('PASS');
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.issues.map(issue => issue.code)).toContain('SOURCE_CHANGED_DURING_EXECUTION');
  }, 120_000);

  it('blocks a declared file that contains no executable test assertions', async () => {
    const value = fixture('export const unexecutedContract = true;\n');
    const receipt = await value.run();
    expect(receipt.commands[1]?.status, JSON.stringify(receipt.issues)).toBe('FAIL');
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.contracts.every(contract => contract.status === 'BLOCKED')).toBe(true);
  }, 120_000);

  it('blocks successful assertions if the supplied source-lock bytes change during execution', async () => {
    const value = fixture([
      "import { expect, test } from 'vitest';",
      "import { appendFileSync } from 'node:fs';",
      "test('changes owned fixture lock', () => {",
      "  appendFileSync('../source-lock.json', '\\n');",
      "  expect(true).toBe(true);",
      "});",
    ].join('\n'));
    const receipt = await value.run();
    expect(receipt.commands[1]?.status, JSON.stringify(receipt.issues)).toBe('PASS');
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.issues.map(issue => issue.code)).toContain('SOURCE_CHANGED_DURING_EXECUTION');
  }, 120_000);

  const invalidCases: [string, (value: ReturnType<typeof fixture>) => void][] = [
    ['a missing audit ancestor', (value: ReturnType<typeof fixture>) => { value.lock.auditAncestorSha = '0'.repeat(40); }],
    ['an unaccepted dependency commit', (value: ReturnType<typeof fixture>) => { value.lock.acceptedDependencyCommits = ['0'.repeat(40)]; }],
    ['a stale contract version', (value: ReturnType<typeof fixture>) => { value.lock.publicContracts[0]!.version = '0'.repeat(40); }],
    ['a glob test ID', (value: ReturnType<typeof fixture>) => { value.lock.publicContracts[0]!.testIds = ['tests/*.test.ts']; }],
    ['a browser test ID', (value: ReturnType<typeof fixture>) => { value.lock.publicContracts[0]!.testIds = ['tests/e2e/latency.spec.ts']; }],
    ['an untracked source file', (value: ReturnType<typeof fixture>) => { value.put('packages/contracts/untracked.ts', 'export const undeclared = true;\n'); }],
    ['a dirty tracked checkout', (value: ReturnType<typeof fixture>) => { value.put('packages/contracts/index.ts', 'export const value = 99;\n'); }],
  ];
  it.each(invalidCases)('blocks %s before launching any command', async (_label, invalidate) => {
    const value = fixture();
    invalidate(value);
    value.saveLock();
    const receipt = await value.run();
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.commands).toEqual([]);
    expect(receipt.issues.map(issue => issue.code)).toContain('COMPATIBILITY_SETUP_BLOCKED');
  });

  it('requires exact working bytes even when local Git attributes normalize them to the locked blob', async () => {
    const value = fixture();
    writeFileSync(join(value.root, '.git/info/attributes'), 'packages/contracts/index.ts text eol=lf\n');
    value.put('packages/contracts/index.ts', 'export const value = 42;\r\n');
    // Refresh the index using the local clean filter without changing its blob.
    value.git('add', '--', 'packages/contracts/index.ts');
    expect(value.git('rev-parse', ':packages/contracts/index.ts')).toBe(value.lock.publicContracts[0]!.version);
    expect(value.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(value.git('hash-object', '--path=packages/contracts/index.ts', '--', join(value.root, 'packages/contracts/index.ts')))
      .toBe(value.lock.publicContracts[0]!.version);
    expect(value.git('hash-object', '--no-filters', '--', join(value.root, 'packages/contracts/index.ts')))
      .not.toBe(value.lock.publicContracts[0]!.version);
    const receipt = await value.run();
    expect(receipt.status).toBe('BLOCKED');
    expect(receipt.commands).toEqual([]);
    expect(receipt.issues.some(issue => issue.message.includes('Working source differs from locked source'))).toBe(true);
  });

  it('blocks an external-looking output junction that resolves into the checkout', async () => {
    const value = fixture();
    const alias = join(value.directory, 'external-output-link');
    symlinkSync(value.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const receipt = await runDependencyContracts(value.lockPath, join(alias, 'ignored-output'), value.root);
      expect(receipt.status).toBe('BLOCKED');
      expect(receipt.commands).toEqual([]);
      expect(receipt.issues.some(issue => issue.message.includes('outside the source checkout'))).toBe(true);
    } finally { unlinkSync(alias); }
  });

  it('refuses an existing evidence directory and preserves its old receipts', async () => {
    const value = fixture();
    mkdirSync(value.out);
    writeFileSync(join(value.out, 'compatibility.json'), 'immutable earlier evidence\n');
    await expect(value.run()).rejects.toThrow();
    expect(readFileSync(join(value.out, 'compatibility.json'), 'utf8')).toBe('immutable earlier evidence\n');
  });
});
