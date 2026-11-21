import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from '../packages/storage/store.ts';
import { HarnessError } from '../packages/contracts/index.ts';
import type { Service } from '../packages/core/service.ts';
import type { ProjectTools } from '../packages/workspace/tools.ts';
import { TerminalHost } from '../packages/workspace/terminal.ts';
import type { TerminalShellDeps } from '../packages/workspace/terminal-shell.ts';
import { registerWorkspaceHost } from '../apps/server/workspace-host.ts';
import { registerWorkspaceRoutes } from '../apps/server/workspace-routes.ts';

const spawned = vi.hoisted(() => [] as { args: unknown[] }[]);
vi.mock('node-pty', () => ({
  spawn: vi.fn((...args: unknown[]) => {
    const pty = { onData: () => {}, onExit: () => {}, write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
    spawned.push({ args });
    return pty;
  }),
}));

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const clean of cleanups.splice(0)) clean(); });

const WIN_CMD = 'C:\\Windows\\System32\\cmd.exe';
function windowsDeps(files: string[], env: Record<string, string> = {}): TerminalShellDeps {
  return {
    platform: 'win32', env: { SystemRoot: 'C:\\Windows', ...env }, exists: path => files.includes(path),
    run: async () => ({ code: 0, stdout: new Uint8Array(), timedOut: false }), spawnEnv: () => ({ PATH: 'SANITIZED' }),
  };
}
async function server(deps: TerminalShellDeps, preferences?: unknown) {
  const dataDir = mkdtempSync(join(tmpdir(), 'harness-shell-route-')), root = mkdtempSync(join(tmpdir(), 'harness-shell-project-'));
  const store = new Store(dataDir);
  if (preferences !== undefined) store.internal('fixture.settings', null, () => store.put('settings', 'global', null, { theme: 'dark', preferences }));
  const projects = { store, binding: vi.fn(async () => ({ project: { id: 'project-a' }, path: root })), workspace: { migrateProjects() {} }, dispose: async () => {} };
  const terminals = new TerminalHost(projects as unknown as ProjectTools, deps);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof HarnessError, malformed = error instanceof z.ZodError;
    const code = known ? error.code : malformed ? 'INVALID_INPUT' : 'HOST_ERROR';
    const status = code === 'NOT_FOUND' ? 404 : ['CAPABILITY_DENIED', 'AUTH_REQUIRED'].includes(code) ? 403 : known || malformed ? 400 : 500;
    reply.code(status).send({ error: { code, message: known ? error.message : 'The host could not complete this request' } });
  });
  const service = { store } as Service;
  registerWorkspaceHost(service, { projects: projects as unknown as ProjectTools, terminals });
  registerWorkspaceRoutes(app, service);
  cleanups.push(() => { void terminals.dispose().catch(() => {}); store.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); void app.close(); });
  spawned.length = 0;
  return { app, store, root };
}

describe('terminal shell catalog route', () => {
  it('serves a bounded catalog with no-store caching and no executable paths', async () => {
    const { app } = await server(windowsDeps([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']));
    const response = await app.inject({ method: 'GET', url: '/api/terminal-shells' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const catalog = response.json();
    expect(catalog.platform).toBe('win32');
    expect(catalog.options.map((option: { kind: string }) => option.kind)).toEqual(['default', 'cmd', 'pwsh', 'powershell', 'git-bash', 'wsl']);
    expect(catalog.options.find((option: { kind: string }) => option.kind === 'pwsh')?.availability).toBe('available');
    expect(catalog.options.find((option: { kind: string }) => option.kind === 'wsl')?.availability).toBe('missing');
    expect(JSON.stringify(catalog)).not.toMatch(/[A-Za-z]:[\\/]|SANITIZED/);
  });
  it('accepts refresh=1 and rejects every other query shape', async () => {
    const { app } = await server(windowsDeps([WIN_CMD]));
    expect((await app.inject({ method: 'GET', url: '/api/terminal-shells?refresh=1' })).statusCode).toBe(200);
    for (const url of ['/api/terminal-shells?refresh=2', '/api/terminal-shells?refresh', '/api/terminal-shells?distro=Ubuntu', '/api/terminal-shells?refresh=1&other=1']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_INPUT');
    }
  });
  it('serves a non-Windows catalog without running Windows probes', async () => {
    const { app } = await server({ platform: 'linux', env: {}, exists: () => false, run: async () => { throw new Error('no Windows probes'); }, spawnEnv: () => ({}) });
    const catalog = (await app.inject({ method: 'GET', url: '/api/terminal-shells' })).json();
    expect(catalog.platform).toBe('linux');
    expect(catalog.options.filter((option: { availability: string }) => option.availability === 'available')).toEqual([{ kind: 'default', label: 'System shell', availability: 'available' }]);
  });
});

describe('terminal open route shell behavior', () => {
  it('reports a structured error, not a 500, when the saved shell is gone', async () => {
    const { app } = await server(windowsDeps([WIN_CMD]), { terminalShell: { kind: 'pwsh' } });
    const response = await app.inject({ method: 'POST', url: '/api/terminals', payload: { projectId: 'project-a', terminalId: 'term-shell-1' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TERMINAL_SHELL_UNAVAILABLE');
    expect(response.json().error.message).toContain('PowerShell 7');
    expect(response.json().error.message).toContain('Settings');
  });
  it('launches the resolved shell and returns effective metadata', async () => {
    const { app } = await server(windowsDeps([WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']), { terminalShell: { kind: 'pwsh' } });
    const response = await app.inject({ method: 'POST', url: '/api/terminals', payload: { projectId: 'project-a', terminalId: 'term-shell-2' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().shell).toEqual({ kind: 'pwsh', label: 'PowerShell 7' });
    expect(spawned[0]?.args[0]).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(spawned[0]?.args[1]).toEqual(['-NoLogo']);
    expect(JSON.stringify(response.json())).not.toContain('SANITIZED');
  });
});
