import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { HarnessError } from '../contracts/index.ts';
import { TERMINAL_SHELL_DISTRO_NAME, type ShellAvailability, type TerminalShellCatalog, type TerminalShellInfo, type TerminalShellOption, type TerminalShellSelection } from '../contracts/terminal-shell.ts';
import { gitExecutable, processEnvironment } from '../capabilities/process.ts';

export type TerminalShellProbeResult =
  | { status: 'ok'; stdout: Buffer; truncated: boolean }
  | { status: 'failed'; exitCode: number | null }
  | { status: 'timeout' }
  | { status: 'error' };

/** Injectable host seams so tests never touch the real OS. */
export interface TerminalShellHostEnv {
  platform: string;
  env: NodeJS.ProcessEnv;
  isExecutableFile(path: string): Promise<boolean>;
  bundledGit(): string | undefined;
  runProbe(file: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv): Promise<TerminalShellProbeResult>;
  now(): number;
}

export interface ResolvedTerminalShell {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell: TerminalShellInfo;
  /** One-shot fallback used only when a default COMSPEC spawn fails with ENOENT. */
  retry?: { file: string; args: string[] };
}

const CATALOG_TTL_MS = 30_000;
const DISCOVERY_BUDGET_MS = 5_000;
const WSL_CONVERT_BUDGET_MS = 10_000;
const MAX_DISTROS = 64;
const MAX_PROBE_BYTES = 64 * 1024;
const MAX_LINUX_CWD = 4096;
const WINDOWS_KINDS = ['cmd', 'pwsh', 'powershell', 'git-bash', 'wsl'] as const;

function realRunProbe(file: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv): Promise<TerminalShellProbeResult> {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(file, args, { shell: false, windowsHide: true, env: { ...processEnvironment(), ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { resolve({ status: 'error' }); return; }
    const chunks: Buffer[] = [];
    let bytes = 0, truncated = false, settled = false, timedOut = false;
    const finish = (result: TerminalShellProbeResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* already gone */ } }, Math.max(1, timeoutMs));
    timer.unref();
    child.stdout!.on('data', (chunk: Buffer) => {
      if (bytes >= MAX_PROBE_BYTES) { truncated = true; return; }
      const slice = chunk.subarray(0, MAX_PROBE_BYTES - bytes);
      truncated ||= slice.length < chunk.length;
      chunks.push(slice); bytes += slice.length;
    });
    child.once('error', () => finish({ status: 'error' }));
    child.once('close', code => finish(timedOut ? { status: 'timeout' } : code === 0 ? { status: 'ok', stdout: Buffer.concat(chunks), truncated } : { status: 'failed', exitCode: code }));
  });
}

const defaultHostEnv = (): TerminalShellHostEnv => ({
  platform: process.platform,
  env: process.env,
  isExecutableFile: async path => { try { return (await stat(path)).isFile(); } catch { return false; } },
  bundledGit: () => { try { const file = gitExecutable(); return file !== 'git' ? file : undefined; } catch { return undefined; } },
  runProbe: realRunProbe,
  now: () => Date.now(),
});

const isDriveAbsolute = (path: string) => /^[A-Za-z]:[\\/]/.test(path);
const winJoin = (...parts: string[]) => parts.join('\\');
const winDirname = (path: string) => { const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')); return index < 0 ? path : path.slice(0, index); };
const systemRoot = (env: NodeJS.ProcessEnv) => env.SystemRoot || env.WINDIR || 'C:\\Windows';
const pathDirs = (env: NodeJS.ProcessEnv) => (env.PATH ?? '').split(';').map(dir => dir.trim()).filter(dir => isDriveAbsolute(dir));

function decodeProbeText(stdout: Buffer): string {
  const utf16 = stdout.length >= 2 && (stdout[0] === 0xff && stdout[1] === 0xfe || stdout.length >= 4 && stdout[1] === 0 && stdout[3] === 0);
  return stdout.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/,'');
}

function decodeDistributions(stdout: Buffer): string[] {
  const seen = new Set<string>(), distros: string[] = [];
  for (const raw of decodeProbeText(stdout).split(/\r?\n/)) {
    const name = raw.replace(/\x00/g, '').trim();
    if (!name || !TERMINAL_SHELL_DISTRO_NAME.safeParse(name).success || seen.has(name)) continue;
    if (distros.length >= MAX_DISTROS) break;
    seen.add(name); distros.push(name);
  }
  return distros;
}

