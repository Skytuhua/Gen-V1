import { afterEach, describe, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HarnessError, type Operation, type ResourceGrant } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';
import * as registry from '../packages/core/tool-authority.ts';
import { toolSchemas } from '../packages/capabilities/schemas.ts';
import { handleDomainTool, executeDomainOperation, reconcileDomainOperation, type DomainContext } from '../packages/capabilities/index.ts';

// Only the native lease is replaced. Owned files, grant resolution, schema
// parsing, hashing and the actual shell-free Node child are real. These cases
// prove binding/launcher behavior, not native confinement or lease correctness.
const seam = vi.hoisted(() => ({
  beforeGuard: undefined as undefined | ((paths: { path: string; leaf: boolean; readOnly?: boolean; dev?: string; ino?: string }[]) => Promise<void>),
  guards: [] as { path: string; leaf: boolean; readOnly?: boolean; dev?: string; ino?: string }[][],
  activeGuards: [] as { path: string; leaf: boolean; readOnly?: boolean; dev?: string; ino?: string }[][],
  launchGuards: [] as { path: string; leaf: boolean; readOnly?: boolean; dev?: string; ino?: string }[][],
  launches: [] as { executable: string; argv: string[]; cwd: string }[],
}));
vi.mock('../packages/core/file-access.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/core/file-access.ts')>();
  return { ...actual, withPathGuard: async (paths: Parameters<typeof actual.withPathGuard>[0], signal: AbortSignal, action: (manifest: []) => Promise<unknown>) => {
    seam.guards.push(structuredClone(paths));
    await seam.beforeGuard?.(paths);
    if (signal.aborted) throw new Error('Owned fixture aborted');
    seam.activeGuards.push(paths);
    try { return await action([]); }
    finally { seam.activeGuards.splice(seam.activeGuards.indexOf(paths), 1); }
  } };
});
vi.mock('../packages/capabilities/process.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/capabilities/process.ts')>();
  return { ...actual, runProcess: (...args: Parameters<typeof actual.runProcess>) => {
    seam.launches.push({ executable: args[0], argv: [...args[1]], cwd: args[2] });
    seam.launchGuards.push(structuredClone(seam.activeGuards.flat()));
    return actual.runProcess(...args);
  } };
});

const realNode = process.execPath, originalSchema = toolSchemas.repository_test_prepare;
const directories: string[] = [];
const body = [
  "const fs = require('node:fs'), { createHash } = require('node:crypto');",
  "require('node:test')('owned effect', () => {",
  "  fs.appendFileSync('effect.log', 'x');",
  "  fs.writeFileSync('child-receipt.json', JSON.stringify({ executable: fs.realpathSync(process.execPath), cwd: fs.realpathSync(process.cwd()), argv: process.argv.slice(1), testSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') }));",
  '});', '',
].join('\n');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => {
  process.execPath = realNode;
  Object.defineProperty(toolSchemas, 'repository_test_prepare', { configurable: true, writable: true, value: originalSchema });
  vi.restoreAllMocks();
  seam.beforeGuard = undefined; seam.guards.length = 0; seam.launches.length = 0;
  seam.activeGuards.length = 0; seam.launchGuards.length = 0;
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm02 repository binding ')));
  directories.push(root);
  const storage = join(root, 'storage'), project = join(root, 'project');
  await mkdir(storage); await mkdir(project);
  await writeFile(join(project, 'owned.test.cjs'), body);
  const executable = join(root, process.platform === 'win32' ? 'owned-node.exe' : 'owned-node');
  await copyFile(realNode, executable, constants.COPYFILE_FICLONE);
  process.execPath = executable;
  const info = await stat(project, { bigint: true });
  let grant: ResourceGrant = { id: 'owned-project', threadId: 'owner', kind: 'project', path: project,
    writable: true, label: 'Owned fixture', createdAt: new Date().toISOString(), identity: { dev: String(info.dev), ino: String(info.ino) } };
  const ctx: DomainContext = {
    threadId: 'owner', signal: new AbortController().signal,
    resolveResource: async (id, path, write = false) => {
      if (id !== grant.id) throw new HarnessError('CAPABILITY_DENIED', 'Unknown owned fixture resource');
      return resolveGrant(grant, path, write, storage);
    },
    prepareOperation: (kind, args, resourceIds, preconditions, description): Operation =>
      ({ id: 'owned-operation', threadId: 'owner', revision: 1, kind, args, resourceIds, preconditions,
        description, status: 'prepared', approved: false, createdAt: new Date().toISOString() }),
    publishData: (value, provenance) => ({ id: 'owned-data', threadId: 'owner', revision: 1, value,
      provenance, createdAt: new Date().toISOString() }),
    progress: () => {},
  };
  const prepare = async () => await handleDomainTool('repository_test_prepare',
    { resourceId: grant.id, testFile: 'owned.test.cjs' }, ctx) as Operation;
  const execute = (operation: Operation) => executeDomainOperation({ ...operation, approved: true, status: 'running' }, ctx);
  const changeCwd = async () => {
    const changed = join(root, 'changed-project'); await mkdir(changed);
    await writeFile(join(changed, 'owned.test.cjs'), body);
    const current = await stat(changed, { bigint: true });
    grant = { ...grant, path: changed, identity: { dev: String(current.dev), ino: String(current.ino) } };
  };
  return { root, project, executable, ctx, prepare, execute, changeCwd };
}

