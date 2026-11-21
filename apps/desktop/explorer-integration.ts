// Per-user Windows Explorer "Open in Gen V1" integration state (plan r1 T06/R03).
// The registry is the source of truth — never a synced preference. Every call
// goes through reg.exe by argument array via execFile; there is no shell, no
// native dependency, and no renderer-controlled key, value, or executable path.

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExplorerIntegrationState, ExplorerIntegrationStatus } from '../../packages/desktop-contract/index.ts';

export type { ExplorerIntegrationState, ExplorerIntegrationStatus };

/** The fixed registration schema — T05's NSIS include must reproduce this byte-for-byte (drift is guarded by tests). */
export const EXPLORER_HIVE = 'HKCU';
export const EXPLORER_VERB_KEYS = [
  'Software\\Classes\\Directory\\shell\\GenV1',
  'Software\\Classes\\Directory\\Background\\shell\\GenV1',
] as const;
export const EXPLORER_VERB_LABEL = 'Open in Gen V1';
export const EXPLORER_MULTI_SELECT_MODEL = 'Single';
export const EXPLORER_MARKER_KEY = 'Software\\Gen V1';
export const EXPLORER_MARKER_VALUE = 'ExplorerIntegration';
export const explorerIconData = (executable: string) => `"${executable}",0`;
export const explorerCommandData = (executable: string) => `"${executable}" --open-project "%V"`;

export interface ExplorerIntegrationService {
  get(): Promise<ExplorerIntegrationStatus>;
  set(enabled: boolean): Promise<ExplorerIntegrationStatus>;
}

export type RegistryExecFile = (file: string, args: readonly string[], options: { windowsHide: true; timeout: number }) =>
  Promise<{ stdout: string; stderr: string }>;

const REG_NOT_FOUND = /unable to find|not exist/i;
const QUERY_TIMEOUT_MS = 10_000;

export function createExplorerIntegration(deps: {
  platform?: string;
  executable?: string;
  execFile?: RegistryExecFile;
} = {}): ExplorerIntegrationService {
  const platform = deps.platform ?? process.platform;
  const executable = deps.executable ?? process.execPath;
  const execFile: RegistryExecFile = deps.execFile
    ?? (async (file, args, options) => {
      const result = await promisify(nodeExecFile)(file, [...args], options);
      return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    });
  const windows = platform === 'win32';

  const run = async (args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const result = await execFile('reg.exe', args, { windowsHide: true, timeout: QUERY_TIMEOUT_MS });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const cause = error as { code?: number | string; stdout?: string; stderr?: string };
      if (typeof cause.code === 'number') return { code: cause.code, stdout: cause.stdout ?? '', stderr: cause.stderr ?? '' };
      throw error;
    }
  };

  /** null = key/value absent; throws on real registry failures (spawn, denied, timeout). */
  const query = async (key: string, value?: string): Promise<string | null> => {
    const args = value === undefined ? ['query', key] : ['query', key, '/v', value];
    const result = await run(args);
    if (result.code === 0) return result.stdout;
    if (REG_NOT_FOUND.test(result.stderr)) return null;
    throw new Error(`reg.exe query failed (${result.code}): ${result.stderr.trim() || 'unknown error'}`);
  };

  const apply = async (args: readonly string[]): Promise<void> => {
    const result = await run(args);
    if (result.code !== 0) throw new Error(`reg.exe ${args[0]} failed (${result.code}): ${result.stderr.trim() || 'unknown error'}`);
  };

  /** Unregister is idempotent — deleting an already-absent verb still counts as success. */
  const remove = async (key: string): Promise<void> => {
    const result = await run(['delete', key, '/f']);
    if (result.code !== 0 && !REG_NOT_FOUND.test(result.stderr)) {
      throw new Error(`reg.exe delete failed (${result.code}): ${result.stderr.trim() || 'unknown error'}`);
    }
  };

  const readState = async (): Promise<ExplorerIntegrationStatus> => {
    // A verb counts as registered only when its command subkey exists; a verb
    // key left without its command is a partial/stale registration, not success.
    let registered = 0;
    let broken = false;
    for (const key of EXPLORER_VERB_KEYS) {
      const full = `${EXPLORER_HIVE}\\${key}`;
      const [verb, command] = await Promise.all([query(full), query(`${full}\\command`)]);
      if (verb !== null && command !== null) registered++;
      else if (verb !== null || command !== null) broken = true;
    }
    let marker: 0 | 1 | null = null;
    const markerOut = await query(`${EXPLORER_HIVE}\\${EXPLORER_MARKER_KEY}`, EXPLORER_MARKER_VALUE);
    if (markerOut !== null) {
      const parsed = /ExplorerIntegration\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(markerOut);
      if (parsed) marker = parseInt(parsed[1], 16) === 0 ? 0 : 1;
    }
    const complete = registered === EXPLORER_VERB_KEYS.length && !broken;
    return { state: complete ? 'enabled' : registered > 0 || broken ? 'partial' : 'disabled', enabled: complete, marker };
  };

  return {
    get: async () => {
      if (!windows) return { state: 'unknown', enabled: false, marker: null };
      try {
        return await readState();
      } catch {
        return { state: 'unknown', enabled: false, marker: null };
      }
    },
    set: async enabled => {
      if (!windows) throw new Error('Explorer integration is only available on Windows.');
      if (enabled) {
        for (const key of EXPLORER_VERB_KEYS) {
          const full = `${EXPLORER_HIVE}\\${key}`;
          await apply(['add', full, '/ve', '/t', 'REG_SZ', '/d', EXPLORER_VERB_LABEL, '/f']);
          await apply(['add', full, '/v', 'Icon', '/t', 'REG_SZ', '/d', explorerIconData(executable), '/f']);
          await apply(['add', full, '/v', 'MultiSelectModel', '/t', 'REG_SZ', '/d', EXPLORER_MULTI_SELECT_MODEL, '/f']);
          await apply(['add', `${full}\\command`, '/ve', '/t', 'REG_SZ', '/d', explorerCommandData(executable), '/f']);
        }
        await apply(['add', `${EXPLORER_HIVE}\\${EXPLORER_MARKER_KEY}`, '/v', EXPLORER_MARKER_VALUE, '/t', 'REG_DWORD', '/d', '1', '/f']);
      } else {
        for (const key of EXPLORER_VERB_KEYS) await remove(`${EXPLORER_HIVE}\\${key}`);
        await apply(['add', `${EXPLORER_HIVE}\\${EXPLORER_MARKER_KEY}`, '/v', EXPLORER_MARKER_VALUE, '/t', 'REG_DWORD', '/d', '0', '/f']);
      }
      try {
        return await readState();
      } catch {
        return { state: 'unknown', enabled: false, marker: null };
      }
    },
  };
}
