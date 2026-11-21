import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HarnessError } from '../contracts/index.ts';
import { processEnvironment } from '../capabilities/process.ts';
import { wslDistroSchema, type TerminalShellCatalog, type TerminalShellInfo, type TerminalShellSelection } from '../contracts/terminal-shell.ts';

/** One bounded, byte-aware, shell-free probe. stdout is raw bytes because wsl.exe
 * lists distributions in UTF-16LE; nothing the host prints may reach a response. */
export interface ShellProbeResult { code: number; stdout: Uint8Array; timedOut: boolean }
export type ShellProbeRunner = (file: string, args: string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number; maxBytes: number }) => Promise<ShellProbeResult>;
/** Every host seam is injectable so unit tests run Windows discovery on Linux. */
export interface TerminalShellDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  run?: ShellProbeRunner;
  now?: () => number;
  spawnEnv?: () => Record<string, string>;
}
export interface TerminalShellDescriptor {
  file: string; args: string[]; cwd: string; env: Record<string, string>;
  shell: TerminalShellInfo;
  /** Only the default COMSPEC choice may retry once against the system cmd. */
  fallback?: { file: string; args: string[] };
}
const CATALOG_TTL_MS = 30_000, PROBE_TIMEOUT_MS = 5_000, WSL_CONVERT_TIMEOUT_MS = 10_000;
const MAX_DISTROS = 64, MAX_PROBE_BYTES = 64 * 1024, MAX_POSIX_PATH = 4096;
const OPTION_LABELS: Record<TerminalShellSelection['kind'], string> = {
  default: 'System default (Command Prompt)', cmd: 'Command Prompt', pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell', 'git-bash': 'Git Bash', wsl: 'WSL',
};
const WINDOWS_ONLY = 'This shell is only available on Windows.';
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const windowsDrivePath = /^[A-Za-z]:[\\/]/, absoluteExe = /^[A-Za-z]:[\\/].*\.exe$/i;
const abortError = () => Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
/** Local drive paths only; UNC, device namespace and \\wsl$ bindings have no wslpath. */
const wslCompatibleBinding = (path: string) => windowsDrivePath.test(path);

const defaultRunner: ShellProbeRunner = (file, args, { cwd, env, timeoutMs, maxBytes }) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks: Buffer[] = [];
  let bytes = 0, timedOut = false, settled = false;
  const finish = (result: ShellProbeResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs); timer.unref();
  child.stdout.on('data', (chunk: Buffer) => {
    if (bytes + chunk.length > maxBytes) { chunks.push(chunk.subarray(0, Math.max(0, maxBytes - bytes))); bytes = maxBytes; }
    else { chunks.push(chunk); bytes += chunk.length; }
  });
  child.once('error', error => { clearTimeout(timer); settled = true; reject(error); });
  child.once('close', code => finish({ code: code ?? -1, stdout: Buffer.concat(chunks), timedOut }));
});

