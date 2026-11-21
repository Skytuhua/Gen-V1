import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import type { ProjectTools } from '../packages/workspace/tools.ts';
import { TerminalHost } from '../packages/workspace/terminal.ts';
import type { TerminalShellDeps } from '../packages/workspace/terminal-shell.ts';
import { spawn } from 'node-pty';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

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

const WIN_CMD = 'C:\\Windows\\System32\\cmd.exe';
function shellFixture(files: string[], env: Record<string, string> = {}, deps: Partial<TerminalShellDeps> = {}, bindingPath?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'harness-terminal-')), root = mkdtempSync(join(tmpdir(), 'harness-project-'));
  const store = new Store(dataDir);
  cleanups.push(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const path = bindingPath ?? root;
  const projects = { store, binding: vi.fn(async () => ({ project: { id: 'project-a', name: 'Project', rootPath: path, authority: { kind: 'local' as const }, createdAt: '2026-01-01T00:00:00Z' }, path })) };
  spawned.length = 0;
  vi.mocked(spawn).mockClear();
  const host = new TerminalHost(projects as unknown as ProjectTools, {
    platform: 'win32', env: { SystemRoot: 'C:\\Windows', ...env }, exists: path => files.includes(path),
    run: async () => ({ code: 0, stdout: new Uint8Array(), timedOut: false }), spawnEnv: () => ({ PATH: 'SANITIZED' }), ...deps,
  });
  cleanups.push(() => void host.dispose().catch(() => {}));
  const prefer = (terminalShell: unknown) => store.internal('fixture.settings', null, () => store.put('settings', 'global', null, { theme: 'dark', preferences: { terminalShell } }));
  return { host, store, projects, root, prefer };
}
const spawnCalls = () => vi.mocked(spawn).mock.calls;

