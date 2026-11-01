import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { officialRuntimeCommand, officialRuntimeEnvironment, officialRuntimeHome } from '../packages/runtime-official/environment.ts';
import { terminateProcessTree } from '../packages/runtime-pi/process-tree.ts';
import { openCursor } from '../packages/runtime-official/cursor.ts';

const execute = promisify(execFile);
const sdkGitFlags = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', `core.attributesFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'safe.bareRepository=explicit'];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cursor-git-boundary-'));
  const repo = join(directory, 'checkout'), dataDir = join(repo, 'private-storage'), taskDir = join(dataDir, 'official/cursor-sdk/tasks/fixture');
  const home = officialRuntimeHome(dataDir, 'cursor-sdk');
  await mkdir(join(home, 'tmp'), { recursive: true }); await mkdir(taskDir, { recursive: true });
  const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const seedEnv = { ...officialRuntimeEnvironment(dataDir, 'cursor-sdk', taskDir), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullFile, GIT_CONFIG_SYSTEM: nullFile };
  await execute('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', '--template=', repo], { env: seedEnv, timeout: 5000 });
  return { directory, repo, dataDir, taskDir, home };
}
async function cleanup(directory: string) {
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('cursor-git-boundary-')) throw new Error('Refusing cleanup outside the owned fixture.');
  await rm(directory, { recursive: true, force: true });
}
const git = (cwd: string, env: NodeJS.ProcessEnv, args: string[]) => execute('git', [...sdkGitFlags, ...args], { cwd, env, timeout: 5000, encoding: 'utf8' });

it('keeps SDK Git discovery inside the private task while retaining an explicitly local repository', async () => {
  const f = await fixture();
  try {
    const env = officialRuntimeEnvironment(f.dataDir, 'cursor-sdk', f.taskDir);
    await expect(git(f.taskDir, env, ['rev-parse', '--show-toplevel'])).rejects.toMatchObject({ code: 128 });
    await execute('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', '--template=', f.taskDir], { env, timeout: 5000 });
    const local = await git(f.taskDir, env, ['rev-parse', '--show-toplevel']);
    expect(resolve(local.stdout.trim())).toBe(resolve(f.taskDir));
  } finally { await cleanup(f.directory); }
});

it('does not load private-home Git configuration or inherit caller Git overrides', async () => {
  const f = await fixture(), previous = { ...process.env };
  try {
    await writeFile(join(f.home, '.gitconfig'), '[harness]\nfixture = UNRELATED_HOME_SETTING\n');
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'include.path', GIT_CONFIG_VALUE_0: 'unrelated', GIT_CONFIG_GLOBAL: 'unrelated', GIT_CONFIG_SYSTEM: 'unrelated', GIT_CEILING_DIRECTORIES: 'unrelated' });
    const env = officialRuntimeEnvironment(f.dataDir, 'cursor-sdk', f.taskDir);
    expect(env.GIT_CONFIG_COUNT).toBeUndefined(); expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(env.GIT_CONFIG_SYSTEM).toBe(env.GIT_CONFIG_GLOBAL);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(dirname(f.taskDir));
    await expect(git(f.taskDir, env, ['config', '--global', '--get', 'harness.fixture'])).rejects.toMatchObject({ code: 1 });
  } finally { process.env = previous; await cleanup(f.directory); }
});

it('rejects a path-list separator in Cursor storage before spawning the SDK', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cursor-git-boundary-'));
  try {
    const dataDir = join(directory, `private${delimiter}storage`), taskDir = join(dataDir, 'official/cursor-sdk/tasks/fixture');
    await mkdir(taskDir, { recursive: true });
    expect.soft(() => officialRuntimeEnvironment(dataDir, 'cursor-sdk', taskDir)).toThrow(/storage.*folder/i);
    const spawnChild = vi.fn(() => { throw new Error('Unexpected SDK spawn.'); });
    // Only pre-spawn fields are needed; no native runtime is permitted here.
    await expect(openCursor({ dataDir, taskDir, current: () => true, own: vi.fn() } as any, spawnChild as any, 'fixture')).rejects.toMatchObject({ code: 'OFFICIAL_WORKSPACE_UNSUPPORTED', message: expect.stringMatching(/storage.*folder/i) });
    expect(spawnChild).not.toHaveBeenCalled();
  } finally { await cleanup(directory); }
});

it('reestablishes the actual worker cwd boundary before importing the SDK', async () => {
  const f = await fixture(); let child: ReturnType<typeof spawn> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const preload = join(f.directory, 'capture-before-sdk.mjs');
    await writeFile(preload, `import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,next){if(specifier==='@cursor/sdk'){process.send?.({type:'fixture.environment',cwd:process.cwd(),ceiling:process.env.GIT_CEILING_DIRECTORIES,global:process.env.GIT_CONFIG_GLOBAL,system:process.env.GIT_CONFIG_SYSTEM,noSystem:process.env.GIT_CONFIG_NOSYSTEM});throw new Error('Fixture blocked SDK import before any authentication or network.');}return next(specifier,context);}});`);
    const command = officialRuntimeCommand('cursor-sdk');
    child = spawn(command.file, ['--import', pathToFileURL(preload).href, ...command.args], { cwd: f.taskDir, env: officialRuntimeEnvironment(f.dataDir, 'cursor-sdk', f.taskDir), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const evidence = new Promise<Record<string, unknown>>((accept, reject) => {
      timer = setTimeout(() => reject(new Error('Owned worker did not reach guarded SDK import.')), 5000);
      child!.once('error', reject); child!.once('exit', () => reject(new Error('Owned worker exited before evidence.')));
      child!.on('message', (value: any) => { if (value?.type === 'fixture.environment') accept(value); });
    });
    child.send({ type: 'initialize', init: { mode: 'history', dataDir: f.dataDir, taskDir: f.taskDir, sessionId: 'agent-fixture' } });
    expect(await evidence).toMatchObject({ cwd: f.taskDir, ceiling: dirname(f.taskDir), noSystem: '1', global: process.platform === 'win32' ? 'NUL' : '/dev/null', system: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  } finally { clearTimeout(timer); if (child) await terminateProcessTree(child); await cleanup(f.directory); }
});
