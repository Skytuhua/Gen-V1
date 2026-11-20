import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import type { ProjectTools } from '../packages/workspace/tools.ts';
import { TerminalHost } from '../packages/workspace/terminal.ts';

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
  return { host, store, root };
}

const openInput = { projectId: 'project-a', threadId: 'thread-a', environment: {} as Record<string, string> };

describe('TerminalHost reopen after exit', () => {
  it('rejects reopening a live-session id whose process already exited', async () => {
    const { host, root } = fixture();
    await host.open({ ...openInput, terminalId: 'term-1' });
    spawned[0].emitExit(7);
    // The dead session still sits in the host's session map (eviction keeps up to 48).
    await expect(host.open({ ...openInput, terminalId: 'term-1' })).rejects.toMatchObject({ code: 'TERMINAL_ENDED' });
    // A different terminal id still opens normally.
    await expect(host.open({ ...openInput, terminalId: 'term-2' })).resolves.toMatchObject({ id: 'term-2', exited: false });
    expect(root).toBeTruthy();
  });
});
