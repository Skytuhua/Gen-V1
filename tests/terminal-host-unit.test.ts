import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import type { ProjectTools } from '../packages/workspace/tools.ts';
import { spawn } from 'node-pty';
import { TerminalHost } from '../packages/workspace/terminal.ts';
import { DEFAULT_PREFERENCES } from '../packages/contracts/preferences.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0)) cleanup(); });

const spawned = vi.hoisted(() => [] as { onData: (cb: (data: string) => void) => void; onExit: (cb: (event: { exitCode: number }) => void) => void; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; emitData: (data: string) => void; emitExit: (code: number) => void }[]);

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const dataCallbacks: ((data: string) => void)[] = [], exitCallbacks: ((event: { exitCode: number }) => void)[] = [];
    const pty = {
      onData: (cb: (data: string) => void) => { dataCallbacks.push(cb); },
      onExit: (cb: (event: { exitCode: number }) => void) => { exitCallbacks.push(cb); },
      write: vi.fn(), resize: vi.fn(),
      kill: vi.fn(() => { for (const cb of exitCallbacks) cb({ exitCode: 0 }); }),
      emitData: (data: string) => { for (const cb of dataCallbacks) cb(data); },
      emitExit: (exitCode: number) => { for (const cb of exitCallbacks) cb({ exitCode }); },
    };
    spawned.push(pty);
    return pty;
  }),
}));

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'harness-terminal-')), root = mkdtempSync(join(tmpdir(), 'harness-project-'));
  const store = new Store(dataDir);
  cleanups.push(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const projects = { store, binding: vi.fn(async () => ({ project: { id: 'project-a', name: 'Project', rootPath: root, authority: { kind: 'local' as const }, createdAt: '2026-01-01T00:00:00Z' }, path: root })) };
  spawned.length = 0;
  const host = new TerminalHost(projects as unknown as ProjectTools);
  cleanups.push(() => void host.dispose().catch(() => {}));
  return { host, store, projects, root };
}

const openInput = { projectId: 'project-a', threadId: 'thread-a', environment: {} as Record<string, string> };

describe('TerminalHost recovery', () => {
  it('marks durable unfinished sessions exited with a restart reason at construction', () => {
    const { store } = fixture();
    store.internal('fixture.session', null, () => {
      store.put('terminalSession', 'dead-1', 'thread-a', { id: 'dead-1', projectId: 'project-a', threadId: 'thread-a', exited: false, exitCode: null });
      store.put('terminalSession', 'dead-2', 'thread-a', { id: 'dead-2', projectId: 'project-a', threadId: 'thread-a', exited: true, exitCode: 0 });
    });
    const host = new TerminalHost({ store, binding: async () => ({ project: {}, path: '/x' }) } as unknown as ProjectTools);
    cleanups.push(() => void host.dispose().catch(() => {}));
    const recovered = store.get<{ exited: boolean; exitCode: number | null; reason?: string }>('terminalSession', 'dead-1');
    expect(recovered).toMatchObject({ exited: true, exitCode: null, reason: 'Host restarted; the previous terminal is no longer attached.' });
    expect(store.get<{ exitCode: number | null }>('terminalSession', 'dead-2')?.exitCode).toBe(0);
  });
});

