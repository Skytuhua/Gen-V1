import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_ROWS, SETTINGS_SECTIONS } from '../apps/web/src/Settings';
import { buildSupportedSettings, searchSettings } from '../apps/web/src/settings-registry';
import { catalogOptions, decodeSelection, encodeSelection, selectionLabel, TerminalShellSettings } from '../apps/web/src/TerminalShellSettings';
import type { TerminalShellCatalog } from '../packages/contracts/terminal-shell';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const WINDOWS_CATALOG: TerminalShellCatalog = {
  platform: 'win32',
  options: [
    { kind: 'default', label: 'System default (Command Prompt)', availability: 'available' },
    { kind: 'cmd', label: 'Command Prompt', availability: 'available' },
    { kind: 'pwsh', label: 'PowerShell 7', availability: 'missing', reason: 'pwsh.exe was not found in its install location or on PATH.' },
    { kind: 'powershell', label: 'Windows PowerShell', availability: 'available' },
    { kind: 'git-bash', label: 'Git Bash', availability: 'missing', reason: 'Git Bash (bash.exe inside a Git for Windows install) was not found.' },
    { kind: 'wsl', label: 'WSL', availability: 'available' },
  ],
  wsl: { distributions: ['Ubuntu', 'Debian'], availability: 'available' },
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function client(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(implementation));
  return import('../apps/web/src/terminal-shell-api.ts');
}

describe('terminal shell catalog client', () => {
  it('fetches and validates the catalog through the authenticated bootstrap', async () => {
    const api = await client(async input => {
      const url = String(input);
      if (url === '/api/bootstrap') return json({ csrfToken: 'synthetic-csrf' });
      if (url === '/api/terminal-shells') return json(WINDOWS_CATALOG);
      throw new Error(`Unexpected request ${url}`);
    });
    expect(await api.getTerminalShellCatalog()).toEqual(WINDOWS_CATALOG);
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls).toEqual(['/api/bootstrap', '/api/terminal-shells']);
  });
  it('requests a fresh catalog with refresh=1 and forwards the abort signal', async () => {
    const api = await client(async input => String(input) === '/api/bootstrap' ? json({ csrfToken: 'x' }) : json(WINDOWS_CATALOG));
    const controller = new AbortController();
    await api.getTerminalShellCatalog(true, controller.signal);
    const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(String(url)).toBe('/api/terminal-shells?refresh=1');
    expect(init?.signal).toBe(controller.signal);
    expect(init?.cache).toBe('no-store');
  });
  it('rejects a structurally invalid catalog instead of trusting the host', async () => {
    const api = await client(async input => String(input) === '/api/bootstrap' ? json({ csrfToken: 'x' }) : json({ platform: 'win32', options: [{ kind: 'pwsh' }], wsl: {} }));
    await expect(api.getTerminalShellCatalog()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('surfaces the host error code and message for failed discovery', async () => {
    const api = await client(async input => String(input) === '/api/bootstrap' ? json({ csrfToken: 'x' }) : json({ error: { code: 'TERMINAL_SHELL_DISCOVERY_FAILED', message: 'WSL distributions could not be listed. Retry.' } }, 400));
    await expect(api.getTerminalShellCatalog()).rejects.toMatchObject({ code: 'TERMINAL_SHELL_DISCOVERY_FAILED', message: expect.stringContaining('Retry') });
  });
});

describe('terminal shell settings row registration', () => {
  const rows = buildSupportedSettings(SETTINGS_ROWS, SETTINGS_SECTIONS);
  it('registers a searchable General-adjacent projects row matching every shell alias', () => {
    const row = SETTINGS_ROWS.find(item => item.id === 'terminal-shell');
    expect(row).toMatchObject({ title: 'Default terminal shell', section: 'projects' });
    for (const query of ['terminal shell', 'powershell', 'pwsh', 'cmd', 'command prompt', 'git bash', 'wsl', 'distribution']) {
      expect(searchSettings(query, rows, 'browser').map(item => item.id), query).toContain('terminal-shell');
    }
  });
});

describe('selection encoding and catalog options', () => {
  it('round-trips every selection shape, including distributions needing literal names', () => {
    for (const selection of [{ kind: 'default' }, { kind: 'cmd' }, { kind: 'pwsh' }, { kind: 'powershell' }, { kind: 'git-bash' }, { kind: 'wsl' }, { kind: 'wsl', distro: 'Ubuntu-24.04' }, { kind: 'wsl', distro: 'Mon Linux & Dev: édition' }] as const) {
      expect(decodeSelection(encodeSelection(selection))).toEqual(selection);
    }
  });
  it('rejects values that are not selections the host could have produced', () => {
    for (const value of ['bash', 'wsl:', 'evil', '', 'WSL', 'wsl ', 'zsh']) expect(decodeSelection(value), value).toBeNull();
  });
  it('expands WSL into a default and per-distribution rows and disables unavailable shells with reasons', () => {
    const options = catalogOptions(WINDOWS_CATALOG, { kind: 'default' });
    expect(options.map(option => option.value)).toEqual(['default', 'cmd', 'pwsh', 'powershell', 'git-bash', 'wsl', 'wsl:Ubuntu', 'wsl:Debian']);
    expect(options.find(option => option.value === 'wsl')?.label).toBe('WSL · Default distribution');
    expect(options.find(option => option.value === 'wsl:Ubuntu')?.label).toBe('WSL · Ubuntu');
    const pwsh = options.find(option => option.value === 'pwsh');
    expect(pwsh?.disabled).toBe(true);
    expect(pwsh?.label).toContain('PowerShell 7');
    expect(pwsh?.label).toContain('not installed');
  });
  it('keeps a vanished saved distribution visible but unpickable', () => {
    const options = catalogOptions(WINDOWS_CATALOG, { kind: 'wsl', distro: 'Gone Linux' });
    const kept = options.find(option => option.value === 'wsl:Gone Linux');
    expect(kept).toMatchObject({ disabled: true });
    expect(kept?.label).toContain('WSL · Gone Linux');
    expect(kept?.label).toContain('no longer available');
  });
  it('marks the whole WSL choice unavailable when no distributions exist', () => {
    const catalog: TerminalShellCatalog = { ...WINDOWS_CATALOG, wsl: { distributions: [], availability: 'missing', reason: 'No WSL distributions are installed.' } };
    const options = catalogOptions(catalog, { kind: 'default' });
    const wsl = options.find(option => option.value === 'wsl');
    expect(wsl?.disabled).toBe(true);
    expect(wsl?.label).toContain('No WSL distributions are installed.');
    expect(options.some(option => option.value.startsWith('wsl:'))).toBe(false);
  });
  it('labels selections the way the toolbar and settings list describe them', () => {
    expect(selectionLabel({ kind: 'pwsh' })).toBe('PowerShell 7');
    expect(selectionLabel({ kind: 'wsl' })).toBe('WSL · Default distribution');
    expect(selectionLabel({ kind: 'wsl', distro: 'Ubuntu' })).toBe('WSL · Ubuntu');
  });
});

describe('terminal shell settings states', () => {
  it('renders the labelled row in its checking state before the catalog arrives', () => {
    const html = renderToStaticMarkup(createElement(TerminalShellSettings, { saved: { kind: 'default' }, busy: false, save: async () => true }));
    expect(html).toContain('Default terminal shell');
    expect(html).toContain('Applies to new project terminals. Running terminals are unchanged.');
    expect(html).toContain('Checking available shells');
  });
});
