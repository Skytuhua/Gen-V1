import { describe, expect, it } from 'vitest';
import { terminalShellCatalogSchema, terminalShellInfoSchema, terminalShellOptionSchema, terminalShellSelectionSchema } from '../packages/contracts/terminal-shell.ts';
import { DEFAULT_PREFERENCES, preferencesSchema } from '../packages/contracts/preferences.ts';

describe('terminalShellSelectionSchema', () => {
  it('accepts every native kind without a distro', () => {
    for (const kind of ['default', 'cmd', 'pwsh', 'powershell', 'git-bash'] as const) {
      expect(terminalShellSelectionSchema.parse({ kind }), `kind ${kind}`).toEqual({ kind });
    }
  });

  it('accepts wsl with and without a distro', () => {
    expect(terminalShellSelectionSchema.parse({ kind: 'wsl' })).toEqual({ kind: 'wsl' });
    expect(terminalShellSelectionSchema.parse({ kind: 'wsl', distro: 'Ubuntu-24.04' })).toEqual({ kind: 'wsl', distro: 'Ubuntu-24.04' });
  });

  it('rejects distro on non-wsl kinds and unknown kinds', () => {
    expect(terminalShellSelectionSchema.safeParse({ kind: 'cmd', distro: 'Ubuntu' }).success).toBe(false);
    expect(terminalShellSelectionSchema.safeParse({ kind: 'default', distro: 'Ubuntu' }).success).toBe(false);
    expect(terminalShellSelectionSchema.safeParse({ kind: 'fish' }).success).toBe(false);
    expect(terminalShellSelectionSchema.safeParse({ kind: 'wsl', extra: 1 }).success).toBe(false);
  });

  it('rejects invalid distro names', () => {
    for (const distro of ['', '-Ubuntu', 'a'.repeat(201), 'bad\r\nname', 'bad\tname', 'badname']) {
      expect(terminalShellSelectionSchema.safeParse({ kind: 'wsl', distro }).success, JSON.stringify(distro)).toBe(false);
    }
    expect(terminalShellSelectionSchema.safeParse({ kind: 'wsl', distro: '  padded  ' }).success).toBe(true);
  });
});

describe('terminalShellCatalogSchema', () => {
  const option = (overrides = {}) => terminalShellOptionSchema.parse({ kind: 'pwsh', label: 'PowerShell 7', availability: 'available', ...overrides });

  it('accepts a well-formed Windows catalog', () => {
    const catalog = terminalShellCatalogSchema.parse({
      platform: 'win32',
      options: [
        { kind: 'default', label: 'System default (Command Prompt)', availability: 'available' },
        { kind: 'pwsh', label: 'PowerShell 7', availability: 'missing', reason: 'PowerShell 7 was not found.' },
        option({ kind: 'git-bash', label: 'Git Bash' }),
        { kind: 'wsl', label: 'WSL', availability: 'available' },
      ],
      wsl: { availability: 'available', distributions: ['Ubuntu', 'Debian'] },
    });
    expect(catalog.wsl.distributions).toEqual(['Ubuntu', 'Debian']);
    expect(catalog.options).toHaveLength(4);
  });

  it('accepts a minimal non-Windows catalog', () => {
    const catalog = terminalShellCatalogSchema.parse({
      platform: 'linux',
      options: [{ kind: 'default', label: 'System shell', availability: 'available' }],
      wsl: { availability: 'unsupported', distributions: [], reason: 'WSL is only available on Windows.' },
    });
    expect(catalog.platform).toBe('linux');
  });

  it('rejects bad availability values and extra keys', () => {
    expect(terminalShellOptionSchema.safeParse({ kind: 'cmd', label: 'cmd', availability: 'ready' }).success).toBe(false);
    expect(terminalShellOptionSchema.safeParse({ kind: 'cmd', label: 'cmd', availability: 'available', path: 'x' }).success).toBe(false);
    expect(terminalShellCatalogSchema.safeParse({ platform: 'win32', options: [], wsl: { availability: 'available', distributions: [] }, extra: true }).success).toBe(false);
  });
});

describe('terminalShellInfoSchema', () => {
  it('round-trips info with distro and notice', () => {
    const info = terminalShellInfoSchema.parse({ kind: 'wsl', label: 'WSL: Ubuntu', distro: 'Ubuntu', notice: 'Using Ubuntu.' });
    expect(info.distro).toBe('Ubuntu');
  });
});

describe('preferences terminalShell', () => {
  it('defaults to the system shell', () => {
    expect(DEFAULT_PREFERENCES.terminalShell).toEqual({ kind: 'default' });
    expect(preferencesSchema.parse(DEFAULT_PREFERENCES).terminalShell).toEqual({ kind: 'default' });
  });

  it('persists a whole selection atomically', () => {
    const value = preferencesSchema.parse({ ...DEFAULT_PREFERENCES, terminalShell: { kind: 'wsl', distro: 'Debian' } });
    expect(value.terminalShell).toEqual({ kind: 'wsl', distro: 'Debian' });
  });

  it('rejects a corrupt selection', () => {
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, terminalShell: { kind: 'fish' } }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, terminalShell: { kind: 'wsl', distro: { nested: true } } }).success).toBe(false);
  });
});
