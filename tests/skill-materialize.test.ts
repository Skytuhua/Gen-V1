import { mkdtempSync, rmSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SkillReference } from '../packages/contracts/skill-catalog.ts';
import { SKILL_INVOCATION_LIMITS, checkFiles, materialize, packagePath, verifyCaptured, type CapturedFile } from '../packages/skill-invocation/materialize.ts';
import { catalogHash, type CatalogCustody } from '../packages/skill-catalog/repository.ts';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const hash = 'a'.repeat(64);
const file = (path = 'SKILL.md', content = 'x') => ({ path, bytes: Buffer.byteLength(content), digest: catalogHash(Buffer.from(content)) });
const inventory = (files: { path: string; bytes: number; digest: string }[]) => files.map(({ path, bytes, digest }) => ({ path, bytes, digest }));

const reference = (sourceId: string, custody: CatalogCustody): SkillReference => ({
  version: 1, scope: { kind: 'personal' }, sourceId, skillId: 's', locator: hash, revision: hash,
  digest: catalogHash(inventory(custody.files)), sourceBinding: catalogHash(custody),
});

const capturedFile = (path: string, data: Buffer): CapturedFile => ({ path, bytes: data.length, digest: catalogHash(data), data: data.toString('base64') });

describe('packagePath', () => {
  it.each(['SKILL.md', 'a/b/c.txt', 'dir name/file-1_2.txt', 'a.b/c'])('accepts %j', path => {
    expect(packagePath(path)).toBe(true);
  });
  it.each([
    '', 'a//b', '.', '..', 'a/../b', 'a/./b', 'trailing./x', 'trailing /x', 'x/trailing.',
    'CON/x', 'con/x', 'prn.txt/x', 'aux', 'NUL', 'com1/x', 'lpt9/x', 'com10/x'.replace('com10', 'COM1'),
    'a<b', 'a>b', 'a:b', 'a|b', 'a?b', 'a*b', 'a"b', 'a\\b', 'x'.repeat(241),
  ])('rejects %j', path => {
    expect(packagePath(path)).toBe(false);
  });
  it('accepts a path exactly at the length bound', () => {
    expect(packagePath('x'.repeat(240))).toBe(true);
  });
});

describe('checkFiles', () => {
  it('accepts a minimal package', () => {
    expect(() => checkFiles([file()])).not.toThrow();
  });
  it.each([
    ['empty inventory', []],
    ['no SKILL.md', [file('other.txt')]],
    ['duplicate path ignoring case', [file(), { ...file('other.txt'), path: 'skill.md' }]],
    ['over the file count', Array.from({ length: SKILL_INVOCATION_LIMITS.files + 1 }, (_, index) => file(`f${index}`))],
  ])('rejects %s', (_name, files) => {
    expect(() => checkFiles(files)).toThrow('Unsupported package');
  });
  it.each([
    ['bad path', { ...file(), path: '../x' }],
    ['fractional bytes', { ...file(), bytes: 1.5 }],
    ['negative bytes', { ...file(), bytes: -1 }],
    ['SKILL.md over entry bound', { ...file(), bytes: SKILL_INVOCATION_LIMITS.entryBytes + 1 }],
    ['other file over bound', { ...file('big.bin'), bytes: SKILL_INVOCATION_LIMITS.fileBytes + 1 }],
    ['malformed digest', { ...file(), digest: 'zz' }],
  ])('rejects %s', (_name, bad) => {
    expect(() => checkFiles([bad])).toThrow(/Unsupported (file|package)/);
  });
  it('rejects a package over the total byte limit', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({ ...file(`f${index}`), bytes: SKILL_INVOCATION_LIMITS.fileBytes }));
    files.push({ ...file(), bytes: SKILL_INVOCATION_LIMITS.entryBytes });
    expect(() => checkFiles(files)).toThrow('Package limit');
  });
  it('accepts files at their byte bounds', () => {
    expect(() => checkFiles([
      { path: 'SKILL.md', bytes: SKILL_INVOCATION_LIMITS.entryBytes, digest: hash },
      { path: 'a.bin', bytes: SKILL_INVOCATION_LIMITS.fileBytes, digest: hash },
    ])).not.toThrow();
  });
});

describe('verifyCaptured', () => {
  const capture = () => ({
    reference: { version: 1 as const, scope: { kind: 'personal' as const }, sourceId: 'x', skillId: 's', locator: hash, revision: hash, digest: '', sourceBinding: hash },
    files: [capturedFile('SKILL.md', Buffer.from('# skill')), capturedFile('notes.md', Buffer.from('notes'))],
  });
  const valid = () => {
    const value = capture();
    value.reference.digest = catalogHash(inventory(value.files));
    return value;
  };
  it('accepts a faithful capture', () => {
    expect(() => verifyCaptured(valid())).not.toThrow();
  });
  it.each([
    ['data bytes', (value: any) => { value.files[0].data = Buffer.from('tampered').toString('base64'); }],
    ['declared bytes', (value: any) => { value.files[0].bytes += 1; }],
    ['declared digest', (value: any) => { value.files[0].digest = 'b'.repeat(64); }],
    ['non-canonical base64', (value: any) => { value.files[0].data += ' '; }],
  ])('rejects a changed %s', (_name, mutate) => {
    const value = valid();
    mutate(value);
    expect(() => verifyCaptured(value)).toThrow('Changed capture');
  });
  it('rejects a changed inventory digest', () => {
    const value = valid();
    value.reference.digest = 'c'.repeat(64);
    expect(() => verifyCaptured(value)).toThrow('Changed inventory');
  });
});