describe('TerminalHost shell selection', () => {
  it('resolves the saved shell for a new interactive open and records effective metadata', async () => {
    const { host, store, prefer } = shellFixture([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']);
    prefer({ kind: 'pwsh' });
    const opened = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-shell' });
    expect(opened.shell).toEqual({ kind: 'pwsh', label: 'PowerShell 7' });
    expect(spawnCalls()[0]?.[0]).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(spawnCalls()[0]?.[1]).toEqual(['-NoLogo']);
    expect((spawnCalls()[0]?.[2] as { env: Record<string, string> }).env).toEqual({ PATH: 'SANITIZED' });
    expect(store.get<{ shell: unknown }>('terminalSession', 'term-shell')?.shell).toEqual({ kind: 'pwsh', label: 'PowerShell 7' });
    expect((await host.read('term-shell', 'project-a', 'thread-a')).shell).toEqual({ kind: 'pwsh', label: 'PowerShell 7' });
  });
  it('keeps a live terminal on its captured shell after the preference changes', async () => {
    const { host, prefer } = shellFixture([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Program Files\\Git\\bin\\bash.exe']);
    prefer({ kind: 'pwsh' });
    await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-a' });
    prefer({ kind: 'git-bash' });
    const again = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-a' });
    expect(again.shell).toEqual({ kind: 'pwsh', label: 'PowerShell 7' });
    expect(spawned).toHaveLength(1);
    const fresh = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-b' });
    expect(fresh.shell).toEqual({ kind: 'git-bash', label: 'Git Bash' });
    expect(spawnCalls()[1]?.[0]).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect((spawnCalls()[1]?.[2] as { env: Record<string, string> }).env.CHERE_INVOKING).toBe('1');
  });
  it('fails closed on a vanished explicit shell and leaves no session record', async () => {
    const { host, store, prefer } = shellFixture([WIN_CMD]);
    prefer({ kind: 'pwsh' });
    await expect(host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-gone' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE', message: expect.stringContaining('PowerShell 7') });
    expect(store.get('terminalSession', 'term-gone')).toBeNull();
    expect(spawned).toHaveLength(0);
    // The same caller ID retries cleanly after the selection is corrected.
    prefer({ kind: 'cmd' });
    await expect(host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-gone' })).resolves.toMatchObject({ id: 'term-gone', shell: { kind: 'cmd' } });
    expect(spawned).toHaveLength(1);
  });
  it('retries a default COMSPEC spawn once on ENOENT but never other shells or other errors', async () => {
    const { host, prefer } = shellFixture([WIN_CMD, 'D:\\tools\\cmd.exe'], { COMSPEC: 'D:\\tools\\cmd.exe' });
    prefer({ kind: 'default' });
    vi.mocked(spawn).mockImplementationOnce(() => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); });
    const opened = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-fallback' });
    expect(spawnCalls()).toHaveLength(2);
    expect(spawnCalls()[1]?.[0]).toBe(WIN_CMD);
    expect(opened.shell).toEqual({ kind: 'cmd', label: 'System default (Command Prompt)' });
    void host;
    // Explicit pwsh gets no retry and no silent switch to another family.
    const pwshHost = shellFixture([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']);
    pwshHost.prefer({ kind: 'pwsh' });
    vi.mocked(spawn).mockImplementationOnce(() => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); });
    await expect(pwshHost.host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-e' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    // Access-denied style failures map to START_FAILED, never to a retry.
    const denied = shellFixture([WIN_CMD]);
    denied.prefer({ kind: 'cmd' });
    vi.mocked(spawn).mockImplementationOnce(() => { throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }); });
    await expect(denied.host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-f' })).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED' });
  });
  it('keeps program, command and environment-pinned opens on the legacy lane', async () => {
    const { host, prefer } = shellFixture([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']);
    prefer({ kind: 'pwsh' });
    await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-prog', program: 'D:\\pinned\\tool.exe', args: ['-x'], environment: { PINNED: '1' } });
    expect(spawnCalls()[0]?.[0]).toBe('D:\\pinned\\tool.exe');
    expect(spawnCalls()[0]?.[1]).toEqual(['-x']);
    expect((spawnCalls()[0]?.[2] as { env: Record<string, string> }).env).toEqual({ PINNED: '1' });
    const seeded = await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-script', command: 'echo hi' });
    expect(seeded.shell).toBeUndefined();
    expect(spawnCalls()[1]?.[0]).toBe(process.platform === 'win32' ? (process.env.COMSPEC ?? 'C:/Windows/System32/cmd.exe') : (process.env.SHELL ?? '/bin/sh'));
    expect(spawnCalls()[1]?.[1]).toEqual(process.platform === 'win32' ? ['/D', '/Q'] : []);
    expect(spawned[1].write).toHaveBeenCalledWith('echo hi\r');
    // A pinned environment without program also keeps the legacy lane untouched.
    await host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-env', environment: { PINNED: '2' } });
    expect((spawnCalls()[2]?.[2] as { env: Record<string, string> }).env).toEqual({ PINNED: '2' });
  });
  it('serializes concurrent opens of one ID behind descriptor work into a single PTY', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { host, prefer } = shellFixture([WIN_CMD, 'C:\\Windows\\System32\\wsl.exe'], {}, {
      run: async (_file, args) => {
        await gate;
        return args.includes('--exec') ? { code: 0, stdout: Buffer.from('/mnt/c/p\n'), timedOut: false } : { code: 0, stdout: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ubuntu\r\n', 'utf16le')]), timedOut: false };
      },
    }, 'C:\\work\\demo');
    prefer({ kind: 'wsl' });
    const first = host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-race' });
    const second = host.open({ projectId: 'project-a', threadId: 'thread-a', terminalId: 'term-race' });
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one.id).toBe(two.id);
    expect(spawned).toHaveLength(1);
    expect(one.shell).toEqual({ kind: 'wsl', label: 'WSL' });
  });
  it('serves the shell catalog through the host', async () => {
    const { host } = shellFixture([WIN_CMD]);
    const catalog = await host.shellCatalog();
    expect(catalog.platform).toBe('win32');
    expect(catalog.options).toHaveLength(6);
    expect(catalog.options.find(option => option.kind === 'wsl')?.availability).toBe('missing');
  });
});
