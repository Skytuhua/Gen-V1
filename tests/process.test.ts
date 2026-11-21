import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { runProcess } from '../packages/capabilities/process.ts';

it('preserves UTF-8 characters split across stdout and stderr chunks', async () => {
  const script = `const text=Buffer.from('ok 🔧 漢字 done'); for(const fd of [1,2])require('node:fs').writeSync(fd,text.subarray(0,5)); setTimeout(()=>{for(const fd of [1,2])require('node:fs').writeSync(fd,text.subarray(5));},80);`;
  const result = await runProcess(process.execPath, ['-e', script], process.cwd(), new AbortController().signal, () => {});
  expect(result).toMatchObject({ stdout: 'ok 🔧 漢字 done', stderr: 'ok 🔧 漢字 done', status: 'succeeded', exitCode: 0, truncated: false });
});

it('bounds each captured stream by UTF-8 bytes without splitting a character', async () => {
  const script = `const text='漢'.repeat(100000);process.stdout.write(text);process.stderr.write(text);`;
  const result = await runProcess(process.execPath, ['-e', script], process.cwd(), new AbortController().signal, () => {});
  expect(result).toMatchObject({ status: 'succeeded', truncated: true });
  for (const text of [result.stdout, result.stderr]) {
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(256 * 1024);
    expect(text).toMatch(/^漢+$/u);
    expect(text.length).toBeGreaterThan(80000);
  }
});

it('preserves the child result when an optional progress observer fails', () => {
  // Isolate event callbacks so a regression cannot crash the test runner.
  const script = "import { runProcess } from './packages/capabilities/process.ts';"
    + "const result = await runProcess(process.execPath, ['-e','process.stdout.write(\"child result\")'], process.cwd(), new AbortController().signal, () => { throw Error('progress sink unavailable'); });"
    + "process.stdout.write(JSON.stringify(result));";
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject({ status: 'succeeded', exitCode: 0, stdout: 'child result' });
});
