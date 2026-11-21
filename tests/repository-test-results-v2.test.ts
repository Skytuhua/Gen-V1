import { afterEach, describe, expect, it, vi } from 'vitest';
import { constants, realpathSync } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HarnessError, type Operation, type ResourceGrant } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { handleDomainTool, executeDomainOperation, type DomainContext } from '../packages/capabilities/index.ts';
import { nodeTestReporterPath, testNamePattern, GEN_REPORT_DIR_TOKEN, type RepositoryTestBindingV2 } from '../packages/capabilities/repository-test-binding.ts';

// Same seam as repository-test-binding-v3.test.ts: only the native lease and the
// spawned child are replaced; schema, hashing and binding logic stay real.
const seam = vi.hoisted(() => ({
  guards: [] as { path: string; leaf: boolean; readOnly?: boolean }[][],
  launches: [] as { executable: string; argv: string[]; cwd: string }[],
}));
vi.mock('../packages/core/file-access.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/core/file-access.ts')>();
  return { ...actual, withPathGuard: async (paths: Parameters<typeof actual.withPathGuard>[0], signal: AbortSignal, action: (manifest: []) => Promise<unknown>) => {
    seam.guards.push(structuredClone(paths));
    if (signal.aborted) throw new Error('Owned fixture aborted');
    return action([]);
  } };
});
vi.mock('../packages/capabilities/process.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/capabilities/process.ts')>();
  return { ...actual, runProcess: (...args: Parameters<typeof actual.runProcess>) => {
    seam.launches.push({ executable: args[0], argv: [...args[1]], cwd: args[2] });
    return actual.runProcess(...args);
  } };
});

const realNode = process.execPath;
const directories: string[] = [];
const body = "require('node:test')('owned', () => {});\n";
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const reporterPath = () => realpathSync(nodeTestReporterPath());

