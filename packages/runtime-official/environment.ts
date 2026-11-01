import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isOfficialRuntimeProviderId, type OfficialRuntimeProviderId } from '../contracts/connections.ts';
import { HarnessError } from '../contracts/index.ts';

export type OfficialProvider = OfficialRuntimeProviderId;
const require = createRequire(import.meta.url);

/** Resolve the pinned, published distribution. Never discover a command through PATH. */
export function officialRuntimeCommand(provider: OfficialProvider): { file: string; args: string[] } {
  if (provider === 'gemini-cli') return { file: process.execPath, args: [join(dirname(require.resolve('@google/gemini-cli/package.json')), 'bundle', 'gemini.js')] };
  if (provider === 'cursor-sdk') return { file: process.execPath, args: ['--import', pathToFileURL(require.resolve('tsx')).href, fileURLToPath(new URL('./cursor-worker.ts', import.meta.url))] };
  if (provider === 'claude-code') {
    const sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
    const platform = `${process.platform}-${process.arch}`;
    const packagePath = sdkRequire.resolve(`@anthropic-ai/claude-agent-sdk-${platform}/package.json`);
    return { file: join(dirname(packagePath), process.platform === 'win32' ? 'claude.exe' : 'claude'), args: [] };
  }
  throw new Error('Unsupported official runtime provider.');
}

export function officialRuntimeHome(dataDir: string, provider: OfficialProvider): string {
  if (!isOfficialRuntimeProviderId(provider)) throw new Error('Unsupported official runtime provider.');
  return resolve(dataDir, 'official', provider, 'home');
}

/** Authentication is owned by each unmodified CLI. No credential or endpoint is inherited. */
export function officialRuntimeEnvironment(dataDir: string, provider: OfficialProvider, workingDirectory?: string): NodeJS.ProcessEnv {
  const home = officialRuntimeHome(dataDir, provider);
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), TMP: join(home, 'tmp'), TEMP: join(home, 'tmp'), TMPDIR: join(home, 'tmp'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_CACHE_HOME: join(home, '.cache'), NO_COLOR: '1' });
  if (provider === 'claude-code') Object.assign(env, { CLAUDE_CONFIG_DIR: home, CLAUDE_AGENT_SDK_CLIENT_APP: 'generative-harness/0.4.1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
  else if (provider === 'gemini-cli') Object.assign(env, { GEMINI_CLI_HOME: home, GEMINI_CLI_NO_RELAUNCH: '1', GEMINI_TELEMETRY_ENABLED: 'false' });
  else if (provider === 'cursor-sdk') {
    // SDK initialization probes Git even with MCP-only model tools. Keep those
    // probes in its private workspace, never an unrelated ancestor checkout.
    // Git ignores a ceiling equal to cwd; its parent is the effective boundary.
    const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const ceiling = dirname(resolve(workingDirectory ?? home));
    if (ceiling.includes(delimiter)) throw new HarnessError('OFFICIAL_WORKSPACE_UNSUPPORTED', `Cursor storage path cannot contain "${delimiter}". Choose another storage folder.`);
    Object.assign(env, { GIT_CEILING_DIRECTORIES: ceiling, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullFile, GIT_CONFIG_SYSTEM: nullFile });
  } else throw new Error('Unsupported official runtime provider.');
  return env;
}