const WINDOWS_SHELL_LABELS: Record<string, string> = { default: 'System default (Command Prompt)', cmd: 'Command Prompt', pwsh: 'PowerShell 7', powershell: 'Windows PowerShell', 'git-bash': 'Git Bash', wsl: 'WSL' };
const NON_WINDOWS_NOTE = 'Windows shell selection is unavailable on this host; using the system shell.';
const shellUnavailable = (label: string) => new HarnessError('TERMINAL_SHELL_UNAVAILABLE', `${label} is not available on this host. Choose another terminal shell in Settings.`);

export class TerminalShellResolver {
  private host: TerminalShellHostEnv;
  private cached: { value: TerminalShellCatalog; expiresAt: number } | undefined;
  private inflight: Promise<TerminalShellCatalog> | undefined;

  constructor(host: TerminalShellHostEnv = defaultHostEnv()) { this.host = host; }

  invalidate(): void { this.cached = undefined; }

  /** Cached catalog; concurrent reads coalesce, refresh forces fresh discovery. */
  async catalog(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<TerminalShellCatalog> {
    if (options.signal?.aborted) throw new HarnessError('CANCELLED', 'Operation cancelled.');
    const now = this.host.now();
    if (!options.refresh && this.cached && now < this.cached.expiresAt) return this.cached.value;
    const pending = options.refresh || !this.inflight
      ? (this.inflight = this.discover().finally(() => { this.inflight = undefined; }))
      : this.inflight;
    if (!options.signal) return pending;
    return new Promise<TerminalShellCatalog>((resolve, reject) => {
      const onAbort = () => reject(new HarnessError('CANCELLED', 'Operation cancelled.'));
      options.signal!.addEventListener('abort', onAbort, { once: true });
      pending.then(value => { options.signal!.removeEventListener('abort', onAbort); resolve(value); },
        error => { options.signal!.removeEventListener('abort', onAbort); reject(error); });
    });
  }

  private async discover(): Promise<TerminalShellCatalog> {
    const catalog = this.host.platform === 'win32'
      ? await this.discoverWindows(this.host.now() + DISCOVERY_BUDGET_MS)
      : this.nonWindowsCatalog();
    this.cached = { value: catalog, expiresAt: this.host.now() + CATALOG_TTL_MS };
    return catalog;
  }

  private nonWindowsCatalog(): TerminalShellCatalog {
    const platform = this.host.platform === 'linux' ? 'linux' : this.host.platform === 'darwin' ? 'darwin' : 'other';
    const options: TerminalShellOption[] = [{ kind: 'default', label: 'System shell', availability: 'available' }];
    for (const kind of WINDOWS_KINDS) options.push({ kind, label: WINDOWS_SHELL_LABELS[kind]!, availability: 'unsupported', reason: 'Only available on Windows hosts.' });
    return { platform, options, wsl: { availability: 'unsupported', distributions: [], reason: 'WSL is only available on Windows hosts.' } };
  }

  private async discoverWindows(deadline: number): Promise<TerminalShellCatalog> {
    const { env } = this.host;
    const root = systemRoot(env);
    const systemCmd = winJoin(root, 'System32', 'cmd.exe');
    const comspec = env.COMSPEC && isDriveAbsolute(env.COMSPEC) && /\.exe$/i.test(env.COMSPEC) && await this.host.isExecutableFile(env.COMSPEC) ? env.COMSPEC : undefined;
    const options: TerminalShellOption[] = [];
    const hasSystemCmd = await this.host.isExecutableFile(systemCmd);
    options.push({ kind: 'default', label: WINDOWS_SHELL_LABELS.default, availability: comspec || hasSystemCmd ? 'available' : 'missing', ...(comspec || hasSystemCmd ? {} : { reason: 'Command Prompt was not found.' }) });
    options.push({ kind: 'cmd', label: WINDOWS_SHELL_LABELS.cmd, availability: hasSystemCmd ? 'available' : 'missing', ...(hasSystemCmd ? {} : { reason: 'Command Prompt was not found.' }) });
    const pwsh = await this.firstExisting(this.pwshCandidates());
    options.push({ kind: 'pwsh', label: WINDOWS_SHELL_LABELS.pwsh, availability: pwsh ? 'available' : 'missing', ...(pwsh ? {} : { reason: 'PowerShell 7 was not found.' }) });
    const powershell = await this.host.isExecutableFile(winJoin(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    options.push({ kind: 'powershell', label: WINDOWS_SHELL_LABELS.powershell, availability: powershell ? 'available' : 'missing', ...(powershell ? {} : { reason: 'Windows PowerShell was not found.' }) });
    const bash = await this.firstBash();
    options.push({ kind: 'git-bash', label: WINDOWS_SHELL_LABELS['git-bash'], availability: bash ? 'available' : 'missing', ...(bash ? {} : { reason: 'Git Bash was not found.' }) });
    const wslExe = winJoin(root, 'System32', 'wsl.exe');
    const hasWsl = await this.host.isExecutableFile(wslExe);
    const wsl = await this.discoverWsl(hasWsl ? wslExe : undefined, deadline);
    options.push({ kind: 'wsl', label: WINDOWS_SHELL_LABELS.wsl, availability: wsl.availability, ...(wsl.reason ? { reason: wsl.reason } : {}) });
    return { platform: 'win32', options, wsl };
  }

  private pwshCandidates(): string[] {
    const { env } = this.host;
    return [winJoin(env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'), ...pathDirs(env).map(dir => winJoin(dir, 'pwsh.exe'))];
  }

  private gitRoots(): string[] {
    const { env } = this.host;
    const roots: string[] = [];
    const bundled = this.host.bundledGit();
    if (bundled) {
      const dir = winDirname(bundled);
      if (/git\.exe$/i.test(bundled) && /[\\/](?:cmd|bin)$/i.test(dir)) roots.push(winDirname(dir));
    }
    roots.push(winJoin(env.ProgramFiles ?? 'C:\\Program Files', 'Git'));
    if (env['ProgramFiles(x86)']) roots.push(winJoin(env['ProgramFiles(x86)'], 'Git'));
    if (env.LOCALAPPDATA) roots.push(winJoin(env.LOCALAPPDATA, 'Programs', 'Git'));
    for (const dir of pathDirs(env)) {
      const match = /^(.*[\\/]Git)[\\/](?:cmd|bin)$/i.exec(dir);
      if (match) roots.push(match[1]!);
    }
    return [...new Set(roots)];
  }

  private async firstExisting(candidates: string[]): Promise<string | undefined> {
    for (const path of new Set(candidates)) if (await this.host.isExecutableFile(path)) return path;
    return undefined;
  }

  private async firstBash(): Promise<string | undefined> {
    for (const root of this.gitRoots()) {
      const bash = await this.firstExisting([winJoin(root, 'bin', 'bash.exe'), winJoin(root, 'usr', 'bin', 'bash.exe')]);
      if (bash) return bash;
    }
    return undefined;
  }

  private async discoverWsl(wslExe: string | undefined, deadline: number): Promise<TerminalShellCatalog['wsl']> {
    if (!wslExe) return { availability: 'unsupported', distributions: [], reason: 'WSL is not installed on this host.' };
    const remaining = deadline - this.host.now();
    if (remaining <= 0) return { availability: 'error', distributions: [], reason: 'Checking WSL distributions timed out. Retry.' };
    const probe = await this.host.runProbe(wslExe, ['--list', '--quiet'], remaining, {});
    if (probe.status !== 'ok') return { availability: 'error', distributions: [], reason: 'Could not list WSL distributions. Retry.' };
    const distributions = decodeDistributions(probe.stdout);
    if (distributions.length === 0) return { availability: 'missing', distributions: [], reason: 'No WSL distributions are installed.' };
    return { availability: 'available', distributions };
  }

  /** Resolve a saved selection into a spawn descriptor; throws HarnessError on failure. */
  async resolve(selection: TerminalShellSelection, bindingPath: string, configuredEnv: Record<string, string>): Promise<ResolvedTerminalShell> {
    if (this.host.platform !== 'win32') return this.resolveNonWindows(selection, bindingPath, configuredEnv);
    const kind = selection.kind;
    const distro = kind === 'wsl' ? selection.distro : undefined;
    const shell = (overrides: Partial<TerminalShellInfo> = {}): TerminalShellInfo => ({ kind, label: WINDOWS_SHELL_LABELS[kind]!, ...(distro ? { distro } : {}), ...overrides });
    if (kind === 'default' || kind === 'cmd') {
      const root = systemRoot(this.host.env);
      const systemCmd = winJoin(root, 'System32', 'cmd.exe');
      const comspec = kind === 'default' && this.host.env.COMSPEC && isDriveAbsolute(this.host.env.COMSPEC) && /\.exe$/i.test(this.host.env.COMSPEC) && await this.host.isExecutableFile(this.host.env.COMSPEC) ? this.host.env.COMSPEC : undefined;
      const file = kind === 'default' ? comspec ?? (await this.host.isExecutableFile(systemCmd) && systemCmd) : (await this.host.isExecutableFile(systemCmd) && systemCmd);
      if (!file) throw shellUnavailable('Command Prompt');
      const fallback = comspec && file === comspec && comspec !== systemCmd && await this.host.isExecutableFile(systemCmd) ? systemCmd : undefined;
      return { file, args: ['/D', '/Q'], cwd: bindingPath, env: { ...configuredEnv }, shell: shell(), ...(fallback ? { retry: { file: fallback, args: ['/D', '/Q'] } } : {}) };
    }
    if (kind === 'pwsh' || kind === 'powershell') {
      const file = kind === 'pwsh' ? await this.firstExisting(this.pwshCandidates()) : await this.host.isExecutableFile(winJoin(systemRoot(this.host.env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')).then(exists => exists ? winJoin(systemRoot(this.host.env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : undefined);
      if (!file) throw shellUnavailable(kind === 'pwsh' ? 'PowerShell 7' : 'Windows PowerShell');
      return { file, args: ['-NoLogo'], cwd: bindingPath, env: { ...configuredEnv }, shell: shell() };
    }
    if (kind === 'git-bash') {
      const file = await this.firstBash();
      if (!file) throw shellUnavailable('Git Bash');
      return { file, args: ['--login', '-i'], cwd: bindingPath, env: { ...configuredEnv, CHERE_INVOKING: '1' }, shell: shell() };
    }
    return this.resolveWsl(selection, bindingPath, configuredEnv, shell);
  }

  private resolveNonWindows(selection: TerminalShellSelection, bindingPath: string, configuredEnv: Record<string, string>): ResolvedTerminalShell {
    const file = this.host.env.SHELL ?? '/bin/sh';
    const kind = selection.kind;
    const shell: TerminalShellInfo = {
      kind,
      label: 'System shell',
      ...(kind === 'wsl' && selection.distro ? { distro: selection.distro } : {}),
      ...(kind !== 'default' ? { notice: NON_WINDOWS_NOTE } : {}),
    };
    return { file, args: [], cwd: bindingPath, env: { ...configuredEnv }, shell };
  }

  private async resolveWsl(selection: TerminalShellSelection, bindingPath: string, configuredEnv: Record<string, string>, shell: (overrides?: Partial<TerminalShellInfo>) => TerminalShellInfo): Promise<ResolvedTerminalShell> {
    const wslExe = winJoin(systemRoot(this.host.env), 'System32', 'wsl.exe');
    if (!await this.host.isExecutableFile(wslExe)) throw shellUnavailable('WSL');
    const distro = selection.kind === 'wsl' ? selection.distro : undefined;
    if (distro) {
      const catalog = await this.catalog();
      if (catalog.wsl.availability === 'error') throw new HarnessError('TERMINAL_SHELL_DISCOVERY_FAILED', 'Could not check WSL distributions. Retry.');
      if (!catalog.wsl.distributions.includes(distro)) throw new HarnessError('TERMINAL_SHELL_UNAVAILABLE', `The WSL distribution "${distro}" is not installed. Choose another distribution in Settings.`);
    }
    if (!isDriveAbsolute(bindingPath)) throw new HarnessError('TERMINAL_CWD_UNSUPPORTED', 'WSL terminals need a project on a local drive path, such as C:\\work\\demo.');
    const probe = await this.host.runProbe(wslExe, [...(distro ? ['--distribution', distro] : []), '--exec', 'wslpath', '-a', '-u', bindingPath], WSL_CONVERT_BUDGET_MS, {});
    if (probe.status !== 'ok') throw new HarnessError('TERMINAL_CWD_UNAVAILABLE', 'Could not convert the project directory for WSL. Update WSL to use project terminal directories.');
    const lines = probe.stdout.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    const linuxCwd = lines.length === 1 ? lines[0]! : undefined;
    if (!linuxCwd || linuxCwd.length > MAX_LINUX_CWD || !linuxCwd.startsWith('/') || /[\x00\r\n]/.test(linuxCwd)) {
      throw new HarnessError('TERMINAL_CWD_UNAVAILABLE', 'Could not convert the project directory for WSL. Update WSL to use project terminal directories.');
    }
    const wslenv = Object.keys(configuredEnv).filter(name => /^[A-Z][A-Z0-9_]*$/.test(name)).slice(0, 200).join(':');
    return {
      file: wslExe,
      args: [...(distro ? ['--distribution', distro] : []), '--cd', linuxCwd],
      cwd: bindingPath,
      env: { ...configuredEnv, ...(wslenv ? { WSLENV: wslenv } : {}) },
      shell: shell({ label: distro ? `WSL: ${distro}` : 'WSL' }),
    };
  }
}

export type { ShellAvailability, TerminalShellCatalog, TerminalShellInfo, TerminalShellOption, TerminalShellSelection };
