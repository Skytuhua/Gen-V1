import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runRecordedCommand } from '../scripts/research-baseline.ts';

const repository = new URL('../', import.meta.url);
const runner = new URL('../scripts/research-baseline.ts', import.meta.url).href;
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
let directory: string;
let node: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'm01 package manager '));
  node = join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
  // A real Node copy has no adjacent Corepack installation. Hard links below
  // give each case an independent executable directory without another copy.
  copyFileSync(process.execPath, node, constants.COPYFILE_FICLONE);
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function fixture(version = '10.30.3') {
  const root = mkdtempSync(join(directory, 'case '));
  const bin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  mkdirSync(bin);
  mkdirSync(runtime);
  const executable = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
  linkSync(node, executable);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.30.3' }));
  const calls = join(root, 'calls.jsonl');
  const entry = join(bin, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  mkdirSync(join(bin, 'node_modules', 'pnpm', 'bin'), { recursive: true });
  writeFileSync(entry, `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args: process.argv.slice(2), network: process.env.COREPACK_ENABLE_NETWORK ?? null}) + '\\n');
if (process.argv[2] === '--version') console.log(${JSON.stringify(version)});
`);
  // This shell shim must only locate its adjacent trusted JavaScript entry.
  writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nexit /b 97\r\n');
  const execute = () => spawnSync(executable, ['--import', loader, '--input-type=module', '--eval', `
    import { runBaseline } from ${JSON.stringify(runner)};
    try {
      const result = await runBaseline(${JSON.stringify(join(root, 'out'))}, ${JSON.stringify(root)});
      console.log(JSON.stringify(result));
    } catch (error) { console.error(error.code + ': ' + error.message); process.exitCode = 1; }
  `], { cwd: repository, env: { ...process.env, PATH: bin, Path: bin }, encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 128 * 1024 });
  const observed = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { root, entry, runtime, execute, observed };
}

describe('M01 installed package manager admission', () => {
  it('inherits only the configured Corepack cache for offline commands, unless explicitly overridden', async () => {
    const cache = join(directory, 'configured cache'), override = join(directory, 'other cache');
    vi.stubEnv('COREPACK_HOME', cache);
    vi.stubEnv('M01_UNRELATED_SETTING', 'unrelated');
    try {
      const probe = async (environment: NodeJS.ProcessEnv) => {
        const result = await runRecordedCommand(process.execPath, ['-e',
          'console.log(JSON.stringify([process.env.COREPACK_HOME, process.env.M01_UNRELATED_SETTING]))',
        ], { cwd: directory, environment });
        expect(result.exitCode, result.stderr).toBe(0);
        return JSON.parse(result.stdout);
      };
      expect(await probe({ COREPACK_ENABLE_NETWORK: '0' })).toEqual([cache, null]);
      expect(await probe({ COREPACK_ENABLE_NETWORK: '0', COREPACK_HOME: override })).toEqual([override, null]);
      expect(await probe({})).toEqual([null, null]);
    } finally { vi.unstubAllEnvs(); }
  });

  it('runs the declared baseline commands with installed pnpm when Corepack is absent', () => {
    const value = fixture();
    const result = value.execute();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(report.packageManagerVersion).toBe('10.30.3');
    expect(value.observed().map(call => call.args)).toEqual([
      ['--version'], ['typecheck'], ['test'], ['build'], ['test:browser'],
    ]);
    expect(report.commands.every((command: { exitCode: number; status: string }) => command.exitCode === 0 && command.status === 'PASS')).toBe(true);
  });

  it('refuses a shell shim that has no installed JavaScript entry', () => {
    const value = fixture();
    rmSync(value.entry);
    const result = value.execute();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(value.observed()).toEqual([]);
    expect(result.stderr).toContain('SPAWN_ERROR: Corepack or an installed pnpm executable/JavaScript entry is required.');
    expect(result.stderr).not.toContain('97');
  });

  it('refuses an installed version mismatch before running project scripts', () => {
    const value = fixture('10.29.0');
    const result = value.execute();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('10.29.0');
    expect(result.stderr).toContain('10.30.3');
    expect(value.observed().map(call => call.args)).toEqual([['--version']]);
  });

  it('disables Corepack downloads for the version probe and every baseline command', () => {
    const value = fixture();
    const dispatcher = join(value.runtime, 'node_modules', 'corepack', 'dist', 'pnpm.js');
    mkdirSync(join(value.runtime, 'node_modules', 'corepack', 'dist'), { recursive: true });
    copyFileSync(value.entry, dispatcher);
    const result = value.execute();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(value.observed().map(call => call.network)).toEqual(['0', '0', '0', '0', '0']);
  });
});