const harnessCustody = (version: Record<string, string>): CatalogCustody => ({
  kind: 'harness', record: { name: 'skill', revision: 1 }, binding: 'b',
  files: Object.entries(version).sort().map(([path, content]) => file(path, content)),
});

const noop = () => {};
const abort = () => new AbortController().signal;

describe('materialize (harness custody)', () => {
  const setup = () => {
    const version = { 'SKILL.md': '# skill', 'notes.md': 'notes' };
    const custody = harnessCustody(version);
    return { version, custody, ref: reference('harness:library', custody) };
  };
  it('captures every file with matching digests', async () => {
    const { version, custody, ref } = setup();
    const captured = await materialize(ref, custody, abort(), noop, async () => custody, () => version);
    expect(captured.files.map(item => item.path)).toEqual(['SKILL.md', 'notes.md']);
    expect(() => verifyCaptured(captured)).not.toThrow();
    expect(Buffer.from(captured.files[0].data, 'base64').toString()).toBe('# skill');
  });
  it.each([
    ['wrong sourceId', (ref: SkillReference) => { ref.sourceId = 'personal:x'; }],
    ['missing record', (_ref: SkillReference, custody: CatalogCustody) => { delete custody.record; }],
    ['missing reader', () => {}],
  ])('rejects %s', async (_name, mutate) => {
    const { version, custody } = setup();
    const ref = reference('harness:library', custody);
    mutate(ref, custody);
    const bound = _name === 'missing record' ? reference('harness:library', custody) : ref;
    const reader = _name === 'missing reader' ? undefined : () => version;
    await expect(materialize(bound, custody, abort(), noop, async () => custody, reader)).rejects.toThrow('Unsupported Harness');
  });
  it('rejects a custody that no longer matches the reference', async () => {
    const { version, custody, ref } = setup();
    custody.binding = 'changed';
    await expect(materialize(ref, custody, abort(), noop, async () => custody, () => version)).rejects.toThrow('Changed custody');
  });
  it('rejects when the harness inventory shrinks', async () => {
    const { version, custody, ref } = setup();
    await expect(materialize(ref, custody, abort(), noop, async () => custody, () => ({ 'SKILL.md': version['SKILL.md'] }))).rejects.toThrow('Changed Harness inventory');
  });
  it('rejects a file whose content changed in the harness', async () => {
    const { version, custody, ref } = setup();
    // Same byte length, different digest reaches the per-file hash check.
    await expect(materialize(ref, custody, abort(), noop, async () => custody, () => ({ ...version, 'notes.md': 'xxxxx' }))).rejects.toThrow('Changed file');
  });
  it('rejects a source that changed before recheck', async () => {
    const { version, custody, ref } = setup();
    const drift = { ...custody, binding: 'other' };
    await expect(materialize(ref, custody, abort(), noop, async () => drift, () => version)).rejects.toThrow('Changed source');
  });
});

describe('materialize (filesystem custody)', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'gen-skill-'));
    dirs.push(root);
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'SKILL.md'), '# skill');
    writeFileSync(join(root, 'sub', 'notes.md'), 'notes');
    const stat = (path: string) => ({ dev: String(lstatSync(path, { bigint: true }).dev), ino: String(lstatSync(path, { bigint: true }).ino) });
    const fileEntry = (path: string) => {
      const info = lstatSync(join(root, ...path.split('/')));
      return { path, bytes: Number(info.size), digest: catalogHash(Buffer.from('')), identity: { dev: String(info.dev), ino: String(info.ino) } };
    };
    const requireRead = (path: string) => path === 'SKILL.md' ? '# skill' : 'notes';
    const files = ['SKILL.md', 'sub/notes.md'].map(path => {
      const content = requireRead(path);
      return { ...fileEntry(path), bytes: Buffer.byteLength(content), digest: catalogHash(Buffer.from(content)) };
    });
    const custody: CatalogCustody = { kind: 'filesystem', root, path: root, identity: stat(root), files, binding: 'b' };
    return { root, custody, ref: reference('personal:library', custody) };
  };
  // The guarded filesystem path needs the platform path broker, unavailable on
  // this Linux VM; coverage stops at the checks that run before acquisition.
  it.each([
    ['bad sourceId', (ref: SkillReference) => { ref.sourceId = 'other:x'; }, false],
    ['path differs from root', (_ref: SkillReference, custody: CatalogCustody) => { custody.path = custody.root + '/sub'; }, true],
    ['missing root identity', (_ref: SkillReference, custody: CatalogCustody) => { delete custody.identity; }, true],
    ['file missing identity', (_ref: SkillReference, custody: CatalogCustody) => { delete custody.files[0].identity; }, true],
  ])('rejects %s', async (_name, mutate, rebind) => {
    const { custody } = setup();
    const ref = reference('personal:library', custody);
    mutate(ref, custody);
    const fresh = rebind ? reference('personal:library', custody) : ref;
    await expect(materialize(fresh, custody, abort(), noop, async () => custody)).rejects.toThrow('Unsupported source');
  });
  it('rejects a non-canonical root path', async () => {
    const { custody } = setup();
    custody.root += '/';
    custody.path = custody.root;
    const ref = reference('personal:library', custody);
    await expect(materialize(ref, custody, abort(), noop, async () => custody)).rejects.toThrow('Redirected root');
  });
});
