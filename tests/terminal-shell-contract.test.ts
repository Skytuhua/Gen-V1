import { describe, expect, it } from 'vitest';
import {
  terminalShellCatalogSchema,
  terminalShellInfoSchema,
  terminalShellOptionSchema,
  terminalShellSelectionSchema,
  wslDistroSchema,
  type TerminalShellCatalog,
} from '../packages/contracts/terminal-shell.ts';

describe('terminal shell selection schema', () => {
  it.each([{ kind: 'default' }, { kind: 'cmd' }, { kind: 'pwsh' }, { kind: 'powershell' }, { kind: 'git-bash' }])(
    'accepts the non-WSL choice %j', value => {
      expect(terminalShellSelectionSchema.parse(value)).toEqual(value);
    });
  it('accepts WSL with and without a named distribution', () => {
    expect(terminalShellSelectionSchema.parse({ kind: 'wsl' })).toEqual({ kind: 'wsl' });
    expect(terminalShellSelectionSchema.parse({ kind: 'wsl', distro: 'Ubuntu-24.04' })).toEqual({ kind: 'wsl', distro: 'Ubuntu-24.04' });
    expect(terminalShellSelectionSchema.parse({ kind: 'wsl', distro: 'Ubuntu (Preview) 24.04-é' })).toEqual({ kind: 'wsl', distro: 'Ubuntu (Preview) 24.04-é' });
  });
  it.each([
    { kind: 'wsl', distro: '' }, { kind: 'wsl', distro: 'x'.repeat(201) },
    { kind: 'wsl', distro: '-rf' }, { kind: 'wsl', distro: '--distribution' },
    { kind: 'wsl', distro: 'bad\rname' }, { kind: 'wsl', distro: 'bad\nname' }, { kind: 'wsl', distro: 'bad\x00name' }, { kind: 'wsl', distro: 'bad\x7fname' },
  ])('rejects the unsafe distro %j', value => {
    expect(terminalShellSelectionSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { kind: 'bash' }, { kind: 'zsh' }, { kind: 'WSL' }, { kind: '' }, {}, { kind: 'wsl', extra: true },
    { kind: 'cmd', distro: 'Ubuntu' }, { kind: 'default', distro: 'Ubuntu' }, { kind: 'pwsh', distro: 'Ubuntu' },
    { kind: 'powershell', distro: 'Ubuntu' }, { kind: 'git-bash', distro: 'Ubuntu' }, { kind: 'cmd', args: ['/Q'] },
    'cmd', null, 42,
  ])('rejects the invalid selection %j', value => {
    expect(terminalShellSelectionSchema.safeParse(value).success).toBe(false);
  });
});

describe('terminal shell catalog and option schemas', () => {
  const option = { kind: 'pwsh', label: 'PowerShell 7', availability: 'available' };
  it('accepts options with and without a reason', () => {
    expect(terminalShellOptionSchema.parse(option)).toEqual(option);
    const missing = { ...option, availability: 'missing', reason: 'PowerShell 7 was not found in its install location or on PATH.' };
    expect(terminalShellOptionSchema.parse(missing)).toEqual(missing);
  });
  it.each([
    { kind: 'bash', label: 'Bash', availability: 'available' },
    { kind: 'cmd', label: '', availability: 'available' },
    { kind: 'cmd', label: 'cmd', availability: 'installed' },
    { ...option, reason: '' }, { ...option, file: 'C:/pwsh.exe' }, { ...option, args: ['-NoLogo'] },
  ])('rejects the invalid option %j', value => {
    expect(terminalShellOptionSchema.safeParse(value).success).toBe(false);
  });
  const catalog: TerminalShellCatalog = {
    platform: 'win32',
    options: [
      { kind: 'default', label: 'System default (Command Prompt)', availability: 'available' },
      { kind: 'cmd', label: 'Command Prompt', availability: 'available' },
      { kind: 'pwsh', label: 'PowerShell 7', availability: 'missing', reason: 'Not installed.' },
      { kind: 'powershell', label: 'Windows PowerShell', availability: 'available' },
      { kind: 'git-bash', label: 'Git Bash', availability: 'available' },
      { kind: 'wsl', label: 'WSL', availability: 'available' },
    ],
    wsl: { distributions: ['Ubuntu', 'Debian'], availability: 'available' },
  };
  it('accepts a complete Windows catalog and round-trips it', () => {
    expect(terminalShellCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(terminalShellCatalogSchema.parse(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog);
  });
  it.each([
    { ...catalog, platform: 'windows' }, { ...catalog, platform: 'macos' }, { ...catalog, options: [] },
    { ...catalog, options: Array.from({ length: 17 }, () => option) },
    { ...catalog, wsl: { distributions: [], availability: 'ready' } },
    { ...catalog, wsl: { distributions: ['-bad'], availability: 'available' } },
    { ...catalog, wsl: { distributions: Array.from({ length: 65 }, (_, i) => `d${i}`), availability: 'available' } },
    { ...catalog, extra: true },
  ])('rejects the invalid catalog %o', value => {
    expect(terminalShellCatalogSchema.safeParse(value).success).toBe(false);
  });
  it('accepts the non-Windows catalog shapes', () => {
    for (const platform of ['linux', 'darwin', 'other'] as const) {
      expect(terminalShellCatalogSchema.safeParse({
        platform,
        options: [{ kind: 'default', label: 'System shell', availability: 'available' }],
        wsl: { distributions: [], availability: 'unsupported', reason: 'WSL is only available on Windows.' },
      }).success).toBe(true);
    }
  });
});

describe('terminal shell session metadata schema', () => {
  it('accepts effective-shell info for each launch shape', () => {
    expect(terminalShellInfoSchema.parse({ kind: 'cmd', label: 'Command Prompt' })).toEqual({ kind: 'cmd', label: 'Command Prompt' });
    expect(terminalShellInfoSchema.parse({ kind: 'wsl', label: 'WSL (Ubuntu)', distro: 'Ubuntu' })).toEqual({ kind: 'wsl', label: 'WSL (Ubuntu)', distro: 'Ubuntu' });
    expect(terminalShellInfoSchema.parse({ kind: 'default', label: 'System shell', notice: 'Windows shell selection is unavailable on this host; using the system shell.' })).toEqual({ kind: 'default', label: 'System shell', notice: 'Windows shell selection is unavailable on this host; using the system shell.' });
  });
  it.each([
    { kind: 'bash', label: 'Bash' }, { kind: 'cmd', label: '' }, { kind: 'wsl', label: 'WSL', distro: '-x' },
    { kind: 'cmd', label: 'cmd', file: 'C:/Windows/System32/cmd.exe' }, { kind: 'cmd', label: 'cmd', env: { PATH: 'x' } },
  ])('rejects metadata leaking paths, environment or invalid shapes %j', value => {
    expect(terminalShellInfoSchema.safeParse(value).success).toBe(false);
  });
});

describe('WSL distribution name bounds', () => {
  it('accepts the documented maximum length and rejects one over', () => {
    expect(wslDistroSchema.safeParse('d'.repeat(200)).success).toBe(true);
    expect(wslDistroSchema.safeParse('d'.repeat(201)).success).toBe(false);
  });
});
