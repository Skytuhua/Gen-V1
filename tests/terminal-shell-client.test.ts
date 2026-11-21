import { afterEach, expect, it, vi } from 'vitest';
import { terminalShellCatalogSchema } from '../packages/contracts/terminal-shell.ts';

const catalog = {
  platform: 'win32',
  options: [
    { kind: 'default', label: 'System default (Command Prompt)', availability: 'available' },
    { kind: 'cmd', label: 'Command Prompt', availability: 'available' },
    { kind: 'pwsh', label: 'PowerShell 7', availability: 'missing', reason: 'PowerShell 7 was not found.' },
    { kind: 'powershell', label: 'Windows PowerShell', availability: 'available' },
    { kind: 'git-bash', label: 'Git Bash', availability: 'available' },
    { kind: 'wsl', label: 'WSL', availability: 'available' },
  ],
  wsl: { availability: 'available', distributions: ['Ubuntu', 'Debian'] },
};

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('fetches the catalog authenticated, no-store, and schema-validates it', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockResolvedValueOnce(Response.json(catalog));
  vi.stubGlobal('fetch', fetch);
  const { getTerminalShells } = await import('../apps/web/src/terminal-shell-api.ts');
  const value = await getTerminalShells();
  expect(value).toEqual(catalog);
  expect(fetch.mock.calls[1]).toEqual(['/api/terminal-shells', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' })]);
});

it('passes refresh=1 and the abort signal through', async () => {
  const abort = new AbortController();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockResolvedValueOnce(Response.json(catalog));
  vi.stubGlobal('fetch', fetch);
  const { getTerminalShells } = await import('../apps/web/src/terminal-shell-api.ts');
  await getTerminalShells(true, abort.signal);
  expect(fetch.mock.calls[1]).toEqual(['/api/terminal-shells?refresh=1', expect.objectContaining({ signal: abort.signal })]);
});

it('rejects a malformed catalog', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockResolvedValueOnce(Response.json({ platform: 'win32', options: 'nope', wsl: {} }));
  vi.stubGlobal('fetch', fetch);
  const { getTerminalShells } = await import('../apps/web/src/terminal-shell-api.ts');
  await expect(getTerminalShells()).rejects.toThrow();
});

it('propagates a failed response', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'csrf' })).mockRejectedValueOnce(new TypeError('Connection lost'));
  vi.stubGlobal('fetch', fetch);
  const { getTerminalShells } = await import('../apps/web/src/terminal-shell-api.ts');
  await expect(getTerminalShells()).rejects.toThrow('Connection lost');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps the catalog schema honest about option shape', () => {
  expect(terminalShellCatalogSchema.parse(catalog).options).toHaveLength(6);
  expect(terminalShellCatalogSchema.safeParse({ ...catalog, options: [...catalog.options, { kind: 'fish', label: 'fish', availability: 'available' }] }).success).toBe(false);
});