describe('repository.test binds the host-resolved launch target', () => {
  it('captures executable bytes, canonical cwd, exact argv/test bytes and the actual registered definition', async () => {
    const f = await fixture(), operation = await f.prepare();
    const definition = registry.buildToolRegistry().find(item => item.id === 'repository_test_prepare')!;
    expect(operation.args.executionBinding).toMatchObject({
      version: 1,
      executable: { path: await realpath(f.executable), sha256: hash(await readFile(f.executable)) },
      cwd: { path: await realpath(f.project) },
      argv: ['--test', '--', 'owned.test.cjs'],
      test: { path: await realpath(join(f.project, 'owned.test.cjs')), sha256: hash(body) },
      definition: { id: definition.id, version: definition.version, schemaDigest: definition.schemaDigest, executorBinding: definition.executorBinding },
    });
    expect(operation.description).toContain(f.executable);
    expect(operation.description).toContain(f.project);
    expect(seam.launches).toEqual([]);
  });

  it('rejects a model-supplied execution binding before filesystem or launch work', async () => {
    const f = await fixture();
    await expect(handleDomainTool('repository_test_prepare', {
      resourceId: 'owned-project', testFile: 'owned.test.cjs', executionBinding: { executable: 'spoofed' },
    }, f.ctx)).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
    expect(seam.guards).toEqual([]); expect(seam.launches).toEqual([]);
  });

  it('requires fresh preparation before executing an old unbound operation', async () => {
    const f = await fixture(), operation = await f.prepare();
    delete operation.args.executionBinding;
    const result = await f.execute(operation).then(() => ({ status: 'executed' }), error => ({ status: 'rejected', code: error.code }));
    expect(result).toEqual({ status: 'rejected', code: 'PRECONDITION_FAILED' });
    expect(seam.launches).toEqual([]);
  });

  const changes = ['cwd', 'executable path', 'executable identity', 'executable bytes during guard acquisition', 'test identity', 'test bytes', 'schema', 'version'] as const;
  it.each(changes)('denies changed %s before launching any child', async change => {
    const f = await fixture(), operation = await f.prepare();
    let guardMutationObserved = false;
    if (change === 'cwd') await f.changeCwd();
    if (change === 'executable path') {
      const replacement = join(f.root, process.platform === 'win32' ? 'replacement-node.exe' : 'replacement-node');
      await copyFile(realNode, replacement, constants.COPYFILE_FICLONE); process.execPath = replacement;
    }
    if (change === 'executable identity') {
      await rename(f.executable, f.executable + '.before');
      await copyFile(realNode, f.executable, constants.COPYFILE_FICLONE);
    }
    if (change === 'executable bytes during guard acquisition') {
      seam.beforeGuard = async paths => {
        if (!guardMutationObserved && paths.some(path => path.path === join(f.project, 'owned.test.cjs'))) {
          await Promise.resolve();
          await appendFile(f.executable, '\nowned executable overlay changed after approval\n');
          guardMutationObserved = true;
        }
      };
    }
    if (change === 'test identity') {
      const path = join(f.project, 'owned.test.cjs');
      await rename(path, path + '.before'); await writeFile(path, body);
    }
    if (change === 'test bytes') await appendFile(join(f.project, 'owned.test.cjs'), '// changed\n');
    if (change === 'schema') Object.defineProperty(toolSchemas, 'repository_test_prepare', {
      configurable: true, writable: true, value: originalSchema.extend({ futureOption: z.string().optional() }),
    });
    if (change === 'version') {
      const current = registry.buildToolRegistry();
      // Deliberately violate the public V1 type to test runtime binding drift.
      vi.spyOn(registry, 'buildToolRegistry').mockReturnValue(current.map(item =>
        item.id === 'repository_test_prepare' ? { ...item, version: item.version + 1 } : item) as unknown as ReturnType<typeof registry.buildToolRegistry>);
    }
    const result = await f.execute(operation).then(() => ({ status: 'executed' }), error => ({ status: 'rejected', code: error.code }));
    if (change === 'executable bytes during guard acquisition') expect(guardMutationObserved).toBe(true);
    expect(result).toEqual({ status: 'rejected', code: 'PRECONDITION_FAILED' });
    expect(seam.launches).toEqual([]);
  });

  it('launches exactly the captured tuple while executable and test identities remain guarded', async () => {
    const f = await fixture(), operation = await f.prepare();
    seam.guards.length = 0;
    const result = await f.execute(operation);
    expect(result).toMatchObject({ status: 'succeeded', exitCode: 0, cancelled: false, timedOut: false });
    expect(seam.launches).toEqual([{ executable: await realpath(f.executable), argv: ['--test', '--', 'owned.test.cjs'], cwd: await realpath(f.project) }]);
    expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
    const guarded = seam.launchGuards[0];
    for (const path of [await realpath(f.executable), await realpath(join(f.project, 'owned.test.cjs'))]) {
      expect(guarded).toContainEqual(expect.objectContaining({ path, leaf: true, readOnly: true,
        dev: expect.any(String), ino: expect.any(String) }));
    }
    expect(seam.activeGuards).toEqual([]);
    const binding = operation.args.executionBinding as { executable: { path: string }; cwd: { path: string }; test: { path: string; sha256: string }; argv: string[] };
    expect(seam.launches[0]).toEqual({ executable: binding.executable.path, argv: binding.argv, cwd: binding.cwd.path });
    expect(JSON.parse(await readFile(join(f.project, 'child-receipt.json'), 'utf8'))).toEqual({
      executable: binding.executable.path, cwd: binding.cwd.path, argv: [binding.test.path], testSha256: binding.test.sha256,
    });
  });

  it('propagates unavailable native custody without launching an unguarded fallback', async () => {
    const f = await fixture(), operation = await f.prepare();
    seam.beforeGuard = async () => { throw new HarnessError('CAPABILITY_DENIED', 'Owned unavailable native custody fixture'); };
    await expect(f.execute(operation)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    expect(seam.launches).toEqual([]);
  });

  it.each([true, false])('keeps recorded outcomes readable without relaunching (legacy=%s)', async legacy => {
    const f = await fixture(), operation = await f.prepare();
    if (legacy) delete operation.args.executionBinding;
    const observed = await reconcileDomainOperation({ ...operation, status: 'unknown',
      result: { exitCode: 0, cancelled: false, timedOut: false } }, f.ctx);
    expect(observed).toMatchObject({ status: 'succeeded', basis: 'recorded-result' });
    expect(seam.launches).toEqual([]);
  });
});

