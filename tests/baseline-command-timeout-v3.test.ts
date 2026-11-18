import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandEvidence } from '../packages/contracts/implementation-evidence.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const runner = new URL('../scripts/research-baseline.ts', import.meta.url).href;
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const commands = ['--version', 'typecheck', 'test', 'build', 'test:browser'];
const links: string[] = [];
let directory: string, node: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'm01 command timeout '));
  node = join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
  copyFileSync(process.execPath, node, constants.COPYFILE_FICLONE);
});
afterAll(() => {
  for (const path of links.splice(0)) unlinkSync(path);
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function fixture(testDelayMs = 0) {
  const root = mkdtempSync(join(directory, 'case ')), bin = join(root, 'bin'), runtime = join(root, 'runtime');
  mkdirSync(bin); mkdirSync(runtime); mkdirSync(join(root, 'scripts'));
  const executable = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node');
  linkSync(node, executable);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', packageManager: 'pnpm@10.30.3' }));
  const calls = join(root, 'calls.jsonl'), out = join(root, 'out');
  const entry = join(bin, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  mkdirSync(join(bin, 'node_modules', 'pnpm', 'bin'), { recursive: true });
  writeFileSync(entry, `const fs = require('node:fs');
const command = process.argv[2];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ command, pid: process.pid }) + '\\n');
if (command === '--version') console.log('10.30.3');
else {
  console.log('command-ready:' + command);
  if (command === 'test') setTimeout(() => console.log('command-complete:' + command), ${testDelayMs});
  else console.log('command-complete:' + command);
}
`);
  writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nexit /b 97\r\n');
  // Execute the unchanged CLI source in an owned miniature checkout. Junctions
  // only supply its real imports; no browser, build, or repository tests run.
  copyFileSync(join(repository, 'scripts/research-baseline.ts'), join(root, 'scripts/research-baseline.ts'));
  for (const name of ['packages', 'node_modules']) {
    const path = join(root, name);
    symlinkSync(join(repository, name), path, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(path);
  }
  const execute = (args: string[]) => spawnSync(executable, ['--import', loader, ...args], {
    cwd: root, env: { ...process.env, PATH: bin, Path: bin }, encoding: 'utf8',
    timeout: 20_000, windowsHide: true, maxBuffer: 128 * 1024,
  });
  const api = (timeout: string) => execute(['--input-type=module', '--eval', `
    import { runBaseline } from ${JSON.stringify(runner)};
    try { console.log(JSON.stringify(await runBaseline(${JSON.stringify(out)}, ${JSON.stringify(root)}, { commandTimeoutMs: ${timeout} }))); }
    catch (error) { console.log(JSON.stringify({ error: { code: error.code, message: error.message } })); process.exitCode = 1; }
  `]);
  const cli = (args: string[] = []) => execute([join(root, 'scripts/research-baseline.ts'), '--out', out, ...args]);
  const observed = (): { command: string; pid: number }[] => existsSync(calls)
    ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { root, out, api, cli, observed };
}

describe('M01 explicit baseline command deadline', () => {
  it('passes the configured budget to real children and retains earlier/later evidence after a timeout', () => {
    const value = fixture(1500), result = value.api('750');
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { commandTimeoutMs: number; commands: CommandEvidence[] };
    expect(value.observed().map(call => call.command)).toEqual(commands);
    const timeout = report.commands[2]!, log = readFileSync(timeout.boundedLogRef, 'utf8');
    expect(log).toContain('command-ready:test');
    expect(timeout.termination).toBe('TIMEOUT');
    expect(timeout.status).toBe('BLOCKED'); expect(report.commandTimeoutMs).toBe(750);
    expect(log).toContain('termination: TIMEOUT'); expect(log).not.toContain('command-complete:test');
    expect(timeout.logDigest).toBe(createHash('sha256').update(log).digest('hex'));
    expect(() => process.kill(value.observed()[2]!.pid, 0)).toThrow();
    expect(report.commands.filter((_, index) => index !== 2).every(command => command.status === 'PASS')).toBe(true);
    expect(report.commands.every(command => existsSync(command.boundedLogRef))).toBe(true);
    console.info('M01_BASELINE_TIMEOUT_RECEIPT ' + JSON.stringify({ commandTimeoutMs: report.commandTimeoutMs, commands: report.commands, timeoutLog: log }));
  });

  it('returns nonzero from the actual CLI on timeout while retaining every completed phase log', () => {
    const value = fixture(1500), result = value.cli(['--command-timeout-ms', '750']);
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.commands[2]).toMatchObject({ status: 'BLOCKED', termination: 'TIMEOUT' });
    expect(report.commandTimeoutMs).toBe(750);
    expect(value.observed().map(call => call.command)).toEqual(commands);
    for (const name of ['00-package-manager', '10-typecheck', '10-test', '10-build', '10-test-browser'])
      expect(existsSync(join(value.out, name + '.log'))).toBe(true);
  });

  it.each([3000, 2147483647])('accepts a finite %i ms CLI budget without timer overflow', commandTimeoutMs => {
    const value = fixture(1000), result = value.cli(['--command-timeout-ms', String(commandTimeoutMs)]);
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.commandTimeoutMs).toBe(commandTimeoutMs);
    expect(report.commands.every((command: CommandEvidence) => command.status === 'PASS' && command.termination === 'NONE')).toBe(true);
    expect(result.stderr).not.toContain('TimeoutOverflowWarning');
  });

  it('keeps the existing default CLI invocation and declared command sequence', () => {
    const value = fixture(), result = value.cli();
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    expect(value.observed().map(call => call.command)).toEqual(commands);
    expect(JSON.parse(result.stdout).commands.every((command: CommandEvidence) => command.status === 'PASS')).toBe(true);
  });

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '"750"', 'null'])('rejects API budget %s before launching or writing evidence', timeout => {
    const value = fixture(), result = value.api(timeout);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(value.observed()).toEqual([]); expect(existsSync(value.out)).toBe(false);
  });

  it.each(['0', '-1', '1.5', '1e3', 'Infinity', '2147483648', '750ms', ''])('rejects CLI budget %s before launching or writing evidence', timeout => {
    const value = fixture(), result = value.cli(['--command-timeout-ms', timeout]);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(2);
    expect(value.observed()).toEqual([]); expect(existsSync(value.out)).toBe(false);
  });

  it.each([
    ['--command-timeout-ms'],
    ['--command-timeout-ms', '1000', '--command-timeout-ms', '2000'],
    ['--timeout', '1000'],
  ])('rejects incomplete, duplicate, or unknown timeout arguments %j', (...args) => {
    const value = fixture(), result = value.cli(args);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(2);
    expect(value.observed()).toEqual([]); expect(existsSync(value.out)).toBe(false);
  });
});
