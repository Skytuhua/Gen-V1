import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {EventEmitter} from 'node:events';

const launch = vi.hoisted(() => vi.fn());
const launchManager = vi.hoisted(() => vi.fn());
const options = vi.hoisted(() => vi.fn(() => ({port: 4319, dataDir: 'company-profile'})));
vi.mock('../apps/server/company-mode.ts', () => ({launchCompanyHost: launch, readCompanyHostOptions: options}));
vi.mock('../apps/server/company-manager-host.ts', () => ({launchCompanyManagerHost: launchManager}));

const token = 'a'.repeat(64), origin = 'http://127.0.0.1:4319';
const eventNames = ['SIGINT', 'SIGTERM', 'disconnect', 'message'] as const;
type Listener = (...args: unknown[]) => void;
const lifecycle = process as EventEmitter;
let listeners: Map<string, Set<Listener>>;
let descriptors: Map<string, PropertyDescriptor | undefined>;
let sent: Record<string, unknown>[];
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  listeners = new Map(eventNames.map(name => [name, new Set(lifecycle.listeners(name) as Listener[])]));
  descriptors = new Map(['send', 'connected'].map(name => [name, Object.getOwnPropertyDescriptor(process, name)]));
  sent = []; close = vi.fn(async () => {});
  launch.mockReset().mockResolvedValue({origin, pid: process.pid, close}); options.mockClear();
  launchManager.mockReset().mockResolvedValue({origin, pid: process.pid, close});
  vi.stubEnv('HARNESS_DESKTOP_LAUNCH_TOKEN', token);
  Object.defineProperty(process, 'connected', {configurable: true, value: true});
  Object.defineProperty(process, 'send', {configurable: true, value: (value: Record<string, unknown>, _handle: unknown, _options: unknown, callback: () => void) => {sent.push(value); callback(); return true;}});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  for (const name of eventNames) for (const listener of lifecycle.listeners(name)) if (!listeners.get(name)!.has(listener as Listener)) lifecycle.removeListener(name, listener as Listener);
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(process, name, descriptor);
    else Reflect.deleteProperty(process, name);
  }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
});

const settle = async () => {for (let n = 0; n < 10; n++) await Promise.resolve();};
// Deliver only to this entrypoint's added listeners, not Vitest's own IPC bus.
const emit = (name: typeof eventNames[number], value?: unknown) => {
  for (const listener of lifecycle.listeners(name)) if (!listeners.get(name)!.has(listener as Listener)) listener(value);
};

it('does not attach process handlers or launch a host just by importing the shared runner', async () => {
  const {runCompanyHost} = await import('../apps/server/company-lifecycle.ts');
  expect(runCompanyHost).toBeTypeOf('function');
  for (const name of eventNames) expect(lifecycle.listeners(name)).toEqual([...listeners.get(name)!]);
  expect(launch).not.toHaveBeenCalled(); expect(launchManager).not.toHaveBeenCalled();
  expect(sent).toEqual([]); expect(process.exit).not.toHaveBeenCalled();
});

describe.each([
  {name: 'status', start: () => import('../apps/server/company-main.ts'), launch, unused: launchManager},
  {name: 'manager', start: () => import('../apps/server/company-manager-main.ts'), launch: launchManager, unused: launch},
])('$name company native host lifecycle', ({start, launch, unused}) => {
  afterEach(() => {expect(unused).not.toHaveBeenCalled();});
  it('publishes only its token-bound origin and actual PID after launch', async () => {
    await start();
    expect(launch).toHaveBeenCalledExactlyOnceWith({port: 4319, dataDir: 'company-profile'});
    expect(sent).toEqual([{type: 'harness.ready', token, origin, pid: process.pid}]);
    expect(close).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('ignores forged tokens, extra fields and unsupported personal controls', async () => {
    await start();
    for (const value of [null, [], {type: 'harness.shutdown', token: 'b'.repeat(64)}, {type: 'harness.shutdown', token: token + '0'}, {type: 'harness.shutdown', token, authority: 'owner'}, {type: 'harness.stop', token}]) emit('message', value);
    await settle(); expect(close).not.toHaveBeenCalled();
    emit('message', {type: 'harness.shutdown', token}); await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toEqual({type: 'harness.stopped', token});
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('awaits host cleanup on IPC disconnect and coalesces duplicate stop requests', async () => {
    let finish!: () => void; close.mockImplementation(() => new Promise<void>(resolve => {finish = resolve;}));
    await start(); emit('disconnect'); emit('SIGTERM'); await settle();
    expect(close).toHaveBeenCalledTimes(1); expect(process.exit).not.toHaveBeenCalled();
    finish(); await settle(); expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors a matching shutdown during startup without publishing readiness', async () => {
    let finish!: (value: unknown) => void;
    launch.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const loading = start(); await vi.waitFor(() => expect(launch).toHaveBeenCalled());
    emit('message', {type: 'harness.shutdown', token});
    finish({origin, pid: process.pid, close}); await loading; await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{type: 'harness.stopped', token}]);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('enforces the ten-second shutdown bound while launch remains pending', async () => {
    let finish!: (value: unknown) => void;
    launch.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const loading = start(); await vi.waitFor(() => expect(launch).toHaveBeenCalled());
    emit('disconnect');
    await vi.advanceTimersByTimeAsync(9999); expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(process.exit).toHaveBeenCalledWith(1);
    expect(process.stderr.write).toHaveBeenCalledWith('The company interface shutdown exceeded its deadline.\n');
    finish({origin, pid: process.pid, close}); await loading; await settle();
  });

  it('rejects malformed launch tokens before reading configuration or starting a host', async () => {
    vi.stubEnv('HARNESS_DESKTOP_LAUNCH_TOKEN', 'not-a-secret-but-invalid'); await start();
    expect(options).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
    expect(sent).toEqual([]); expect(process.exit).toHaveBeenCalledWith(1);
    expect(process.stderr.write).toHaveBeenCalledWith('The company interface could not start. Check its separate profile, port and service configuration.\n');
  });

  it('sanitizes native startup errors instead of exposing configuration or credential material', async () => {
    launch.mockRejectedValue(Error('private-token/database/path')); await start();
    expect(sent).toEqual([{type: 'harness.error', token, message: 'The company interface could not start. Check its separate profile, port and service configuration.'}]);
    expect(JSON.stringify(sent)).not.toContain('private-token');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('keeps standalone startup and signal shutdown available without native IPC', async () => {
    vi.stubEnv('HARNESS_DESKTOP_LAUNCH_TOKEN', undefined);
    Reflect.deleteProperty(process, 'send'); Reflect.deleteProperty(process, 'connected');
    await start(); expect(sent).toEqual([]);
    expect(process.stdout.write).toHaveBeenCalledWith(`Gen company interface: ${origin}/company/communications\nCompany owner interface; employee execution remains unavailable.\n`);
    emit('SIGINT'); await settle();
    expect(close).toHaveBeenCalledTimes(1); expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('reports cleanup failure with a fixed diagnostic and no stopped receipt', async () => {
    close.mockRejectedValue(Error('private-cleanup-path'));
    await start(); emit('message', {type: 'harness.shutdown', token}); await settle();
    expect(process.stderr.write).toHaveBeenCalledWith('The company interface could not close its local listener.\n');
    expect(sent.some(value => value.type === 'harness.stopped')).toBe(false);
    expect(process.exit).toHaveBeenCalledWith(1); expect(vi.getTimerCount()).toBe(0);
  });
});
