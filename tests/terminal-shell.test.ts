import { describe, expect, it, vi } from 'vitest';
import { TerminalShellResolver, type TerminalShellHostEnv, type TerminalShellProbeResult } from '../packages/workspace/terminal-shell.ts';
import { HarnessError } from '../packages/contracts/index.ts';

const WIN_ENV: NodeJS.ProcessEnv = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
  PATH: 'C:\\Windows\\System32;C:\\Tools\\bin',
};

interface FakeHost extends TerminalShellHostEnv { probes: { file: string; args: string[] }[]; time: number }

function host(overrides: { platform?: string; env?: NodeJS.ProcessEnv; files?: string[]; probe?: (file: string, args: string[]) => TerminalShellProbeResult | Promise<TerminalShellProbeResult>; bundled?: string }): FakeHost {
  const files = new Set(overrides.files ?? []);
  const fake: FakeHost = {
    platform: overrides.platform ?? 'win32',
    env: overrides.env ?? { ...WIN_ENV },
    time: 1_000_000,
    probes: [],
    isExecutableFile: async path => files.has(path),
    bundledGit: () => overrides.bundled,
    runProbe: (file, args) => { fake.probes.push({ file, args }); return Promise.resolve(overrides.probe ? overrides.probe(file, args) : { status: 'failed', exitCode: 1 } as TerminalShellProbeResult); },
    now: () => fake.time,
  };
  return fake;
}

const BASE_WINDOWS_FILES = ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\wsl.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'];
const utf16 = (text: string) => Buffer.from('﻿' + text, 'utf16le');

describe('catalog on Windows', () => {
  it('reports every shell and prefers COMSPEC for default', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, COMSPEC: 'D:\\Tools\\cmd.exe' }, files: [...BASE_WINDOWS_FILES, 'D:\\Tools\\cmd.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'], probe: () => ({ status: 'ok', stdout: utf16('Ubuntu\r\nDebian\r\n'), truncated: false }) }));
    const catalog = await resolver.catalog();
    expect(catalog.platform).toBe('win32');
    expect(catalog.options.map(option => [option.kind, option.availability])).toEqual([['default', 'available'], ['cmd', 'available'], ['pwsh', 'available'], ['powershell', 'available'], ['git-bash', 'available'], ['wsl', 'available']]);
    expect(catalog.wsl.distributions).toEqual(['Ubuntu', 'Debian']);
  });

  it('marks missing optional shells and reports probe failure as error', async () => {
    const resolver = new TerminalShellResolver(host({ files: [...BASE_WINDOWS_FILES], probe: () => ({ status: 'failed', exitCode: 1 }) }));
    const catalog = await resolver.catalog();
    const byKind = Object.fromEntries(catalog.options.map(option => [option.kind, option]));
    expect(byKind.pwsh!.availability).toBe('missing');
    expect(byKind['git-bash']!.availability).toBe('missing');
    expect(byKind.wsl!.availability).toBe('error');
    expect(byKind.wsl!.reason).toMatch(/Retry/);
    expect(catalog.wsl.distributions).toEqual([]);
  });

  it('reports zero distributions and missing wsl.exe distinctly', async () => {
    const empty = await new TerminalShellResolver(host({ files: [...BASE_WINDOWS_FILES], probe: () => ({ status: 'ok', stdout: utf16(' \r\n\r\n'), truncated: false }) })).catalog();
    expect(empty.wsl).toMatchObject({ availability: 'missing', reason: 'No WSL distributions are installed.' });
    const noWsl = await new TerminalShellResolver(host({ files: ['C:\\Windows\\System32\\cmd.exe'] })).catalog();
    expect(noWsl.wsl.availability).toBe('unsupported');
  });

  it('decodes UTF-8, dedupes, drops invalid names, and bounds the list', async () => {
    const names = ['Ubuntu', 'Ubuntu', ' bad\nname ', '-evil', 'Güültig-', ...Array.from({ length: 80 }, (_, index) => `d${index}`)];
    const resolver = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => ({ status: 'ok', stdout: Buffer.from(names.join('\n'), 'utf8'), truncated: false }) }));
    const catalog = await resolver.catalog();
    expect(catalog.wsl.distributions[0]).toBe('Ubuntu');
    expect(catalog.wsl.distributions).toContain('Güültig-');
    expect(catalog.wsl.distributions).not.toContain('-evil');
    expect(catalog.wsl.distributions.length).toBeLessThanOrEqual(64);
    expect(new Set(catalog.wsl.distributions).size).toBe(catalog.wsl.distributions.length);
  });

  it('coalesces concurrent reads, expires after TTL, and refresh bypasses', async () => {
    let calls = 0;
    const fake = host({ files: BASE_WINDOWS_FILES, probe: async () => { calls++; fake.time += 1; return { status: 'ok', stdout: utf16('Ubuntu\r\n'), truncated: false }; } });
    const resolver = new TerminalShellResolver(fake);
    const [a, b] = await Promise.all([resolver.catalog(), resolver.catalog()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    fake.time += 29_999;
    expect(await resolver.catalog()).toBe(a);
    fake.time += 2;
    await resolver.catalog();
    expect(calls).toBe(2);
    fake.time += 1;
    await resolver.catalog({ refresh: true });
    expect(calls).toBe(3);
  });

  it('aborts a single subscriber without cancelling the shared probe', async () => {
    let release!: (value: TerminalShellProbeResult) => void;
    const fake = host({ files: BASE_WINDOWS_FILES, probe: () => new Promise<TerminalShellProbeResult>(resolve => { release = resolve; }) });
    const resolver = new TerminalShellResolver(fake);
    const controller = new AbortController();
    const cancelled = resolver.catalog({ signal: controller.signal });
    const kept = resolver.catalog();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(fake.probes).toHaveLength(1));
    release({ status: 'ok', stdout: utf16('Ubuntu\r\n'), truncated: false });
    expect((await kept).wsl.distributions).toEqual(['Ubuntu']);
  });
});

