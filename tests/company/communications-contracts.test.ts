import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import manifest from '../../packages/company-contracts/communications/v1/manifest.json';
import codec from '../../packages/company-contracts/communications/v1/golden/codec.json';
import commands from '../../packages/company-contracts/communications/v1/golden/commands.json';

const load = () => import('../../packages/company-contracts/communications/index.ts');
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const good = () => structuredClone(commands.vectors[0].command);

describe('pinned partial communication contract', () => {
  it('preserves the reviewed manifest and every raw bundle file', async () => {
    const api = await load();
    const root = new URL('../../packages/company-contracts/communications/v1/', import.meta.url);
    expect(sha(readFileSync(new URL('manifest.json', root)))).toBe(api.COMMUNICATION_CONTRACT_PIN.manifestSHA256);
    for (const [path, digest] of Object.entries(manifest.files)) {
      expect(sha(readFileSync(new URL(path, root))), path).toBe(digest);
    }
  });

  for (const vector of codec.vectors) it(`raw codec: ${vector.name}`, async () => {
    const api = await load();
    const raw = 'raw_hex' in vector ? Buffer.from(vector.raw_hex!, 'hex') : bytes(vector.raw_utf8!);
    if ('error' in vector) {
      expect(() => api.decodeJson(raw)).toThrow(vector.error);
    } else {
      const canonical = api.canonicalBytes(api.decodeJson(raw));
      expect(text(canonical)).toBe(vector.canonical_utf8);
      expect(sha(canonical)).toBe(vector.sha256);
    }
  });

  for (const vector of commands.vectors) it(`discussion data: ${vector.name}`, async () => {
    const {validateDiscussionCommand} = await load();
    const result = validateDiscussionCommand(bytes(JSON.stringify(vector.command)));
    if (vector.valid) {
      await expect(result).resolves.toMatchObject({argumentDigest: vector.argument_digest, executable: false});
    } else if ('error' in vector) {
      await expect(result).rejects.toThrow(String(vector.error));
    } else {
      await expect(result).rejects.toThrow();
    }
  });

  it('counts full wire whitespace, rather than only parsed or canonical size', async () => {
    const {decodeJson} = await load();
    expect(decodeJson(bytes('0' + ' '.repeat(32767)))).toBe(0);
    expect(() => decodeJson(bytes('0' + ' '.repeat(32768)))).toThrow('wire_limit');
  });

  it('accepts depth 64 and rejects depth 65, including object keys', async () => {
    const {decodeJson} = await load();
    expect(() => decodeJson(bytes('['.repeat(64) + '0' + ']'.repeat(64)))).not.toThrow();
    expect(() => decodeJson(bytes('['.repeat(65) + '0' + ']'.repeat(65)))).toThrow('depth_limit');
    expect(() => decodeJson(bytes('['.repeat(64) + '{"x":0}' + ']'.repeat(64)))).toThrow('depth_limit');
  });

  it('keeps prototype-looking JSON keys as data without changing prototypes', async () => {
    const {decodeJson, canonicalBytes} = await load();
    const value = decodeJson(bytes('{"__proto__":{"polluted":true},"constructor":0}'));
    expect(text(canonicalBytes(value))).toBe('{"__proto__":{"polluted":true},"constructor":0}');
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it.each([-0, NaN, Infinity, 1.5, 9007199254740992, {text: '\ud800'}, {'\udfff': 0}])(
    'rejects lossy object input before serialization: %j', async value => {
      const {canonicalBytes} = await load();
      expect(() => canonicalBytes(value)).toThrow();
    },
  );

  it('rejects cycles, sparse arrays, accessors and non-JSON objects without invoking getters', async () => {
    const {canonicalBytes} = await load();
    const cycle: unknown[] = []; cycle.push(cycle);
    let invoked = false;
    const accessor = Object.defineProperty({}, 'text', {enumerable: true, get() {invoked = true; return 'hidden';}});
    for (const value of [cycle, Array(1), accessor, new Date(), new Map(), {x: undefined}]) {
      expect(() => canonicalBytes(value)).toThrow();
    }
    expect(invoked).toBe(false);
  });

  it('never reflects submitted content in errors', async () => {
    const {decodeJson} = await load();
    let caught: unknown;
    try { decodeJson(bytes('{"PRIVATE_SENTINEL":')); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('PRIVATE_SENTINEL');
  });

  for (const location of ['root', 'scope', 'payload'] as const) {
    for (const field of ['actor', 'sender_role', 'approval', 'capabilities', 'generation']) {
      it(`rejects claimed ${field} in ${location}`, async () => {
        const {validateDiscussionCommand} = await load();
        const value = good();
        Object.assign(location === 'root' ? value : value[location], {[field]: 'owner'});
        await expect(validateDiscussionCommand(bytes(JSON.stringify(value)))).rejects.toThrow();
      });
    }
  }

  it.each(['assignment', 'attempt_started', 'checks_verified', 'approval_granted', 'publication_observed'])(
    'rejects trusted event class %s', async kind => {
      const {validateDiscussionCommand} = await load();
      const value = good(); value.payload.kind = kind;
      await expect(validateDiscussionCommand(bytes(JSON.stringify(value)))).rejects.toThrow();
    },
  );

  it('checks combined audience uniqueness/count in addition to the schema', async () => {
    const {validateDiscussionCommand} = await load();
    for (const observers of [['E11'], ['E12','E13','E14','E15','E16','E17','E18','E19']]) {
      const value = good(); value.payload.observer_employee_ids = observers;
      await expect(validateDiscussionCommand(bytes(JSON.stringify(value)))).rejects.toThrow('audience');
    }
  });

  it('binds argument digests to every field except command_id and returns immutable non-executable data', async () => {
    const {validateDiscussionCommand} = await load();
    const value = good();
    const first = await validateDiscussionCommand(bytes(JSON.stringify(value)));
    value.command_id = 'f7a3bb92-65d9-4945-a615-5109a7714313';
    const replay = await validateDiscussionCommand(bytes(JSON.stringify(value)));
    expect(replay.argumentDigest).toBe(first.argumentDigest);
    value.payload.body += ' Changed.';
    const changed = await validateDiscussionCommand(bytes(JSON.stringify(value)));
    expect(changed.argumentDigest).not.toBe(first.argumentDigest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.scope)).toBe(true);
    expect(first.executable).toBe(false);
  });
});