afterEach(async () => {
  process.execPath = realNode;
  __setCapabilityFlagForTests('ui.testResultsV1', undefined);
  vi.restoreAllMocks();
  seam.guards.length = 0; seam.launches.length = 0;
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm15 test results ')));
  directories.push(root);
  const storage = join(root, 'storage'), project = join(root, 'project');
  await mkdir(storage); await mkdir(project);
  await writeFile(join(project, 'owned.test.cjs'), body);
  const executable = join(root, process.platform === 'win32' ? 'owned-node.exe' : 'owned-node');
  await copyFile(realNode, executable, constants.COPYFILE_FICLONE);
  process.execPath = executable;
  const info = await stat(project, { bigint: true });
  const grant: ResourceGrant = { id: 'owned-project', threadId: 'owner', kind: 'project', path: project,
    writable: true, label: 'Owned fixture', createdAt: new Date().toISOString(), identity: { dev: String(info.dev), ino: String(info.ino) } };
  const ctx: DomainContext = {
    threadId: 'owner', signal: new AbortController().signal, dataDir: storage,
    resolveResource: async (id, path, write = false) => {
      if (id !== grant.id) throw new HarnessError('CAPABILITY_DENIED', 'Unknown owned fixture resource');
      return resolveGrant(grant, path, write, storage);
    },
    prepareOperation: (kind, args, resourceIds, preconditions, description): Operation =>
      ({ id: 'owned-operation', threadId: 'owner', revision: 1, kind, args, resourceIds, preconditions,
        description, status: 'prepared', approved: false, createdAt: new Date().toISOString() }),
    publishData: (value, provenance) => ({ id: 'owned-data', threadId: 'owner', revision: 1, value, provenance, createdAt: new Date().toISOString() }),
    progress: () => {},
  };
  const prepare = async (extra: Record<string, unknown> = {}) => await handleDomainTool('repository_test_prepare',
    { resourceId: grant.id, testFile: 'owned.test.cjs', ...extra }, ctx) as Operation;
  const execute = (operation: Operation) => executeDomainOperation({ ...operation, approved: true, status: 'running' }, ctx);
  const addVitest = async (entry?: string) => {
    const dir = join(project, 'node_modules', 'vitest');
    await mkdir(dir, { recursive: true });
    if (entry) await symlink(entry, join(dir, 'vitest.mjs'));
    else await writeFile(join(dir, 'vitest.mjs'), 'export {};\n');
  };
  return { root, storage, project, executable, ctx, prepare, execute, addVitest };
}

describe('repository.test binding v2 (ui.testResultsV1)', () => {
  it('keeps the flag-off baseline: vitest/testName rejected and the v1 argv unchanged', async () => {
    const f = await fixture();
    await expect(f.prepare({ recipe: 'vitest' })).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
    await expect(f.prepare({ testName: 'anything' })).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
    const operation = await f.prepare();
    expect(operation.args.executionBinding).toMatchObject({ version: 1, argv: ['--test', '--', 'owned.test.cjs'] });
    expect(operation.args.executionBinding).not.toHaveProperty('aux');
    expect(seam.launches).toEqual([]);
  });

  it('binds the node-test argv template and the reporter as an aux file when the flag is on', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const operation = await f.prepare();
    const reporter = reporterPath();
    const binding = operation.args.executionBinding as RepositoryTestBindingV2;
    expect(binding).toMatchObject({
      version: 2, recipe: 'node-test',
      executable: { path: await realpath(f.executable), sha256: hash(await readFile(f.executable)) },
      cwd: { path: await realpath(f.project) },
      test: { path: await realpath(join(f.project, 'owned.test.cjs')), sha256: hash(body) },
      argv: ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
        `--test-reporter=${reporter}`, `--test-reporter-destination=${GEN_REPORT_DIR_TOKEN}/node-test.jsonl`,
        '--', 'owned.test.cjs'],
      aux: [{ path: reporter, role: 'node-test-reporter', sha256: hash(await readFile(reporter)) }],
    });
    expect(operation.description).toContain('<Gen report folder>');
    expect(operation.description).not.toContain('{GEN_REPORT_DIR}');
  });

  it('appends an escaped exact-match filter for testName and rejects line-breaking names', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const operation = await f.prepare({ testName: 'outer a.b$c* [x] inner?' });
    const binding = operation.args.executionBinding as RepositoryTestBindingV2;
    expect(binding.filter).toEqual({ testName: 'outer a.b$c* [x] inner?', pattern: '^outer a\\.b\\$c\\* \\[x\\] inner\\?$' });
    expect(binding.argv).toContain('--test-name-pattern=^outer a\\.b\\$c\\* \\[x\\] inner\\?$');
    await expect(f.prepare({ testName: 'has\nnewline' })).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
    await expect(f.prepare({ testName: 'has\0nul' })).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
    expect(testNamePattern('a/b\\c(d)')).toBe('^a\\/b\\\\c\\(d\\)$');
  });

  it('binds the Vitest entry inside the granted root and refuses a missing install', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    await expect(f.prepare({ recipe: 'vitest' })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Vitest is not installed') });
    await f.addVitest();
    const operation = await f.prepare({ recipe: 'vitest' });
    const entry = await realpath(join(f.project, 'node_modules', 'vitest', 'vitest.mjs'));
    const binding = operation.args.executionBinding as RepositoryTestBindingV2;
    expect(binding.recipe).toBe('vitest');
    expect(binding.aux).toEqual([{ path: entry, role: 'vitest-entry', dev: expect.any(String), ino: expect.any(String), bytes: expect.any(Number), sha256: expect.any(String) }]);
    expect(binding.argv).toEqual([entry, 'run', 'owned.test.cjs', '--reporter=default', '--reporter=json',
      `--outputFile.json=${GEN_REPORT_DIR_TOKEN}/vitest.json`]);
    expect(seam.launches).toEqual([]);
  });

  it('refuses a Vitest entry that resolves outside the granted project', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const outside = join(f.root, 'outside-vitest.mjs');
    await writeFile(outside, 'export {};\n');
    await f.addVitest(outside);
    await expect(f.prepare({ recipe: 'vitest' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses execution when the stored aux binding or the on-disk aux file drifts', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    await f.addVitest();
    const operation = await f.prepare({ recipe: 'vitest' });
    // Stored-args tamper: any aux sha mismatch fails the exact-equality check.
    const tampered = structuredClone(operation);
    (tampered.args.executionBinding as RepositoryTestBindingV2).aux[0].sha256 = '0'.repeat(64);
    const denied = await f.execute(tampered).then(() => ({ status: 'executed' }), error => ({ status: 'rejected', code: error.code }));
    expect(denied).toEqual({ status: 'rejected', code: 'PRECONDITION_FAILED' });
    // On-disk drift of the aux entry inside the fixture.
    const entry = join(f.project, 'node_modules', 'vitest', 'vitest.mjs');
    await appendFile(entry, '// drifted after approval\n');
    const drifted = await f.execute(operation).then(() => ({ status: 'executed' }), error => ({ status: 'rejected', code: error.code }));
    expect(drifted).toEqual({ status: 'rejected', code: 'PRECONDITION_FAILED' });
    expect(seam.launches).toEqual([]);
  });

  it('substitutes a fresh Gen-owned report directory at launch and captures results', async () => {
    const f = await fixture();
    __setCapabilityFlagForTests('ui.testResultsV1', true);
    const operation = await f.prepare();
    const result = await f.execute(operation) as { testRun?: { runner: string; reportState: string }; status: string };
    expect(seam.launches).toHaveLength(1);
    const launched = seam.launches[0];
    expect(launched.argv.find(a => a.startsWith('--test-reporter-destination=') && a.includes(GEN_REPORT_DIR_TOKEN))).toBeUndefined();
    const destination = launched.argv.find(a => a.startsWith('--test-reporter-destination=') && a.endsWith('node-test.jsonl'))!;
    expect(destination).toContain(join(f.storage, 'test-reports'));
    expect(result.testRun?.runner).toBe('node-test');
    // The real child ran the owned file through the shipped reporter.
    expect(['complete', 'missing']).toContain(result.testRun?.reportState);
  });
});
