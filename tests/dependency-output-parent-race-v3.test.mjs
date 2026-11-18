import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDependencyContracts } from '../scripts/run-dependency-contracts.ts';

const custody = vi.hoisted(() => ({ afterMkdir: undefined }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, mkdir: async (...args) => {
    const result = await actual.mkdir(...args);
    await custody.afterMkdir?.(String(args[0]));
    return result;
  } };
});
const cleanups = [];
afterEach(() => { custody.afterMkdir = undefined; for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

it('blocks an output parent retargeted into the checkout while directory creation awaits', async () => {
  const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'm01-output-parent-race-'))), root = join(directory, 'checkout');
  mkdirSync(root);
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const file of ['.gitattributes', 'package.json', 'pnpm-lock.yaml', 'vitest.config.ts']) copyFileSync(join(repository, file), join(root, file));
  put('.gitignore', 'node_modules\nignored-output\n');
  put('packages/contracts/index.ts', 'export const value = 42;\n');
  put('tests/gate.test.ts', "import { expect, test } from 'vitest';\nimport { value } from '../packages/contracts/index.ts';\ntest('current contract', () => expect(value).toBe(42));\n");
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 }).trim();
  git('init'); git('config', 'user.name', 'Output custody fixture'); git('config', 'user.email', 'custody@example.invalid');
  git('config', 'commit.gpgSign', 'false'); git('config', 'core.autocrlf', 'false'); git('add', '.'); git('commit', '-m', 'Owned compatibility fixture');
  symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  cleanups.push(() => unlinkSync(join(root, 'node_modules')));
  const head = git('rev-parse', 'HEAD'), blob = git('rev-parse', head + ':packages/contracts/index.ts');
  const lock = { schemaVersion: 3, auditAncestorSha: head, executionBaseSha: head,
    inspectedPaths: [{ path: 'packages/contracts/index.ts', blobSha: blob }],
    publicContracts: [{ name: 'runtime-adapter', version: blob, testIds: ['tests/gate.test.ts'] }],
    acceptedDependencyCommits: [head], approvedDrift: [] };
  const lockPath = join(directory, 'source-lock.json'); writeFileSync(lockPath, JSON.stringify(lock));
  const parent = join(directory, 'outside'), output = join(parent, 'ignored-output'); mkdirSync(parent);
  let changed = false;
  // Control only scheduling after the real mkdir. The parent rename and
  // junction/symlink retarget are actual owned filesystem operations.
  custody.afterMkdir = path => {
    if (path !== output) return;
    custody.afterMkdir = undefined;
    renameSync(parent, join(directory, 'original-parent'));
    symlinkSync(root, parent, process.platform === 'win32' ? 'junction' : 'dir');
    cleanups.push(() => unlinkSync(parent));
    mkdirSync(join(root, 'ignored-output'));
    changed = true;
  };
  const receipt = await runDependencyContracts(lockPath, output, root);
  console.info('M01_OUTPUT_PARENT_RACE', JSON.stringify({ changed, output: realpathSync(output), status: receipt.status,
    commands: receipt.commands.map(command => command.status), insideReceipt: existsSync(join(root, 'ignored-output/compatibility.json')),
    sourceStillClean: git('status', '--porcelain', '--untracked-files=all') === '' }));
  expect(changed).toBe(true);
  expect(receipt.status).toBe('BLOCKED');
  expect(receipt.commands).toEqual([]);
  expect(existsSync(join(root, 'ignored-output/source-lock.json'))).toBe(false);
  expect(existsSync(join(root, 'ignored-output/compatibility.json'))).toBe(false);
  expect(readFileSync(lockPath, 'utf8')).toBe(JSON.stringify(lock));
}, 120_000);