export class TerminalShellResolver {
  private readonly platform: string;
  private readonly env: Record<string, string | undefined>;
  private readonly exists: (path: string) => boolean;
  private readonly run: ShellProbeRunner;
  private readonly now: () => number;
  private readonly spawnEnv: () => Record<string, string>;
  private cached?: { catalog: TerminalShellCatalog; at: number };
  private inflight?: { sequence: number; promise: Promise<TerminalShellCatalog> };
  private sequence = 0;
  constructor(deps: TerminalShellDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.env = deps.env ?? process.env;
    this.exists = deps.exists ?? isFile;
    this.run = deps.run ?? defaultRunner;
    this.now = deps.now ?? Date.now;
    this.spawnEnv = deps.spawnEnv ?? (() => processEnvironment() as Record<string, string>);
  }
  /** Drop the cached catalog after a launch reports a vanished executable. */
  invalidate() { this.cached = undefined; }
  async catalog(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<TerminalShellCatalog> {
    if (!options?.refresh && this.cached && this.now() - this.cached.at < CATALOG_TTL_MS) return this.cached.catalog;
    if (!options?.refresh && this.inflight) return this.waitOn(this.inflight.promise, options?.signal);
    const sequence = ++this.sequence, promise = this.buildCatalog();
    this.inflight = { sequence, promise };
    try {
      const catalog = await promise;
      if (this.inflight?.sequence === sequence) this.cached = { catalog, at: this.now() };
      return catalog;
    } finally { if (this.inflight?.sequence === sequence) this.inflight = undefined; }
  }
  /** A disconnected subscriber abandons its own wait; the coalesced probe keeps
   * running for every other caller and is bounded by its own timeout. */
  private waitOn(promise: Promise<TerminalShellCatalog>, signal?: AbortSignal): Promise<TerminalShellCatalog> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))]);
  }
  private windowsName(name: string, fallback: string): string {
    const entries = Object.entries(this.env), match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] || fallback;
  }
  private systemRoot() { return this.windowsName('SystemRoot', 'C:\\Windows'); }
  private systemCmdCandidates() {
    const root = this.systemRoot();
    return [...new Set([`${root}\\System32\\cmd.exe`, 'C:\\Windows\\System32\\cmd.exe'])];
  }
  private pathDirs(): string[] {
    const value = this.windowsName('PATH', '');
    return value.split(';').map(dir => dir.trim()).filter(dir => windowsDrivePath.test(dir));
  }
  private pwshCandidates() {
    const programFiles = this.windowsName('ProgramFiles', 'C:\\Program Files');
    return [`${programFiles}\\PowerShell\\7\\pwsh.exe`, ...this.pathDirs().map(dir => `${dir}\\pwsh.exe`)];
  }
  private powershellCandidates() { return [`${this.systemRoot()}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`]; }
  private gitRoots(): string[] {
    const roots: string[] = [], push = (root: string) => { if (!roots.includes(root)) roots.push(root); };
    for (const gitExe of [this.env.HARNESS_BUNDLED_GIT, fileURLToPath(new URL('../../.harness-tool-bundles/git/cmd/git.exe', import.meta.url))]) {
      if (gitExe && /[\\/]cmd[\\/]git\.exe$/i.test(gitExe) && this.exists(gitExe)) push(gitExe.replace(/[\\/]cmd[\\/]git\.exe$/i, ''));
    }
    push(`${this.windowsName('ProgramFiles', 'C:\\Program Files')}\\Git`);
    if (this.windowsName('ProgramFiles(x86)', '')) push(`${this.windowsName('ProgramFiles(x86)', '')}\\Git`);
    if (this.windowsName('LOCALAPPDATA', '')) push(`${this.windowsName('LOCALAPPDATA', '')}\\Programs\\Git`);
    for (const dir of this.pathDirs()) {
      if (/[\\/]Git[\\/](?:cmd|bin)$/i.test(dir) && this.exists(`${dir}\\git.exe`)) push(dir.replace(/[\\/](?:cmd|bin)$/i, ''));
    }
    return roots;
  }
  private gitBashCandidate(): string | undefined {
    for (const root of this.gitRoots()) for (const candidate of [`${root}\\bin\\bash.exe`, `${root}\\usr\\bin\\bash.exe`]) if (this.exists(candidate)) return candidate;
    return undefined;
  }
  private wslExe() { return `${this.systemRoot()}\\System32\\wsl.exe`; }
  /** wsl.exe --list --quiet emits UTF-16LE on Windows; accept BOM, the zero-byte
   * pattern or UTF-8, then bound, validate and deduplicate the names. */
  private decodeDistros(bytes: Uint8Array): string[] {
    let text: string;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    else {
      const sample = bytes.subarray(0, Math.min(64, bytes.length));
      let zeros = 0, pairs = 0;
      for (let index = 1; index < sample.length; index += 2) { pairs++; if (sample[index] === 0) zeros++; }
      text = pairs > 0 && zeros / pairs > 0.5 ? new TextDecoder('utf-16le').decode(bytes) : new TextDecoder('utf-8').decode(bytes);
    }
    const names: string[] = [];
    for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
      const name = line.replace(/\0/g, '').trim();
      if (!name || !wslDistroSchema.safeParse(name).success || names.includes(name)) continue;
      names.push(name);
      if (names.length >= MAX_DISTROS) break;
    }
    return names;
  }
  private async listDistros(): Promise<{ distributions: string[]; availability: 'available' | 'missing' | 'error'; reason?: string }> {
    try {
      const probe = await this.run(this.wslExe(), ['--list', '--quiet'], { cwd: this.systemRoot() + '\\System32', env: this.spawnEnv(), timeoutMs: PROBE_TIMEOUT_MS, maxBytes: MAX_PROBE_BYTES });
      if (probe.timedOut) return { distributions: [], availability: 'error', reason: 'Listing WSL distributions timed out.' };
      if (probe.code !== 0) return { distributions: [], availability: 'error', reason: 'WSL distributions could not be listed.' };
      const distributions = this.decodeDistros(probe.stdout);
      return distributions.length ? { distributions, availability: 'available' } : { distributions, availability: 'missing', reason: 'No WSL distributions are installed.' };
    } catch { return { distributions: [], availability: 'error', reason: 'WSL distributions could not be listed.' }; }
  }
  private async buildCatalog(): Promise<TerminalShellCatalog> {
    if (this.platform !== 'win32') {
      const platform = this.platform === 'linux' || this.platform === 'darwin' ? this.platform : 'other';
      return {
        platform,
        options: [
          { kind: 'default', label: 'System shell', availability: 'available' },
          { kind: 'cmd', label: OPTION_LABELS.cmd, availability: 'unsupported', reason: WINDOWS_ONLY },
          { kind: 'pwsh', label: OPTION_LABELS.pwsh, availability: 'unsupported', reason: WINDOWS_ONLY },
          { kind: 'powershell', label: OPTION_LABELS.powershell, availability: 'unsupported', reason: WINDOWS_ONLY },
          { kind: 'git-bash', label: OPTION_LABELS['git-bash'], availability: 'unsupported', reason: WINDOWS_ONLY },
          { kind: 'wsl', label: OPTION_LABELS.wsl, availability: 'unsupported', reason: WINDOWS_ONLY },
        ],
        wsl: { distributions: [], availability: 'unsupported', reason: WINDOWS_ONLY },
      };
    }
    const comspec = this.env.COMSPEC, comspecOk = Boolean(comspec && absoluteExe.test(comspec) && this.exists(comspec));
    const systemCmd = this.systemCmdCandidates().find(candidate => this.exists(candidate));
    const pwsh = this.pwshCandidates().find(candidate => this.exists(candidate));
    const powershell = this.powershellCandidates().find(candidate => this.exists(candidate));
    const gitBash = this.gitBashCandidate();
    const wsl = this.exists(this.wslExe()) ? await this.listDistros() : { distributions: [] as string[], availability: 'missing' as const, reason: 'WSL (wsl.exe) was not found on this system.' };
    return {
      platform: 'win32',
      options: [
        { kind: 'default', label: OPTION_LABELS.default, availability: comspecOk || systemCmd ? 'available' : 'missing', ...(!comspecOk && !systemCmd ? { reason: 'No command interpreter (cmd.exe) was found on this system.' } : {}) },
        { kind: 'cmd', label: OPTION_LABELS.cmd, availability: systemCmd ? 'available' : 'missing', ...(systemCmd ? {} : { reason: 'cmd.exe was not found under System32.' }) },
        { kind: 'pwsh', label: OPTION_LABELS.pwsh, availability: pwsh ? 'available' : 'missing', ...(pwsh ? {} : { reason: 'pwsh.exe was not found in its install location or on PATH.' }) },
        { kind: 'powershell', label: OPTION_LABELS.powershell, availability: powershell ? 'available' : 'missing', ...(powershell ? {} : { reason: 'powershell.exe was not found under System32.' }) },
        { kind: 'git-bash', label: OPTION_LABELS['git-bash'], availability: gitBash ? 'available' : 'missing', ...(gitBash ? {} : { reason: 'Git Bash (bash.exe inside a Git for Windows install) was not found.' }) },
        { kind: 'wsl', label: OPTION_LABELS.wsl, availability: wsl.availability, ...(wsl.reason ? { reason: wsl.reason } : {}) },
      ],
      wsl,
    };
  }
  private nativeDescriptor(selection: TerminalShellSelection, bindingPath: string, configured: Record<string, string>): TerminalShellDescriptor {
    return {
      file: this.env.SHELL ?? '/bin/sh', args: [], cwd: bindingPath,
      env: { ...this.spawnEnv(), ...configured },
      shell: { kind: 'default', label: 'System shell', ...(selection.kind !== 'default' ? { notice: 'Windows shell selection is unavailable on this host; using the system shell.' } : {}) },
    };
  }
  private unavailable(label: string): never {
    throw new HarnessError('TERMINAL_SHELL_UNAVAILABLE', `${label} is no longer available. Choose another terminal shell in Settings and try again.`);
  }
  async resolve(selection: TerminalShellSelection, bindingPath: string, configured: Record<string, string>): Promise<TerminalShellDescriptor> {
    if (this.platform !== 'win32') return this.nativeDescriptor(selection, bindingPath, configured);
    const env = { ...this.spawnEnv(), ...configured };
    const pick = (kind: 'pwsh' | 'powershell' | 'git-bash', candidates: (string | undefined)[], args: string[], extra: Record<string, string> = {}): TerminalShellDescriptor => {
      const file = candidates.find(candidate => candidate && this.exists(candidate));
      if (!file) this.unavailable(OPTION_LABELS[kind]);
      return { file: file!, args, cwd: bindingPath, env: { ...env, ...extra }, shell: { kind, label: OPTION_LABELS[kind] } };
    };
    switch (selection.kind) {
      case 'default': {
        const comspec = this.env.COMSPEC, systemCmd = this.systemCmdCandidates().find(candidate => this.exists(candidate));
        if (comspec && absoluteExe.test(comspec) && this.exists(comspec)) {
          return { file: comspec, args: ['/D', '/Q'], cwd: bindingPath, env, shell: { kind: 'cmd', label: OPTION_LABELS.default }, ...(systemCmd ? { fallback: { file: systemCmd, args: ['/D', '/Q'] } } : {}) };
        }
        if (!systemCmd) this.unavailable(OPTION_LABELS.cmd);
        return { file: systemCmd!, args: ['/D', '/Q'], cwd: bindingPath, env, shell: { kind: 'cmd', label: OPTION_LABELS.cmd } };
      }
      case 'cmd': {
        const file = this.systemCmdCandidates().find(candidate => this.exists(candidate));
        if (!file) this.unavailable(OPTION_LABELS.cmd);
        return { file: file!, args: ['/D', '/Q'], cwd: bindingPath, env, shell: { kind: 'cmd', label: OPTION_LABELS.cmd } };
      }
      case 'pwsh': return pick('pwsh', this.pwshCandidates(), ['-NoLogo']);
      case 'powershell': return pick('powershell', this.powershellCandidates(), ['-NoLogo']);
      case 'git-bash': return pick('git-bash', [this.gitBashCandidate()], ['--login', '-i'], { CHERE_INVOKING: '1' });
      case 'wsl': return this.resolveWsl(selection, bindingPath, configured, env);
    }
  }
  private async resolveWsl(selection: { kind: 'wsl'; distro?: string }, bindingPath: string, configured: Record<string, string>, env: Record<string, string>): Promise<TerminalShellDescriptor> {
    const wslExe = this.wslExe();
    if (!this.exists(wslExe)) this.unavailable(OPTION_LABELS.wsl);
    if (!wslCompatibleBinding(bindingPath)) {
      throw new HarnessError('TERMINAL_CWD_UNSUPPORTED', 'This project folder cannot be opened in WSL because it is not on a local drive. Choose another terminal shell in Settings and try again.');
    }
    const listed = await this.listDistros();
    if (listed.availability === 'error') {
      throw new HarnessError('TERMINAL_SHELL_DISCOVERY_FAILED', 'WSL distributions could not be listed. Retry, or choose another terminal shell in Settings.');
    }
    if (!listed.distributions.length) this.unavailable(OPTION_LABELS.wsl);
    const distro = selection.distro;
    if (distro && !listed.distributions.includes(distro)) this.unavailable(`WSL (${distro})`);
    // Convert through the distro's own wslpath so custom automount layouts are honored.
    const conversion = await this.run(wslExe, [...(distro ? ['--distribution', distro] : []), '--exec', 'wslpath', '-a', '-u', bindingPath], { cwd: this.systemRoot() + '\\System32', env, timeoutMs: WSL_CONVERT_TIMEOUT_MS, maxBytes: MAX_PROBE_BYTES });
    const linuxCwd = new TextDecoder('utf-8').decode(conversion.stdout).replace(/[\r\n]+$/, '');
    // One nonempty absolute POSIX path: any remaining NUL/CR/LF or extra lines reject.
    const valid = !conversion.timedOut && conversion.code === 0 && linuxCwd.startsWith('/') && !/[\x00-\x1f\x7f]/.test(linuxCwd) && linuxCwd.length <= MAX_POSIX_PATH;
    if (!valid) throw new HarnessError('TERMINAL_CWD_UNAVAILABLE', 'The project folder could not be converted for WSL. Retry, or choose another terminal shell in Settings.');
    const wslEnv = Object.keys(configured).filter(name => !/^(?:PATH|HOME|WSLENV)$/i.test(name)).slice(0, 200).join(':');
    return {
      file: wslExe,
      args: [...(distro ? ['--distribution', distro] : []), '--cd', linuxCwd],
      cwd: bindingPath,
      env: { ...env, WSLENV: wslEnv },
      shell: { kind: 'wsl', label: distro ? `WSL (${distro})` : 'WSL', ...(distro ? { distro } : {}) },
    };
  }
}
