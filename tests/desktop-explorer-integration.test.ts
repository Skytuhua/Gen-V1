import {describe, expect, it} from 'vitest';
import {
  createExplorerIntegration,
  explorerCommandData,
  explorerIconData,
  EXPLORER_HIVE,
  EXPLORER_MARKER_KEY,
  EXPLORER_MARKER_VALUE,
  EXPLORER_MULTI_SELECT_MODEL,
  EXPLORER_VERB_KEYS,
  EXPLORER_VERB_LABEL,
  type RegistryExecFile,
} from '../apps/desktop/explorer-integration';

const EXE = 'C:\\Program Files\\Gen V1\\Gen V1.exe';
const NOT_FOUND = 'ERROR: The system was unable to find the specified registry key or value.';
const MARKER_FULL_KEY = `${EXPLORER_HIVE}\\${EXPLORER_MARKER_KEY}`;

interface RecordedCall { file: string; args: readonly string[]; options: { windowsHide: true; timeout: number } }

/** Minimal reg.exe fake: key set + per-key value maps, driven only by argument arrays. */
function fakeRegistry(seed: { keys?: string[]; values?: Record<string, Record<string, string>> } = {}) {
  const keys = new Set(seed.keys ?? []);
  const values = new Map<string, Map<string, string>>();
  for (const [key, entries] of Object.entries(seed.values ?? {})) values.set(key, new Map(Object.entries(entries)));
  const calls: RecordedCall[] = [];
  let plan: Array<'ok' | number> = [];
  const execFile: RegistryExecFile = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    const planned = plan.shift();
    if (planned !== undefined && planned !== 'ok') {
      throw Object.assign(new Error('reg.exe failed'), { code: planned, stdout: '', stderr: 'ERROR: Access is denied.' });
    }
    const missing = () => { throw Object.assign(new Error('reg.exe exited 1'), { code: 1, stdout: '', stderr: NOT_FOUND }); };
    const [op, key] = args;
    if (op === 'query') {
      if (args[2] === '/v') {
        const entry = values.get(key!)?.get(String(args[3]));
        if (entry === undefined) missing();
        return { stdout: `\n    ${String(args[3])}    ${entry}\n`, stderr: '' };
      }
      if (!keys.has(key!)) missing();
      return { stdout: `${key}\n`, stderr: '' };
    }
    if (op === 'add') {
      keys.add(key!);
      if (!values.has(key!)) values.set(key!, new Map());
      const slot = args.includes('/ve') ? '' : String(args[args.indexOf('/v') + 1]);
      const type = String(args[args.indexOf('/t') + 1]), raw = String(args[args.indexOf('/d') + 1]);
      // reg.exe query prints DWORD data hex-formatted; mirror that, not the raw /d input.
      values.get(key!)!.set(slot, type === 'REG_DWORD' ? `REG_DWORD    0x${Number(raw).toString(16).padStart(8, '0')}` : `${type}    ${raw}`);
      return { stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    if (op === 'delete') {
      // Real reg.exe exits 1 when the target key is absent.
      if (![...keys].some(existing => existing === key || existing.startsWith(`${key}\\`))) missing();
      for (const existing of [...keys]) if (existing === key || existing.startsWith(`${key}\\`)) keys.delete(existing);
      values.delete(key!);
      return { stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    throw Object.assign(new Error('reg.exe exited 1'), { code: 1, stdout: '', stderr: `ERROR: Invalid operation ${op}` });
  };
  return { calls, execFile, keys, values, setPlan: (next: Array<'ok' | number>) => { plan = next; } };
}

const service = (registry: ReturnType<typeof fakeRegistry>) =>
  createExplorerIntegration({ platform: 'win32', executable: EXE, execFile: registry.execFile });
const verbKey = (key: string) => `${EXPLORER_HIVE}\\${key}`;
const registered = (key: string, registry: ReturnType<typeof fakeRegistry>) => { registry.keys.add(verbKey(key)); registry.keys.add(`${verbKey(key)}\\command`); };
const fullyRegistered = (registry: ReturnType<typeof fakeRegistry>) => { for (const key of EXPLORER_VERB_KEYS) registered(key, registry); };
const marker = (value: 0 | 1) => ({ values: { [MARKER_FULL_KEY]: { [EXPLORER_MARKER_VALUE]: `REG_DWORD    0x${value}` } } });
const queries = (calls: RecordedCall[]) => calls.filter(call => call.args[0] === 'query');
const writes = (calls: RecordedCall[]) => calls.filter(call => call.args[0] === 'add' || call.args[0] === 'delete');

describe('createExplorerIntegration read state', () => {
  it('reports disabled with an absent marker on an untouched registry', async () => {
    const registry = fakeRegistry();
    expect(await service(registry).get()).toEqual({ state: 'disabled', enabled: false, marker: null });
    expect(queries(registry.calls)).toHaveLength(EXPLORER_VERB_KEYS.length * 2 + 1);
  });

  it('reports enabled only when both verb command keys exist, and parses marker 1', async () => {
    const registry = fakeRegistry(marker(1));
    fullyRegistered(registry);
    expect(await service(registry).get()).toEqual({ state: 'enabled', enabled: true, marker: 1 });
  });

  it('reads an explicit opt-out marker 0 without inventing verbs', async () => {
    const registry = fakeRegistry(marker(0));
    fullyRegistered(registry);
    const status = await service(registry).get();
    expect(status.marker).toBe(0);
    expect(status.enabled).toBe(true);
  });

  it('reports partial when only one verb is registered', async () => {
    const registry = fakeRegistry();
    registered(EXPLORER_VERB_KEYS[0], registry);
    const status = await service(registry).get();
    expect(status).toEqual({ state: 'partial', enabled: false, marker: null });
  });

  it('reports partial for a stale verb key left without its command subkey', async () => {
    const registry = fakeRegistry();
    fullyRegistered(registry);
    registry.keys.delete(`${verbKey(EXPLORER_VERB_KEYS[1])}\\command`);
    expect((await service(registry).get()).state).toBe('partial');
  });

  it('reports unknown, never a guess, when reg.exe is missing', async () => {
    const execFile: RegistryExecFile = async () => { throw Object.assign(new Error('spawn reg.exe ENOENT'), { code: 'ENOENT' }); };
    const status = await createExplorerIntegration({ platform: 'win32', executable: EXE, execFile }).get();
    expect(status).toEqual({ state: 'unknown', enabled: false, marker: null });
  });

  it('reports unknown on a nonzero registry failure that is not key-absent', async () => {
    const registry = fakeRegistry();
    registry.setPlan([2]);
    expect((await service(registry).get()).state).toBe('unknown');
  });
});

describe('createExplorerIntegration set(true)', () => {
  it('writes both verbs, label/icon/model/command data, and marker 1 — argument arrays only', async () => {
    const registry = fakeRegistry();
    const status = await service(registry).set(true);
    expect(status.enabled).toBe(true);
    const adds = writes(registry.calls);
    for (const key of EXPLORER_VERB_KEYS) {
      const full = verbKey(key);
      expect(adds.map(call => call.args)).toContainEqual(['add', full, '/ve', '/t', 'REG_SZ', '/d', EXPLORER_VERB_LABEL, '/f']);
      expect(adds.map(call => call.args)).toContainEqual(['add', full, '/v', 'Icon', '/t', 'REG_SZ', '/d', explorerIconData(EXE), '/f']);
      expect(adds.map(call => call.args)).toContainEqual(['add', full, '/v', 'MultiSelectModel', '/t', 'REG_SZ', '/d', EXPLORER_MULTI_SELECT_MODEL, '/f']);
      expect(adds.map(call => call.args)).toContainEqual(['add', `${full}\\command`, '/ve', '/t', 'REG_SZ', '/d', explorerCommandData(EXE), '/f']);
    }
    expect(adds.map(call => call.args)).toContainEqual(['add', MARKER_FULL_KEY, '/v', EXPLORER_MARKER_VALUE, '/t', 'REG_DWORD', '/d', '1', '/f']);
  });

  it('quotes the executable and preserves the literal %V placeholder with spaces intact', async () => {
    const registry = fakeRegistry();
    await service(registry).set(true);
    const datas = writes(registry.calls).flatMap(call => call.args.filter(arg => arg.includes(EXE)));
    expect(datas).toContain(`"${EXE}",0`);
    expect(datas).toContain(`"${EXE}" --open-project "%V"`);
    for (const data of datas) expect(data.startsWith('"') && data.split('"').length >= 3).toBe(true);
  });

  it('never invokes a shell or touches HKLM — every call is reg.exe with an argument array', async () => {
    const registry = fakeRegistry();
    await service(registry).set(true);
    await service(registry).set(false);
    for (const call of registry.calls) {
      expect(call.file).toBe('reg.exe');
      expect(Array.isArray(call.args)).toBe(true);
      for (const arg of call.args) expect(arg).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE/);
      expect(call.options).toMatchObject({ windowsHide: true });
    }
  });
});

describe('createExplorerIntegration set(false)', () => {
  it('deletes only the two owned verb keys and writes marker 0', async () => {
    const registry = fakeRegistry();
    fullyRegistered(registry);
    const status = await service(registry).set(false);
    expect(status).toEqual({ state: 'disabled', enabled: false, marker: 0 });
    const deletes = writes(registry.calls).filter(call => call.args[0] === 'delete').map(call => call.args[1]);
    expect(deletes).toEqual(EXPLORER_VERB_KEYS.map(verbKey));
    for (const key of EXPLORER_VERB_KEYS) {
      expect(registry.keys.has(verbKey(key))).toBe(false);
      expect(registry.keys.has(`${verbKey(key)}\\command`)).toBe(false);
    }
    expect(registry.values.get(MARKER_FULL_KEY)?.get(EXPLORER_MARKER_VALUE)).toContain('0x0');
  });

  it('stays idempotent when the verbs are already absent — real reg.exe errors on missing deletes', async () => {
    const registry = fakeRegistry();
    const status = await service(registry).set(false);
    expect(status).toEqual({ state: 'disabled', enabled: false, marker: 0 });
    expect(registry.values.get(MARKER_FULL_KEY)?.get(EXPLORER_MARKER_VALUE)).toContain('0x0');
  });

  it('leaves unrelated marker-key values alone', async () => {
    const registry = fakeRegistry();
    fullyRegistered(registry);
    registry.values.set(MARKER_FULL_KEY, new Map([['Unrelated', 'REG_SZ    keep']]));
    await service(registry).set(false);
    expect(registry.values.get(MARKER_FULL_KEY)?.get('Unrelated')).toBe('REG_SZ    keep');
  });
});

describe('createExplorerIntegration failure surfaces', () => {
  it('rejects a partial write and leaves the actual registry state readable', async () => {
    const registry = fakeRegistry();
    registry.setPlan(['ok', 'ok', 'ok', 'ok', 1]);
    await expect(service(registry).set(true)).rejects.toThrow('reg.exe add failed');
    // The first verb made it in; the second never ran — the honest read says partial.
    expect((await service(registry).get()).state).toBe('partial');
  });

  it('rejects set on non-Windows and never reads the registry', async () => {
    const registry = fakeRegistry();
    const linux = createExplorerIntegration({ platform: 'linux', executable: '/usr/bin/gen', execFile: registry.execFile });
    await expect(linux.set(true)).rejects.toThrow('Windows');
    expect((await linux.get()).state).toBe('unknown');
    expect(registry.calls).toHaveLength(0);
  });
});
