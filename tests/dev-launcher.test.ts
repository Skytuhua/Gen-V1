import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({spawn}));
vi.mock('../scripts/build-widgets.mjs', () => ({}));
vi.mock('../scripts/build-plugin-runtime.mjs', () => ({}));

it('reports a child launch failure and shuts down the already-started sibling', async () => {
  const children = Array.from({length: 2}, () => Object.assign(new EventEmitter(), {kill: vi.fn(() => true)}));
  children.forEach(child => spawn.mockReturnValueOnce(child));
  const originalCode = process.exitCode;
  const originalListeners = new Map((['SIGINT', 'SIGTERM'] as const).map(signal => [signal, process.listeners(signal)]));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const timer = vi.spyOn(globalThis, 'setTimeout').mockReturnValue({unref: vi.fn()} as unknown as NodeJS.Timeout);
  try {
    const script = '../scripts/dev.mjs';
    await import(script);
    const cause = Object.assign(Error('spawn node ENOENT'), {code: 'ENOENT'});
    expect(() => children[1].emit('error', cause)).not.toThrow();
    expect(children[0].kill).toHaveBeenCalledOnce();
    expect(error.mock.calls.flat()).toEqual(expect.arrayContaining([expect.stringMatching(/vite.*ENOENT/i)]));
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = originalCode;
    for (const [signal, listeners] of originalListeners) for (const listener of process.listeners(signal)) if (!listeners.includes(listener)) process.off(signal, listener);
    timer.mockRestore();
    error.mockRestore();
  }
});

it('forces an owned child that ignores the initial shutdown signal to exit', async () => {
  vi.resetModules();
  spawn.mockReset();
  const children = Array.from({length: 2}, () => Object.assign(new EventEmitter(), {kill: vi.fn(() => true)}));
  children.forEach(child => spawn.mockReturnValueOnce(child));
  const originalCode = process.exitCode;
  const originalListeners = new Map((['SIGINT', 'SIGTERM'] as const).map(signal => [signal, process.listeners(signal)]));
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const unref = vi.fn();
  const timer = vi.spyOn(globalThis, 'setTimeout').mockReturnValue({unref} as unknown as NodeJS.Timeout);
  const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
  try {
    const script = '../scripts/dev.mjs';
    await import(script);
    children[0].emit('exit', 2, null);
    children[0].emit('close', 2, null);
    expect(children[1].kill).toHaveBeenNthCalledWith(1);
    timer.mock.calls.at(-1)![0]();
    expect(children[1].kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(children[0].kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    children[1].emit('close', null, 'SIGKILL');
    expect(clear).toHaveBeenCalledWith({unref});
  } finally {
    process.exitCode = originalCode;
    for (const [signal, listeners] of originalListeners) for (const listener of process.listeners(signal)) if (!listeners.includes(listener)) process.off(signal, listener);
    vi.restoreAllMocks();
  }
});
