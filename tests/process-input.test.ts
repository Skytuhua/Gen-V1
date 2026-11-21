import { expect, it } from 'vitest';
import { runProcess } from '../packages/capabilities/process.ts';

it('pipes options.input to the child stdin', async () => {
  const script = "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write('read:'+data));";
  const result = await runProcess(process.execPath, ['-e', script], process.cwd(), new AbortController().signal, () => {}, 30_000, {}, 256*1024, { input: 'hello hooks' });
  expect(result).toMatchObject({ status: 'succeeded', stdout: 'read:hello hooks' });
});

it('does not throw when a non-reading child exits while a large input is being written', async () => {
  const result = await runProcess(process.execPath, ['-e', ''], process.cwd(), new AbortController().signal, () => {}, 30_000, {}, 256*1024, { input: 'x'.repeat(2*1024*1024) });
  expect(result.status).toBe('succeeded');
});

it('keeps stdin ignored when no input is given', async () => {
  const result = await runProcess(process.execPath, ['-e', "let n=0;try{process.stdin.on('data',()=>n++);process.stdin.on('error',e=>process.stdout.write('err:'+e.code));setTimeout(()=>process.stdout.write('n='+n),100);}catch{process.stdout.write('nostdin')}"], process.cwd(), new AbortController().signal, () => {});
  expect(result.status).toBe('succeeded');
  expect(result.stdout).not.toContain('err:');
});

it('reports the label in progress', async () => {
  const messages: string[] = [];
  const result = await runProcess(process.execPath, ['-e', ''], process.cwd(), new AbortController().signal, m => messages.push(m), 30_000, {}, 256*1024, { label: 'hook PreToolUse echo' });
  expect(result.status).toBe('succeeded');
  expect(messages.join('\n')).toContain('Started hook PreToolUse echo (PID');
});

it('still kills the process tree on timeout when input is provided', async () => {
  const script = "let data='';process.stdin.on('data',c=>data+=c);setTimeout(()=>{},60000);";
  const started = Date.now();
  const result = await runProcess(process.execPath, ['-e', script], process.cwd(), new AbortController().signal, () => {}, 500, {}, 256*1024, { input: 'data' });
  expect(result).toMatchObject({ status: 'failed', timedOut: true });
  expect(Date.now() - started).toBeLessThan(20_000);
});
