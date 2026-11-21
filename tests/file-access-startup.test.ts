import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withPathGuard, type GuardEntry } from '../packages/core/file-access.ts';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.useRealTimers();
  spawn.mockReset();
});

function guard(options?: { closeOnEnd?: boolean; closeOnKill?: boolean }) {
  const requests: { id: string; command: string }[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new Writable({
      write(bytes, _encoding, done) { requests.push(JSON.parse(String(bytes))); done(); },
      final(done) { if (options?.closeOnEnd !== false) queueMicrotask(() => close(0)); done(); },
    }),
    kill: vi.fn(() => { if (options?.closeOnKill !== false) close(1); return true; }),
    unref: vi.fn(),
  });
  let closed = false;
  function close(code: number) { if (!closed) { closed = true; child.emit('exit', code, null); child.emit('close', code, null); } }
  spawn.mockReturnValue(child);
  return { child, requests, close, reply(index: number) { child.stdout.write(requests[index]!.id + '\n'); } };
}
const path = { path: 'C:\\owned\\host', leaf: false, allowChildWrites: true, childWriteRoot: 'C:\\owned\\host' };
const signal = () => new AbortController().signal;
const startupGuard = <T>(paths: Parameters<typeof withPathGuard>[0], signal: AbortSignal, action: (manifest: readonly GuardEntry[]) => Promise<T>) => withPathGuard(paths, signal, action, undefined, { startupAcquisition: true });
function observe<T>(operation: Promise<T>) {
  let settled = false;
  const result = operation.then(value => ({ value, error: undefined }), error => ({ value: undefined, error })).finally(() => { settled = true; });
  return { result, settled: () => settled };
}

it('admits a valid first acquisition after the observed cold-start delay and closes its guard', async () => {
  const g = guard(), action = vi.fn(async () => 'guarded');
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(31_944);
  expect(action).not.toHaveBeenCalled();
  expect(observed.settled()).toBe(false);
  g.reply(0);
  expect(await observed.result).toEqual({ value: 'guarded', error: undefined });
  expect(action).toHaveBeenCalledOnce();
  expect(g.child.stdin.writableEnded).toBe(true);
  expect(g.child.kill).not.toHaveBeenCalled();
});

it('denies a silent first acquisition at its bounded startup deadline without entering the action', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(44_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('ignores a nested startup opt-in and keeps its acquisition deadline at fifteen seconds', async () => {
  const g = guard(), nested = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), () => startupGuard([path], signal(), nested)));
  await vi.advanceTimersByTimeAsync(31_944);
  g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(g.requests.map(request => request.command)).toEqual(['acquire', 'acquire']);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(observed.settled()).toBe(true);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(nested).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('keeps the later release deadline at fifteen seconds', async () => {
  const g = guard(), nested = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), () => startupGuard([path], signal(), nested)));
  await vi.advanceTimersByTimeAsync(0); g.reply(0);
  await vi.advanceTimersByTimeAsync(0); g.reply(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(nested).toHaveBeenCalledOnce();
  expect(g.requests.map(request => request.command)).toEqual(['acquire', 'acquire', 'release']);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('preserves the separately bounded metadata import deadline', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([{ ...path, tree: true, readOnly: true, gitMetadataImport: true }], signal(), action));
  await vi.advanceTimersByTimeAsync(119_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('still denies a mismatched first response immediately', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stdout.write('wrong-request-id\n');
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('still denies native acquisition failure immediately and retains its numeric code', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stderr.write('GUARD_NATIVE_ERROR:32\n'); g.close(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED', details: { nativeCode: '32' } });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('does not enter the action if cancelled while waiting for a valid startup reply', async () => {
  const g = guard(), controller = new AbortController(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], controller.signal, action));
  await vi.advanceTimersByTimeAsync(31_944);
  controller.abort(); g.reply(0);
  expect((await observed.result).error).toMatchObject({ code: 'CANCELLED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});

it('keeps unrelated first acquisitions at fifteen seconds', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(withPathGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(14_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
});


it('rejects late sixteen-second replies on each fresh ordinary guard', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = guard(), action = vi.fn(async () => 'guarded');
    const observed = observe(withPathGuard([path], signal(), action));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(observed.settled()).toBe(false); expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001); g.reply(0);
    expect((await observed.result).error).toMatchObject({code: 'CAPABILITY_DENIED'});
    expect(action).not.toHaveBeenCalled(); expect(g.child.stdin.writableEnded).toBe(true);
  }
  expect(spawn).toHaveBeenCalledTimes(2);
});

it('settles a denied startup acquisition inside the bounded close when the child never exits', async () => {
  const g = guard({ closeOnEnd: false, closeOnKill: false }), action = vi.fn(async () => 'guarded');
  const stdoutClosed = vi.fn();
  g.child.stdout.once('close', stdoutClosed);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(45_000);
  expect(observed.settled()).toBe(false);
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(true);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(g.child.kill).toHaveBeenCalledTimes(1);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.kill).toHaveBeenCalledTimes(1);
  expect(g.child.unref).toHaveBeenCalledTimes(1);
  expect(g.child.stdin.destroyed).toBe(true);
  expect(g.child.listenerCount('close')).toBe(0);
  g.child.stdout.emit('close');
  expect(stdoutClosed).toHaveBeenCalledOnce();
  expect(() => g.child.emit('error', new Error('late child shutdown error'))).not.toThrow();
  expect(() => g.child.stdin.emit('error', new Error('late pipe shutdown error'))).not.toThrow();
  g.child.stdout.write('late-reply\n');
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
});

it('fails closed when a fulfilled action cannot confirm the guard child closed', async () => {
  const g = guard({ closeOnEnd: false, closeOnKill: false });
  const observed = observe(startupGuard([path], signal(), async () => 'guarded'));
  await vi.advanceTimersByTimeAsync(0);
  g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(g.child.kill).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(g.child.unref).toHaveBeenCalledTimes(1);
});

it('still returns the action value when the close is confirmed after one kill attempt', async () => {
  const g = guard({ closeOnEnd: false });
  const observed = observe(startupGuard([path], signal(), async () => 'guarded'));
  await vi.advanceTimersByTimeAsync(0);
  g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(g.child.kill).toHaveBeenCalledTimes(1);
  expect(await observed.result).toEqual({ value: 'guarded', error: undefined });
  expect(g.child.unref).not.toHaveBeenCalled();
});

it('keeps the denied error and its native details through an unconfirmed close', async () => {
  const g = guard({ closeOnEnd: false, closeOnKill: false }), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stderr.write('GUARD_NATIVE_ERROR:32\n'); g.child.emit('exit', 1, null);
  await vi.advanceTimersByTimeAsync(0);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(g.child.kill).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED', details: { nativeCode: '32' } });
  expect(action).not.toHaveBeenCalled();
});
