import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import * as childProcess from 'node:child_process';
import {windowsSecretCodec} from '../packages/storage/secret-codec.ts';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn(), on: EventEmitter.prototype.on }),
    stdout: new EventEmitter(),
    kill: vi.fn(),
  }) as EventEmitter & { stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }; stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
  (child.stdout as unknown as { setEncoding: () => void }).setEncoding = () => {};
  return child;
}
function asWin32() {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  return () => Object.defineProperty(process, 'platform', descriptor);
}

describe('windowsSecretCodec on a non-Windows host', () => {
  it('rejects protect and unprotect without spawning a child', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn');
    const codec = windowsSecretCodec();
    await expect(codec.protect('secret')).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
    await expect(codec.unprotect('cipher')).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe('windowsSecretCodec protocol on win32', () => {
  it('sends the value over stdin as JSON and returns the child output without its trailing newline', async () => {
    const restore = asWin32();
    const child = fakeChild();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().protect('sk-live-value');
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [cmd, args] = spawnSpy.mock.calls[0]! as unknown as [string, string[]];
      // The secret value must travel through stdin, never the command line.
      expect(cmd + args.join(' ')).not.toContain('sk-live-value');
      const written = JSON.parse((child.stdin.end as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
      expect(written).toEqual({ operation: 'protect', value: 'sk-live-value' });
      child.stdout.emit('data', 'ZW5jcnlwdGVk\r\n');
      child.emit('close', 0);
      await expect(pending).resolves.toBe('ZW5jcnlwdGVk');
    } finally { restore(); }
  });

  it('sends the unprotect operation for unprotect calls', async () => {
    const restore = asWin32();
    const child = fakeChild();
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().unprotect('cipher-blob');
      const written = JSON.parse((child.stdin.end as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
      expect(written).toEqual({ operation: 'unprotect', value: 'cipher-blob' });
      child.stdout.emit('data', 'plain\n');
      child.emit('close', 0);
      await expect(pending).resolves.toBe('plain');
    } finally { restore(); }
  });

  it('rejects with SECRET_STORAGE_UNAVAILABLE when the child exits non-zero', async () => {
    const restore = asWin32();
    const child = fakeChild();
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().protect('value');
      child.emit('close', 1);
      await expect(pending).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
    } finally { restore(); }
  });

  it('rejects with SECRET_STORAGE_UNAVAILABLE when the child cannot be spawned', async () => {
    const restore = asWin32();
    const child = fakeChild();
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().protect('value');
      child.emit('error', new Error('ENOENT'));
      await expect(pending).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
    } finally { restore(); }
  });

  it('kills the child and rejects when output exceeds the bound', async () => {
    const restore = asWin32();
    const child = fakeChild();
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().protect('value');
      child.stdout.emit('data', 'x'.repeat(65537));
      await expect(pending).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
      expect(child.kill).toHaveBeenCalled();
    } finally { restore(); }
  });

  it('kills the child and rejects when it does not respond within 10s', async () => {
    const restore = asWin32();
    vi.useFakeTimers();
    const child = fakeChild();
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as never);
    try {
      const pending = windowsSecretCodec().protect('value');
      const rejected = expect(pending).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(child.kill).toHaveBeenCalled();
    } finally { restore(); }
  });
});
