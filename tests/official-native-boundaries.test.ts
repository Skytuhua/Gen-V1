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

it('accepts complete ACP frames independently of stdout chunk boundaries', async () => {
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough()});
  const notifications: string[] = [];
  const rpc = new AcpConnection(child as unknown as ChildProcess, method => notifications.push(method), 90);
  const result = rpc.request('initialize', {});
  try {
    const notification = JSON.stringify({jsonrpc: '2.0', method: 'session/update', params: '猫'.repeat(7)}) + '\n';
    const response = JSON.stringify({jsonrpc: '2.0', id: 1, result: {ok: true}}) + '\n';
    child.stdout.write(notification.slice(0, 12));
    child.stdout.write(notification.slice(12) + response);
    await expect(result).resolves.toEqual({ok: true});
    expect(notifications).toEqual(['session/update']);
  } finally { rpc.close(); await result.catch(() => {}); }
});

it.each([false, true])('retains the ACP byte limit with newline present: %s', async newline => {
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough()});
  const notifications: string[] = [];
  const rpc = new AcpConnection(child as unknown as ChildProcess, method => notifications.push(method), 90);
  const result = rpc.request('initialize', {});
  try {
    child.stdout.write(JSON.stringify({jsonrpc: '2.0', method: 'session/update', params: '猫'.repeat(20)}) + (newline ? '\n' : ''));
    await expect(result).rejects.toMatchObject({code: 'OFFICIAL_PROTOCOL_INVALID'});
    expect(notifications).toEqual([]);
  } finally { rpc.close(); await result.catch(() => {}); }
});
