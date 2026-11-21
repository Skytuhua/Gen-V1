import { describe, expect, it } from 'vitest';
import { TerminalShellResolver, type ShellProbeRunner, type TerminalShellDeps } from '../packages/workspace/terminal-shell.ts';
import type { TerminalShellSelection } from '../packages/contracts/terminal-shell.ts';

const utf16le = (text: string, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')]);
const utf8 = (text: string) => Buffer.from(text, 'utf8');
const WIN_CMD = 'C:\\Windows\\System32\\cmd.exe', WIN_WSL = 'C:\\Windows\\System32\\wsl.exe';

interface FixtureOptions {
  files?: string[]; env?: Record<string, string>; run?: ShellProbeRunner; now?: () => number; spawnEnv?: () => Record<string, string>;
}
function fixture(options: FixtureOptions = {}) {
  const files = new Set(options.files ?? []);
  const runCalls: { file: string; args: string[]; options: Record<string, unknown> }[] = [];
  const run: ShellProbeRunner = async (file, args, runOptions) => {
    runCalls.push({ file, args, options: runOptions as Record<string, unknown> });
    return options.run ? options.run(file, args, runOptions) : { code: 0, stdout: new Uint8Array(), timedOut: false };
  };
  const deps: TerminalShellDeps = {
    platform: 'win32', env: { SystemRoot: 'C:\\Windows', ...options.env }, exists: path => files.has(path),
    run, now: options.now, spawnEnv: options.spawnEnv ?? (() => ({ PATH: 'SANITIZED' })),
  };
  return { resolver: new TerminalShellResolver(deps), runCalls, files };
}
const resolve = (resolver: TerminalShellResolver, selection: TerminalShellSelection, binding = 'C:\\work\\demo', configured: Record<string, string> = {}) =>
  resolver.resolve(selection, binding, configured);

describe('Windows catalog discovery', () => {
  it('reports every option with availability and explains each missing shell', async () => {
    const { resolver, runCalls } = fixture({ files: [WIN_CMD] });
    const catalog = await resolver.catalog();
    expect(catalog.platform).toBe('win32');
    expect(catalog.options.map(option => [option.kind, option.availability])).toEqual([
      ['default', 'available'], ['cmd', 'available'], ['pwsh', 'missing'], ['powershell', 'missing'], ['git-bash', 'missing'], ['wsl', 'missing'],
    ]);
    expect(catalog.options.find(option => option.kind === 'pwsh')?.reason).toContain('pwsh.exe');
    expect(catalog.options.find(option => option.kind === 'git-bash')?.reason).toContain('Git Bash');
    expect(catalog.options.find(option => option.kind === 'wsl')?.reason).toContain('wsl.exe');
    expect(catalog.wsl).toMatchObject({ distributions: [], availability: 'missing' });
    // No wsl.exe means no WSL probe was ever launched.
    expect(runCalls).toEqual([]);
    // The catalog never leaks executable paths or environment values.
    expect(JSON.stringify(catalog)).not.toMatch(/[A-Za-z]:[\\/]|SANITIZED/);
  });
  it('finds shells across Program Files, PATH and Git install roots without searching cwd', async () => {
    const { resolver } = fixture({
      files: [WIN_CMD, 'D:\\PowerShell\\pwsh.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Tools\\Git\\cmd\\git.exe', 'C:\\Tools\\Git\\usr\\bin\\bash.exe'],
      env: { PATH: '.;D:\\PowerShell;relative;C:\\Tools\\Git\\cmd', COMSPEC: 'D:\\custom\\cmd.EXE' },
    });
    const catalog = await resolver.catalog({ refresh: true });
    expect(catalog.options.filter(option => option.availability === 'available').map(option => option.kind)).toEqual(['default', 'cmd', 'pwsh', 'powershell', 'git-bash', 'wsl'].filter(kind => kind !== 'wsl'));
    expect(catalog.options.find(option => option.kind === 'pwsh')?.availability).toBe('available');
    expect(catalog.options.find(option => option.kind === 'git-bash')?.availability).toBe('available');
  });
  it('coalesces concurrent catalog reads, honors the TTL and explicit refresh', async () => {
    let time = 0, probed = 0;
    const { resolver, runCalls } = fixture({
      files: [WIN_CMD, WIN_WSL], now: () => time,
      run: async () => { probed++; return { code: 0, stdout: utf16le('Ubuntu\r\n', false), timedOut: false }; },
    });
    const [first, second] = await Promise.all([resolver.catalog(), resolver.catalog()]);
    expect(probed).toBe(1);
    expect(first).toEqual(second);
    expect(first.wsl.distributions).toEqual(['Ubuntu']);
    await resolver.catalog();
    expect(runCalls).toHaveLength(1);
    time = 31_000;
    await resolver.catalog();
    expect(runCalls).toHaveLength(2);
    await resolver.catalog({ refresh: true });
    expect(runCalls).toHaveLength(3);
  });
  it('marks listing failures retryable rather than an empty success', async () => {
    for (const probe of [
      { code: 1, stdout: utf8(''), timedOut: false },
      { code: 0, stdout: utf8(''), timedOut: true },
      { code: 0, stdout: utf8(''), timedOut: false, fail: true },
    ]) {
      const { resolver } = fixture({
        files: [WIN_CMD, WIN_WSL],
        run: async () => { if ('fail' in probe) throw new Error('spawn failed'); return { code: probe.code, stdout: probe.stdout, timedOut: probe.timedOut }; },
      });
      const catalog = await resolver.catalog();
      expect(catalog.wsl.availability).toBe('error');
      expect(catalog.options.find(option => option.kind === 'wsl')?.availability).toBe('error');
      expect(catalog.wsl.reason).toBeTruthy();
    }
  });
});

describe('WSL distribution listing', () => {
  const catalogWsl = async (stdout: Buffer) => {
    const { resolver } = fixture({ files: [WIN_CMD, WIN_WSL], run: async () => ({ code: 0, stdout, timedOut: false }) });
    return (await resolver.catalog()).wsl;
  };
  it('decodes UTF-16LE with a BOM', async () => {
    expect((await catalogWsl(utf16le('Ubuntu-24.04\r\nDebian\r\n'))).distributions).toEqual(['Ubuntu-24.04', 'Debian']);
  });
  it('detects UTF-16LE without a BOM by the zero-byte pattern', async () => {
    expect((await catalogWsl(utf16le('Ubuntu\n', false))).distributions).toEqual(['Ubuntu']);
  });
  it('decodes UTF-8 output and keeps spaces and non-ASCII names', async () => {
    expect((await catalogWsl(utf8('Mon Linux Dev\r\nUbuntu-24.04-é\n'))).distributions).toEqual(['Mon Linux Dev', 'Ubuntu-24.04-é']);
  });
  it('trims whitespace and NUL artifacts and deduplicates names', async () => {
    const bytes = utf16le('  Ubuntu  \r\n\0Debian\0\r\nUbuntu\r\n');
    expect((await catalogWsl(bytes)).distributions).toEqual(['Ubuntu', 'Debian']);
  });
  it('drops names that would be unsafe as arguments and bounds the list', async () => {
    const many = Array.from({ length: 80 }, (_, index) => `distro-${index}`);
    const text = ['-bad', ...many, 'bad\rname'].join('\n');
    const { resolver } = fixture({ files: [WIN_CMD, WIN_WSL], run: async () => ({ code: 0, stdout: utf16le(text), timedOut: false }) });
    const wsl = (await resolver.catalog()).wsl;
    expect(wsl.distributions).not.toContain('-bad');
    expect(wsl.distributions).toHaveLength(64);
  });
  it('reports no installed distributions honestly', async () => {
    const wsl = await catalogWsl(utf16le('\r\n'));
    expect(wsl).toMatchObject({ distributions: [], availability: 'missing', reason: 'No WSL distributions are installed.' });
  });
});

describe('Windows launch descriptors', () => {
  it('prefers a valid COMSPEC for default and offers the single system-cmd retry', async () => {
    const { resolver } = fixture({ files: [WIN_CMD, 'D:\\tools\\cmd.exe'], env: { COMSPEC: 'D:\\tools\\cmd.exe' } });
    const launch = await resolve(resolver, { kind: 'default' });
    expect(launch).toMatchObject({ file: 'D:\\tools\\cmd.exe', args: ['/D', '/Q'], cwd: 'C:\\work\\demo', fallback: { file: WIN_CMD, args: ['/D', '/Q'] }, shell: { kind: 'cmd' } });
  });
  it('falls back to System32 cmd for a missing or unusable COMSPEC', async () => {
    for (const env of [{ COMSPEC: 'D:\\missing\\cmd.exe' }, { COMSPEC: 'not-absolute' }, {}] as Record<string, string>[]) {
      const { resolver } = fixture({ files: [WIN_CMD], env });
      const launch = await resolve(resolver, { kind: 'default' });
      expect(launch).toMatchObject({ file: WIN_CMD, args: ['/D', '/Q'], shell: { kind: 'cmd' } });
      expect(launch.fallback).toBeUndefined();
    }
  });
  it('uses the system cmd for an explicit cmd choice and fails closed when absent', async () => {
    const { resolver } = fixture({ files: [WIN_CMD], env: { COMSPEC: 'D:\\tools\\cmd.exe' } });
    expect((await resolve(resolver, { kind: 'cmd' })).file).toBe(WIN_CMD);
    const empty = fixture({ env: { COMSPEC: 'D:\\tools\\cmd.exe' } });
    await expect(resolve(empty.resolver, { kind: 'cmd' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
  });
  it('orders PowerShell 7 ahead of PATH and keeps editions distinct', async () => {
    const { resolver } = fixture({
      files: [WIN_CMD, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'D:\\bin\\pwsh.exe'],
      env: { PATH: 'D:\\bin' },
    });
    expect((await resolve(resolver, { kind: 'pwsh' }))).toMatchObject({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'], shell: { kind: 'pwsh', label: 'PowerShell 7' } });
    const { resolver: pathOnly } = fixture({ files: [WIN_CMD, 'D:\\bin\\pwsh.exe'], env: { PATH: 'D:\\bin' } });
    expect((await resolve(pathOnly, { kind: 'pwsh' })).file).toBe('D:\\bin\\pwsh.exe');
    const { resolver: windows } = fixture({ files: [WIN_CMD, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'] });
    expect((await resolve(windows, { kind: 'powershell' }))).toMatchObject({ file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoLogo'], shell: { kind: 'powershell' } });
    // A detected pwsh never satisfies an explicit Windows PowerShell choice.
    const { resolver: pwshOnly } = fixture({ files: [WIN_CMD, 'D:\\bin\\pwsh.exe'], env: { PATH: 'D:\\bin' } });
    await expect(resolve(pwshOnly, { kind: 'powershell' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
  });
  it('locates Git Bash inside every supported Git root and never arbitrary PATH bash', async () => {
    const cases: { files: string[]; env?: Record<string, string>; want?: string }[] = [
      { files: [WIN_CMD, 'C:\\bundle\\git\\cmd\\git.exe', 'C:\\bundle\\git\\bin\\bash.exe'], env: { HARNESS_BUNDLED_GIT: 'C:\\bundle\\git\\cmd\\git.exe' }, want: 'C:\\bundle\\git\\bin\\bash.exe' },
      { files: [WIN_CMD, 'C:\\bundle\\git\\cmd\\git.exe', 'C:\\bundle\\git\\usr\\bin\\bash.exe'], env: { HARNESS_BUNDLED_GIT: 'C:\\bundle\\git\\cmd\\git.exe' }, want: 'C:\\bundle\\git\\usr\\bin\\bash.exe' },
      // A bundled Git without bash is never offered; a real install is used instead.
      { files: [WIN_CMD, 'C:\\bundle\\git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'], env: { HARNESS_BUNDLED_GIT: 'C:\\bundle\\git\\cmd\\git.exe' }, want: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      { files: [WIN_CMD, 'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'], env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, want: 'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe' },
      { files: [WIN_CMD, 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'], env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, want: 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe' },
      { files: [WIN_CMD, 'D:\\Apps\\Git\\bin\\git.exe', 'D:\\Apps\\Git\\bin\\bash.exe'], env: { PATH: 'D:\\Apps\\Git\\bin' }, want: 'D:\\Apps\\Git\\bin\\bash.exe' },
      // bash.exe on PATH without a Git install layout is never used.
      { files: [WIN_CMD, 'D:\\Tools\\bin\\bash.exe'], env: { PATH: 'D:\\Tools\\bin' }, want: undefined },
    ];
    for (const testCase of cases) {
      const { resolver } = fixture({ files: testCase.files, env: testCase.env });
      const launch = resolve(resolver, { kind: 'git-bash' });
      if (testCase.want) {
        await expect(launch).resolves.toMatchObject({ file: testCase.want, args: ['--login', '-i'], shell: { kind: 'git-bash', label: 'Git Bash' } });
        expect((await launch).env).toMatchObject({ PATH: 'SANITIZED', CHERE_INVOKING: '1' });
      } else await expect(launch).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
    }
  });
});

describe('WSL launch descriptors', () => {
  const wslFixture = (distros: string[], options: FixtureOptions = {}) => fixture({
    files: [WIN_CMD, WIN_WSL, ...(options.files ?? [])],
    env: options.env,
    run: async (_file, args) => {
      if (args.includes('--exec')) return { code: 0, stdout: utf8('/mnt/c/work/demo space\n'), timedOut: false };
      return { code: 0, stdout: utf16le(distros.join('\r\n') + '\r\n'), timedOut: false };
    },
    spawnEnv: options.spawnEnv,
  });
  it('converts the binding through wslpath and keeps the Windows cwd as the PTY directory', async () => {
    const { resolver, runCalls } = wslFixture(['Ubuntu']);
    const launch = await resolve(resolver, { kind: 'wsl' }, 'C:\\work\\demo space', { PROJECT_TOKEN: 'value-1' });
    expect(launch).toMatchObject({
      file: WIN_WSL, args: ['--cd', '/mnt/c/work/demo space'], cwd: 'C:\\work\\demo space',
      env: { PATH: 'SANITIZED', PROJECT_TOKEN: 'value-1', WSLENV: 'PROJECT_TOKEN' },
      shell: { kind: 'wsl', label: 'WSL' },
    });
    expect(runCalls).toEqual([
      { file: WIN_WSL, args: ['--list', '--quiet'], options: expect.objectContaining({ timeoutMs: 5000 }) },
      { file: WIN_WSL, args: ['--exec', 'wslpath', '-a', '-u', 'C:\\work\\demo space'], options: expect.objectContaining({ timeoutMs: 10000 }) },
    ]);
  });
  it('launches named distributions exactly and never accepts an uninstalled one', async () => {
    const { resolver } = wslFixture(['Ubuntu', 'Mon Linux & Dev']);
    const launch = await resolve(resolver, { kind: 'wsl', distro: 'Mon Linux & Dev' });
    expect(launch.args).toEqual(['--distribution', 'Mon Linux & Dev', '--cd', '/mnt/c/work/demo space']);
    expect(launch.shell).toMatchObject({ kind: 'wsl', distro: 'Mon Linux & Dev', label: 'WSL (Mon Linux & Dev)' });
    await expect(resolve(resolver, { kind: 'wsl', distro: 'NotInstalled' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE', message: expect.stringContaining('no longer available') });
    // A hostile name never reaches a process: membership fails before any launch.
    await expect(resolve(resolver, { kind: 'wsl', distro: 'x & calc' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
  });
  it('rejects UNC, device namespace and wsl$ bindings before any distro work', async () => {
    const { resolver, runCalls } = wslFixture(['Ubuntu']);
    for (const binding of ['\\\\server\\share\\dir', '\\\\?\\C:\\work', '\\\\wsl$\\Ubuntu\\home\\me', 'relative\\dir']) {
      await expect(resolve(resolver, { kind: 'wsl' }, binding)).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNSUPPORTED' });
    }
    expect(runCalls).toHaveLength(0);
  });
  it('maps listing and conversion failures to structured errors', async () => {
    const failing = (run: ShellProbeRunner) => fixture({ files: [WIN_CMD, WIN_WSL], run });
    await expect(resolve(failing(async () => ({ code: 1, stdout: utf8(''), timedOut: false })).resolver, { kind: 'wsl' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_DISCOVERY_FAILED' });
    await expect(resolve(failing(async () => ({ code: 0, stdout: utf8(''), timedOut: true })).resolver, { kind: 'wsl' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_DISCOVERY_FAILED' });
    const convertFails: { code: number; stdout: Buffer; timedOut: boolean }[] = [
      { code: 1, stdout: utf8(''), timedOut: false },
      { code: 0, stdout: utf8(''), timedOut: true },
      { code: 0, stdout: utf8('relative/path\n'), timedOut: false },
      { code: 0, stdout: utf8('/first\n/second\n'), timedOut: false },
      { code: 0, stdout: utf8('/with\0nul\n'), timedOut: false },
      { code: 0, stdout: utf8('/' + 'x'.repeat(5000) + '\n'), timedOut: false },
    ];
    for (const output of convertFails) {
      const { resolver } = fixture({
        files: [WIN_CMD, WIN_WSL],
        run: async (_file, args) => args.includes('--exec') ? output : { code: 0, stdout: utf16le('Ubuntu\r\n'), timedOut: false },
      });
      await expect(resolve(resolver, { kind: 'wsl' })).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNAVAILABLE' });
    }
    // wsl.exe itself missing.
    const { resolver: noWsl } = fixture({ files: [WIN_CMD] });
    await expect(resolve(noWsl, { kind: 'wsl' })).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' });
  });
  it('forwards only configured variable names through WSLENV, never PATH/HOME or values', async () => {
    const { resolver } = wslFixture(['Ubuntu']);
    const configured = { EDITOR_CHOICE: 'vim', PATH: 'ignored', HOME: 'ignored', WSLENV: 'ignored', TEAM_FLAG: 'on' };
    const launch = await resolve(resolver, { kind: 'wsl' }, 'C:\\work\\demo', configured);
    expect(launch.env.WSLENV).toBe('EDITOR_CHOICE:TEAM_FLAG');
    // Values stay solely in the child environment; WSLENV carries names only.
    expect(launch.env).toMatchObject({ EDITOR_CHOICE: 'vim' });
    expect(launch.env.WSLENV).not.toContain('vim');
    expect(JSON.stringify(launch.shell)).not.toContain('vim');
  });
});

describe('Non-Windows hosts', () => {
  it('exposes only the system shell and explains unsupported choices', async () => {
    for (const platform of ['linux', 'darwin', 'freebsd']) {
      const posix = new TerminalShellResolver({ platform, env: { SHELL: '/usr/bin/zsh' }, run: async () => { throw new Error('never'); }, spawnEnv: () => ({ PATH: 'SANITIZED' }) });
      const catalog = await posix.catalog();
      expect(catalog.platform).toBe(platform === 'freebsd' ? 'other' : platform);
      expect(catalog.options.filter(option => option.availability === 'available')).toEqual([{ kind: 'default', label: 'System shell', availability: 'available' }]);
      expect(catalog.options.filter(option => option.availability === 'unsupported')).toHaveLength(5);
      expect(catalog.wsl.availability).toBe('unsupported');
    }
  });
  it('resolves every selection to the system shell with a notice for stored Windows choices', async () => {
    const resolver = new TerminalShellResolver({ platform: 'linux', env: { SHELL: '/bin/bash' }, run: async () => { throw new Error('Windows probes must not run'); }, spawnEnv: () => ({ PATH: 'SANITIZED' }) });
    const plain = await resolver.resolve({ kind: 'default' }, '/home/me/project', {});
    expect(plain).toMatchObject({ file: '/bin/bash', args: [], cwd: '/home/me/project', env: { PATH: 'SANITIZED' }, shell: { kind: 'default', label: 'System shell' } });
    expect(plain.shell.notice).toBeUndefined();
    for (const selection of [{ kind: 'pwsh' }, { kind: 'wsl', distro: 'Ubuntu' }, { kind: 'git-bash' }] as TerminalShellSelection[]) {
      const launch = await resolver.resolve(selection, '/home/me/project', { KEEP: '1' });
      expect(launch.file).toBe('/bin/bash');
      expect(launch.env).toEqual({ PATH: 'SANITIZED', KEEP: '1' });
      expect(launch.shell.notice).toBe('Windows shell selection is unavailable on this host; using the system shell.');
    }
    const noShell = new TerminalShellResolver({ platform: 'darwin', env: {}, run: async () => { throw new Error('never'); } });
    expect((await noShell.resolve({ kind: 'default' }, '/x', {})).file).toBe('/bin/sh');
  });
});