describe('resolve on Windows', () => {
  const BINDING = 'D:\\work\\demo space';
  const wslOk = (mount = '/mnt/d/work/demo space') => ({ status: 'ok' as const, stdout: Buffer.from(mount + '\r\n', 'utf8'), truncated: false });

  it('default uses COMSPEC with a system cmd retry descriptor', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, COMSPEC: 'D:\\Tools\\cmd.exe' }, files: [...BASE_WINDOWS_FILES, 'D:\\Tools\\cmd.exe'] }));
    const result = await resolver.resolve({ kind: 'default' }, BINDING, { APP_MODE: 'dev' });
    expect(result).toMatchObject({ file: 'D:\\Tools\\cmd.exe', args: ['/D', '/Q'], cwd: BINDING, env: { APP_MODE: 'dev' }, shell: { kind: 'default' }, retry: { file: 'C:\\Windows\\System32\\cmd.exe', args: ['/D', '/Q'] } });
  });

  it('explicit cmd ignores COMSPEC and has no retry', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, COMSPEC: 'D:\\Tools\\cmd.exe' }, files: [...BASE_WINDOWS_FILES, 'D:\\Tools\\cmd.exe'] }));
    const result = await resolver.resolve({ kind: 'cmd' }, BINDING, {});
    expect(result.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(result.retry).toBeUndefined();
  });

  it('pwsh prefers Program Files over PATH matches and dedupes', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, PATH: 'C:\\Tools\\bin;C:\\Tools\\bin' }, files: [...BASE_WINDOWS_FILES, 'C:\\Tools\\bin\\pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'] }));
    expect((await resolver.resolve({ kind: 'pwsh' }, BINDING, {})).file).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    const pathOnly = new TerminalShellResolver(host({ env: { ...WIN_ENV, PATH: 'C:\\Tools\\bin' }, files: [...BASE_WINDOWS_FILES, 'C:\\Tools\\bin\\pwsh.exe'] }));
    expect((await pathOnly.resolve({ kind: 'pwsh' }, BINDING, {})).file).toBe('C:\\Tools\\bin\\pwsh.exe');
  });

  it('keeps pwsh and Windows PowerShell distinct', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, PATH: 'C:\\Tools' }, files: [...BASE_WINDOWS_FILES, 'C:\\Tools\\powershell.exe', 'C:\\Tools\\pwsh.exe'] }));
    expect((await resolver.resolve({ kind: 'powershell' }, BINDING, {})).file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect((await resolver.resolve({ kind: 'pwsh' }, BINDING, {})).file).toBe('C:\\Tools\\pwsh.exe');
  });

  it('finds Git Bash across bundled, install dirs and PATH-inferred roots, preferring bin over usr/bin', async () => {
    const bundled = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, bundled: 'D:\\harness\\git\\cmd\\git.exe' }));
    // bundled Git without bash is not offered
    await expect(bundled.resolve({ kind: 'git-bash' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    const bundledWithBash = new TerminalShellResolver(host({ files: [...BASE_WINDOWS_FILES, 'D:\\harness\\git\\usr\\bin\\bash.exe'], bundled: 'D:\\harness\\git\\cmd\\git.exe' }));
    expect((await bundledWithBash.resolve({ kind: 'git-bash' }, BINDING, {})).file).toBe('D:\\harness\\git\\usr\\bin\\bash.exe');
    const programFiles = new TerminalShellResolver(host({ files: [...BASE_WINDOWS_FILES, 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'] }));
    expect((await programFiles.resolve({ kind: 'git-bash' }, BINDING, {})).file).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    const local = new TerminalShellResolver(host({ files: [...BASE_WINDOWS_FILES, 'C:\\Users\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'] }));
    expect((await local.resolve({ kind: 'git-bash' }, BINDING, {})).file).toBe('C:\\Users\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe');
    const inferred = new TerminalShellResolver(host({ env: { ...WIN_ENV, PATH: 'E:\\Tools\\Git\\cmd' }, files: [...BASE_WINDOWS_FILES, 'E:\\Tools\\Git\\bin\\bash.exe'] }));
    expect((await inferred.resolve({ kind: 'git-bash' }, BINDING, {})).file).toBe('E:\\Tools\\Git\\bin\\bash.exe');
    // arbitrary PATH bash.exe is never offered
    const arbitrary = new TerminalShellResolver(host({ env: { ...WIN_ENV, PATH: 'C:\\Tools\\bin' }, files: [...BASE_WINDOWS_FILES, 'C:\\Tools\\bin\\bash.exe'] }));
    await expect(arbitrary.resolve({ kind: 'git-bash' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    const env = (await programFiles.resolve({ kind: 'git-bash' }, BINDING, { X: '1' })).env;
    expect(env).toEqual({ X: '1', CHERE_INVOKING: '1' });
  });

  it('throws TERMINAL_SHELL_UNAVAILABLE for missing explicit shells', async () => {
    const files = BASE_WINDOWS_FILES.filter(file => !file.includes('powershell'));
    const resolver = new TerminalShellResolver(host({ files }));
    await expect(resolver.resolve({ kind: 'pwsh' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    await expect(resolver.resolve({ kind: 'powershell' }, BINDING, {})).rejects.toBeInstanceOf(HarnessError);
  });

  it('resolves wsl named distro via wslpath and forwards only configured env names', async () => {
    const fake = host({ files: BASE_WINDOWS_FILES, probe: (_file, args) => args.includes('--list') ? { status: 'ok', stdout: utf16('Ubuntu\r\n'), truncated: false } : wslOk('/home/dev/mounted/demo space') });
    const resolver = new TerminalShellResolver(fake);
    const result = await resolver.resolve({ kind: 'wsl', distro: 'Ubuntu' }, BINDING, { SECRET_TOKEN: 'v1', APP_MODE: 'v2', bad_name: 'skip' });
    expect(result.file).toBe('C:\\Windows\\System32\\wsl.exe');
    expect(result.args).toEqual(['--distribution', 'Ubuntu', '--cd', '/home/dev/mounted/demo space']);
    expect(result.cwd).toBe(BINDING);
    expect(result.env.WSLENV).toBe('SECRET_TOKEN:APP_MODE');
    expect(result.env.SECRET_TOKEN).toBe('v1');
    expect(result.shell).toMatchObject({ kind: 'wsl', distro: 'Ubuntu' });
    expect(fake.probes.find(probe => probe.args.includes('--exec'))!.args).toEqual(['--distribution', 'Ubuntu', '--exec', 'wslpath', '-a', '-u', BINDING]);
  });

  it('resolves wsl default distro without a --distribution arg', async () => {
    const resolver = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => wslOk() }));
    const result = await resolver.resolve({ kind: 'wsl' }, BINDING, {});
    expect(result.args).toEqual(['--cd', '/mnt/d/work/demo space']);
    expect(result.env.WSLENV).toBeUndefined();
  });

  it('rejects a missing named distro, failed listing and failed conversion distinctly', async () => {
    const resolver = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: (_file, args) => args.includes('--list') ? { status: 'ok', stdout: utf16('Ubuntu\r\n'), truncated: false } : wslOk() }));
    await expect(resolver.resolve({ kind: 'wsl', distro: 'NixOS' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    const listingError = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => ({ status: 'failed', exitCode: 1 }) }));
    await expect(listingError.resolve({ kind: 'wsl', distro: 'Ubuntu' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_SHELL_DISCOVERY_FAILED' });
    const convertError = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: (_file, args) => args.includes('--list') ? { status: 'ok', stdout: utf16('Ubuntu\r\n'), truncated: false } : { status: 'timeout' } }));
    await expect(convertError.resolve({ kind: 'wsl', distro: 'Ubuntu' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNAVAILABLE' });
  });

  it('rejects UNC and device paths before any conversion', async () => {
    const resolver = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES }));
    for (const path of ['\\\\server\\share\\x', '\\\\?\\C:\\x', '\\\\wsl$\\Ubuntu\\home\\x', 'relative\\dir']) {
      await expect(resolver.resolve({ kind: 'wsl' }, path, {})).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNSUPPORTED' });
    }
  });

  it('accepts conversion output with spaces, quotes, ampersands and unicode and rejects malformed output', async () => {
    const good = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => wslOk('/mnt/d/weißer Ordner/o\'brien & co') }));
    expect((await good.resolve({ kind: 'wsl' }, BINDING, {})).args.at(-1)).toBe('/mnt/d/weißer Ordner/o\'brien & co');
    for (const output of ['', 'relative/path\n', 'C:\\still\\windows\n', '/ok\n/extra\n']) {
      const bad = new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => wslOk(output.trimEnd()) }));
      await expect(bad.resolve({ kind: 'wsl' }, BINDING, {})).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNAVAILABLE' });
    }
  });

  it('never puts env values or stderr in errors or the catalog', async () => {
    const resolver = new TerminalShellResolver(host({ env: { ...WIN_ENV, COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, files: BASE_WINDOWS_FILES, probe: () => ({ status: 'failed', exitCode: 1 }) }));
    const catalog = await resolver.catalog();
    expect(JSON.stringify(catalog)).not.toContain('v1');
    try {
      await new TerminalShellResolver(host({ files: BASE_WINDOWS_FILES, probe: () => ({ status: 'timeout' }) })).resolve({ kind: 'wsl', distro: 'Ubuntu' }, BINDING, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'TERMINAL_SHELL_DISCOVERY_FAILED' });
      expect((error as Error).message).not.toContain(BINDING);
    }
  });
});

