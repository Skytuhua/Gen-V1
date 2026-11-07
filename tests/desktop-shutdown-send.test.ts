import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { requestBackendShutdown } from '../apps/desktop/backend-policy';

const sender = (send: ChildProcess['send'], connected = true) => ({ send, connected });

describe('owned backend shutdown send', () => {
  it('keeps an asynchronous broken pipe in the failed shutdown result', async () => {
    const failed = vi.fn();
    const send = vi.fn((_message: unknown, _callback: (error: Error | null) => void) => true);
    const child = sender(send as unknown as ChildProcess['send']);
    requestBackendShutdown(child, 'exact-launch-token', failed);
    expect(send).toHaveBeenCalledWith({ type: 'harness.shutdown', token: 'exact-launch-token' }, expect.any(Function));
    const callback = send.mock.calls[0][1];
    queueMicrotask(() => callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(failed).toHaveBeenCalledOnce();
  });

  it('does not send over an already disconnected channel', () => {
    const send = vi.fn(), failed = vi.fn();
    requestBackendShutdown(sender(send as ChildProcess['send'], false), 'token', failed);
    expect(send).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('reports a synchronous send failure without throwing during startup cleanup', () => {
    const failed = vi.fn();
    const child = sender((() => { throw new Error('channel closed'); }) as ChildProcess['send']);
    expect(() => requestBackendShutdown(child, 'token', failed)).not.toThrow();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('does not mistake send backpressure for a failed or acknowledged shutdown', () => {
    const failed = vi.fn();
    const child = sender(((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null); return false;
    }) as ChildProcess['send']);
    expect(requestBackendShutdown(child, 'token', failed)).toBeUndefined();
    expect(failed).not.toHaveBeenCalled();
  });
});
