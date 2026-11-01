import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { AcpConnection } from '../packages/runtime-official/acp.ts';

it.each(['stdin', 'stdout', 'stderr', 'process'] as const)('contains ACP %s failures and rejects requests with safe text', async stream => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const rpc = new AcpConnection(child as unknown as ChildProcess, () => {});
  const result = rpc.request('initialize', {}).catch(error => error);
  try {
    const target = stream === 'process' ? child : child[stream];
    expect(() => target.emit('error', Object.assign(Error('Private native diagnostic'), { code: 'ENOTCONN' }))).not.toThrow();
    expect(await result).toMatchObject({ code: 'OFFICIAL_PROCESS_IO_FAILED', message: 'The native Gemini connection closed unexpectedly. Reconnect the provider and refresh models.' });
    expect(() => target.emit('error', Error('Late private diagnostic'))).not.toThrow();
  } finally { rpc.close(); await result; }
});