describe('non-Windows hosts', () => {
  it('offers only the system shell and runs no Windows probes', async () => {
    const fake = host({ platform: 'linux', env: { SHELL: '/bin/zsh' }, probe: () => { expect.unreachable('no probes on Linux'); } });
    const resolver = new TerminalShellResolver(fake);
    const catalog = await resolver.catalog();
    expect(catalog.platform).toBe('linux');
    expect(catalog.options[0]).toMatchObject({ kind: 'default', availability: 'available' });
    expect(catalog.options.filter(option => option.availability === 'available')).toHaveLength(1);
    expect(catalog.wsl.availability).toBe('unsupported');
    const result = await resolver.resolve({ kind: 'pwsh' }, '/home/dev/proj', { APP_MODE: 'dev' });
    expect(result).toMatchObject({ file: '/bin/zsh', args: [], cwd: '/home/dev/proj', env: { APP_MODE: 'dev' }, shell: { kind: 'pwsh', notice: 'Windows shell selection is unavailable on this host; using the system shell.' } });
    const defaults = await resolver.resolve({ kind: 'default' }, '/home/dev/proj', {});
    expect(defaults.file).toBe('/bin/zsh');
    expect(defaults.shell.notice).toBeUndefined();
    const darwin = await new TerminalShellResolver(host({ platform: 'darwin', env: {} })).resolve({ kind: 'default' }, '/x', {});
    expect(darwin.file).toBe('/bin/sh');
  });
});
