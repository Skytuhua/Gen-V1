import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withPathGuard, type GuardEntry } from '../packages/core/file-access.ts';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const spawned: { emit(event: string, ...args: unknown[]): boolean }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
});
afterEach(() => {
  // Close every spawned mock child so the pooled guard resets between tests.
  for (const child of spawned.splice(0)) child.emit('close', 0);
  Object.defineProperty(process, 'platform', platform);
  vi.useRealTimers();
  spawn.mockReset();
});

function guard() {
  const requests: { id: string; command: string }[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new Writable({
      write(bytes, _encoding, done) { requests.push(JSON.parse(String(bytes))); done(); },
      final(done) { queueMicrotask(() => close(0)); done(); },
    }),
    kill: vi.fn(() => { close(1); return true; }),
    unref: vi.fn(),
    stdio: [],
  });
  spawned.push(child);
  let closed = false;
  function close(code: number) { if (!closed) { closed = true; child.emit('exit', code, null); child.emit('close', code, null); } }
  spawn.mockReturnValue(child);
  return { child, requests, close, reply(index: number) { child.stdout.write(requests[index]!.id + '\n'); } };
}
const path = { path: 'C:\\owned\\host', leaf: false, allowChildWrites: true, childWriteRoot: 'C:\\owned\\host' };
const signal = () => new AbortController().signal;
// The first acquire after a spawn is the startup acquisition; the pooled guard
// applies its extended deadline automatically while the helper is still cold.
const startupGuard = <T>(paths: Parameters<typeof withPathGuard>[0], signal: AbortSignal, action: (manifest: readonly GuardEntry[]) => Promise<T>) => withPathGuard(paths, signal, action);
function observe<T>(operation: Promise<T>) {
  let settled = false;
  const result = operation.then(value => ({ value, error: undefined }), error => ({ value: undefined, error })).finally(() => { settled = true; });
  return { result, settled: () => settled };
}

it('admits a valid first acquisition after the observed cold-start delay and retains its guard', async () => {
  const g = guard(), action = vi.fn(async () => 'guarded');
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(31_944);
  expect(action).not.toHaveBeenCalled();
  expect(observed.settled()).toBe(false);
  g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  g.reply(1); // release
  expect(await observed.result).toEqual({ value: 'guarded', error: undefined });
  expect(action).toHaveBeenCalledOnce();
  expect(g.requests.map(request => request.command)).toEqual(['acquire', 'release']);
  expect(g.child.stdin.writableEnded).toBe(false);
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
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('keeps a nested acquisition deadline at fifteen seconds', async () => {
  const g = guard(), nested = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), () => startupGuard([path], signal(), nested)));
  await vi.advanceTimersByTimeAsync(31_944);
  g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(g.requests.map(request => request.command)).toEqual(['acquire', 'acquire']);
  await vi.advanceTimersByTimeAsync(14_999);
  expect(observed.settled()).toBe(false);
  // A silent helper is retired: the dead child's teardown frees its leases,
  // so no release request is issued and the operation settles at the deadline.
  await vi.advanceTimersByTimeAsync(1);
  expect(observed.settled()).toBe(true);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(nested).not.toHaveBeenCalled();
  expect(g.requests.map(request => request.command)).toEqual(['acquire', 'acquire']);
  expect(g.child.kill).toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('denies a request-level failure without killing the shared guard', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stdout.write(JSON.stringify({ id: g.requests[0]!.id, error: 'The process cannot access the file', code: 32 }) + '\n');
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED', details: { nativeCode: '32' } });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.kill).not.toHaveBeenCalled();
  // The helper answered, so the guard is warm and keeps the strict deadline.
  const second = observe(withPathGuard([path], signal(), vi.fn(async () => 'next')));
  await vi.advanceTimersByTimeAsync(14_999);
  expect(second.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await second.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
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
  // The timed-out release retires the child; teardown frees the outer lease too,
  // so no outer release request is sent and the operation settles immediately.
  await vi.advanceTimersByTimeAsync(1);
  expect(observed.settled()).toBe(true);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(g.child.kill).toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('preserves the separately bounded metadata import deadline', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([{ ...path, tree: true, readOnly: true, gitMetadataImport: true }], signal(), action));
  await vi.advanceTimersByTimeAsync(119_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('still denies a mismatched first response immediately', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stdout.write('wrong-request-id\n');
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('still denies native acquisition failure immediately and retains its numeric code', async () => {
  const g = guard(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0);
  g.child.stderr.write('GUARD_NATIVE_ERROR:32\n'); g.close(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED', details: { nativeCode: '32' } });
  expect(action).not.toHaveBeenCalled();
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('does not enter the action if cancelled while waiting for a valid startup reply', async () => {
  const g = guard(), controller = new AbortController(), action = vi.fn(async () => undefined);
  const observed = observe(startupGuard([path], controller.signal, action));
  await vi.advanceTimersByTimeAsync(31_944);
  controller.abort(); g.reply(0);
  await vi.advanceTimersByTimeAsync(0);
  g.reply(1); // release issued by the teardown path
  expect((await observed.result).error).toMatchObject({ code: 'CANCELLED' });
  expect(action).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(g.child.stdin.writableEnded).toBe(false);
});

it('extends the first acquisition on each cold spawned guard to its startup deadline', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = guard(), action = vi.fn(async () => 'guarded');
    const observed = observe(withPathGuard([path], signal(), action));
    await vi.advanceTimersByTimeAsync(44_999);
    expect(observed.settled()).toBe(false); expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
    expect(action).not.toHaveBeenCalled(); expect(g.child.stdin.writableEnded).toBe(false);
    g.close(1); // retire the pooled guard so the next operation respawns cold
  }
  expect(spawn).toHaveBeenCalledTimes(2);
});

it('keeps ordinary acquisitions on a warm shared guard at fifteen seconds', async () => {
  const g = guard(), action = vi.fn(async () => 'warm'), second = vi.fn(async () => 'second');
  const first = observe(withPathGuard([path], signal(), action));
  await vi.advanceTimersByTimeAsync(0); g.reply(0);
  await vi.advanceTimersByTimeAsync(0); g.reply(1); // release
  expect(await first.result).toEqual({ value: 'warm', error: undefined });
  const observed = observe(withPathGuard([path], signal(), second));
  await vi.advanceTimersByTimeAsync(14_999);
  expect(observed.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await observed.result).error).toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect(second).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledTimes(1);
});