describe('TerminalHost open and identity', () => {
  it('reuses a live terminal idempotently and denies a different owner or working copy', async () => {
    const { host, projects, root } = fixture();
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    const again = await host.open({ ...openInput, terminalId: 'term-1' });
    expect(again.id).toBe(opened.id);
    expect(spawned).toHaveLength(1);
    await expect(host.open({ ...openInput, terminalId: 'term-1', projectId: 'project-b' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(host.open({ ...openInput, terminalId: 'term-1', threadId: 'thread-b' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    projects.binding.mockResolvedValue({ project: { id: 'project-a' } as never, path: root + '-moved' });
    await expect(host.open({ ...openInput, terminalId: 'term-1' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
  it('rejects a reused id whose durable record already ended and validates identifiers', async () => {
    const { host, store } = fixture();
    store.internal('fixture.session', null, () => store.put('terminalSession', 'ended-1', 'thread-a', { id: 'ended-1', projectId: 'project-a', threadId: 'thread-a', exited: true, exitCode: 0 }));
    await expect(host.open({ ...openInput, terminalId: 'ended-1' })).rejects.toMatchObject({ code: 'TERMINAL_ENDED' });
    await expect(host.open({ ...openInput, projectId: 'bad id!', terminalId: 'term-bad' })).rejects.toThrow();
  });
  it('refuses a thirteenth live terminal while ended sessions free capacity', async () => {
    const { host } = fixture();
    for (let index = 0; index < 12; index++) await host.open({ ...openInput, terminalId: 'term-' + index });
    await expect(host.open({ ...openInput, terminalId: 'term-12' })).rejects.toMatchObject({ code: 'TERMINAL_CAPACITY' });
    spawned[0].emitExit(0);
    await expect(host.open({ ...openInput, terminalId: 'term-12' })).resolves.toMatchObject({ id: 'term-12' });
  });
});

describe('TerminalHost commands', () => {
  it('delivers input and resize to the live process and rejects unknown actions', async () => {
    const { host } = fixture();
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    const pty = spawned[0];
    await host.command(opened.id, 'project-a', 'thread-a', { type: 'input', data: 'ls\n' });
    expect(pty.write).toHaveBeenCalledWith('ls\n');
    await host.command(opened.id, 'project-a', 'thread-a', { type: 'resize', cols: 120, rows: 40 });
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    await expect(host.command(opened.id, 'project-a', 'thread-a', { type: 'mystery' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(host.command(opened.id, 'project-a', 'thread-a', { type: 'input', data: 'x'.repeat(64 * 1024 + 1) })).rejects.toThrow();
    await expect(host.command(opened.id, 'project-a', 'thread-a', { type: 'resize', cols: 1, rows: 40 })).rejects.toThrow();
  });
  it('reports TERMINAL_ENDED for writes to an exited session and keeps stop idempotent', async () => {
    const { host, store } = fixture();
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    spawned[0].emitExit(3);
    await expect(host.command(opened.id, 'project-a', 'thread-a', { type: 'input', data: 'x' })).rejects.toMatchObject({ code: 'TERMINAL_ENDED' });
    const stopped = await host.command(opened.id, 'project-a', 'thread-a', { type: 'stop' });
    expect(stopped).toMatchObject({ exited: true, exitCode: 3 });
    expect(spawned[0].kill).not.toHaveBeenCalled();
    expect(store.get<{ exited: boolean; exitCode: number | null }>('terminalSession', 'term-1')).toMatchObject({ exited: true, exitCode: 3 });
  });
});

describe('TerminalHost reads and lookup', () => {
  it('serves transcript reads by owner and maps ended durable ids to TERMINAL_ENDED', async () => {
    const { host, store } = fixture();
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    spawned[0].emitData('prompt> ');
    await expect(host.read('term-1', 'project-b', 'thread-a')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(host.read('term-1', 'project-a', 'thread-b')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    expect(await host.read(opened.id, 'project-a', 'thread-a')).toMatchObject({ output: 'prompt> ', exited: false });
    store.internal('fixture.session', null, () => store.put('terminalSession', 'ended-9', 'thread-a', { id: 'ended-9', projectId: 'project-a', threadId: 'thread-a', exited: true, exitCode: 0 }));
    await expect(host.read('ended-9', 'project-a', 'thread-a')).rejects.toMatchObject({ code: 'TERMINAL_ENDED' });
    await expect(host.read('ended-9', 'project-a', 'thread-b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(host.read('never-existed', 'project-a', 'thread-a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('TerminalHost shell selection', () => {
  const legacyShell = process.platform === 'win32' ? (process.env.COMSPEC ?? 'C:/Windows/System32/cmd.exe') : (process.env.SHELL ?? '/bin/sh');
  it('returns shell metadata on an interactive open and persists it with the record', async () => {
    const { host, store } = fixture();
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    expect(opened.shell).toMatchObject({ kind: 'default', label: process.platform === 'win32' ? 'System default (Command Prompt)' : 'System shell' });
    expect(vi.mocked(spawn).mock.calls.at(-1)![0]).toBe(legacyShell);
    expect(store.get<{ shell?: { kind: string } }>('terminalSession', 'term-1')?.shell).toMatchObject({ kind: 'default' });
    spawned[0].emitData('ok');
    expect((await host.read('term-1', 'project-a', 'thread-a')).shell).toMatchObject({ kind: 'default' });
  });
  it.skipIf(process.platform === 'win32')('keeps the stored Windows selection on Linux with a notice and the system shell', async () => {
    const { host, store } = fixture();
    store.internal('fixture.settings', null, () => store.put('settings', 'global', null, { preferences: { ...DEFAULT_PREFERENCES, terminalShell: { kind: 'pwsh' } } }));
    const opened = await host.open({ ...openInput, terminalId: 'term-1' });
    expect(vi.mocked(spawn).mock.calls.at(-1)![0]).toBe(legacyShell);
    expect(opened.shell).toMatchObject({ kind: 'pwsh', notice: 'Windows shell selection is unavailable on this host; using the system shell.' });
  });
  it('does not reroute command or program opens through the resolver', async () => {
    const { host, store } = fixture();
    store.internal('fixture.settings', null, () => store.put('settings', 'global', null, { preferences: { ...DEFAULT_PREFERENCES, terminalShell: { kind: 'wsl', distro: 'Ubuntu' } } }));
    const scripted = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-run', command: 'echo hi' });
    expect(scripted.shell).toBeUndefined();
    expect(vi.mocked(spawn).mock.calls.at(-1)![0]).toBe(legacyShell);
    const program = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-prog', program: '/bin/echo', args: ['x'], environment: {} });
    expect(program.shell).toBeUndefined();
    expect(vi.mocked(spawn).mock.calls.at(-1)![0]).toBe('/bin/echo');
  });
  it('maps a missing executable to TERMINAL_SHELL_UNAVAILABLE and writes no record', async () => {
    const { host, store } = fixture();
    // Pin COMSPEC to the system path so the default selection has no ENOENT retry on Windows.
    vi.stubEnv('COMSPEC', `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`);
    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn /missing ENOENT'); });
    await expect(host.open({ ...openInput, terminalId: 'term-1' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    expect(store.get('terminalSession', 'term-1')).toBeNull();
    expect(spawned).toHaveLength(0);
  });
  it('maps other start failures to TERMINAL_START_FAILED without a retry', async () => {
    const { host } = fixture();
    vi.mocked(spawn).mockClear();
    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn EACCES permission denied'); });
    await expect(host.open({ ...openInput, terminalId: 'term-1' })).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED' });
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });
});

describe('TerminalHost dispose', () => {
  it('stops live sessions and persists their exit', async () => {
    const { host, store } = fixture();
    await host.open({ ...openInput, terminalId: 'term-1' });
    await host.open({ ...openInput, terminalId: 'term-2' });
    await host.dispose();
    expect(spawned[0].kill).toHaveBeenCalled();
    expect(spawned[1].kill).toHaveBeenCalled();
    expect(store.get<{ exited: boolean }>('terminalSession', 'term-1')?.exited).toBe(true);
    expect(store.get<{ exited: boolean }>('terminalSession', 'term-2')?.exited).toBe(true);
  });
});
