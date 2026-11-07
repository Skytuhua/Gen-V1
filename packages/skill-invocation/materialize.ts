import {realpath} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';
import {readBoundFile, withPathGuard} from '../core/file-access.ts';
import {catalogHash, type CatalogCustody} from '../skill-catalog/repository.ts';
import type {SkillReference} from '../contracts/skill-catalog.ts';

export const SKILL_INVOCATION_LIMITS = {skills: 8, files: 128, entryBytes: 256 * 1024, fileBytes: 1024 * 1024, packageBytes: 4 * 1024 * 1024} as const;
export interface CapturedFile {path: string; bytes: number; digest: string; data: string}
export interface CapturedSkill {reference: SkillReference; files: CapturedFile[]}
export type HarnessVersionReader = (record: {name: string; revision: number}) => Record<string, string>;

export function packagePath(value: string): boolean {
  return value.length > 0 && value.length <= 240 && value.split('/').every(part =>
    /^[A-Za-z0-9_. -]+$/.test(part) && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function checkFiles(files: readonly {path: string; bytes: number; digest: string}[]): void {
  if (!files.length || files.length > SKILL_INVOCATION_LIMITS.files || !files.some(file => file.path === 'SKILL.md') ||
    new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw Error('Unsupported package');
  let total = 0;
  for (const file of files) {
    if (!packagePath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      file.bytes > (file.path === 'SKILL.md' ? SKILL_INVOCATION_LIMITS.entryBytes : SKILL_INVOCATION_LIMITS.fileBytes) ||
      !/^[a-f0-9]{64}$/.test(file.digest)) throw Error('Unsupported file');
    total += file.bytes;
  }
  if (total > SKILL_INVOCATION_LIMITS.packageBytes) throw Error('Package limit');
}
export function verifyCaptured(capture: CapturedSkill): void {
  checkFiles(capture.files);
  for (const file of capture.files) {
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || bytes.length !== file.bytes || catalogHash(bytes) !== file.digest) throw Error('Changed capture');
  }
  if (catalogHash(capture.files.map(({path, bytes, digest}) => ({path, bytes, digest}))) !== capture.reference.digest) throw Error('Changed inventory');
}

/** Materialization uses host custody only. No path, loader, hook or tool from a skill is invoked. */
export async function materialize(reference: SkillReference, custody: CatalogCustody, signal: AbortSignal, current: () => void, recheck: () => Promise<CatalogCustody>, readHarnessVersion?: HarnessVersionReader): Promise<CapturedSkill> {
  current(); checkFiles(custody.files);
  if (catalogHash(custody) !== reference.sourceBinding || catalogHash(custody.files.map(({path, bytes, digest}) => ({path, bytes, digest}))) !== reference.digest) throw Error('Changed custody');
  const files: CapturedFile[] = [];
  const capture = (path: string, bytes: Buffer) => {
    current();
    const expected = custody.files.find(file => file.path === path);
    if (!expected || bytes.length !== expected.bytes || catalogHash(bytes) !== expected.digest) throw Error('Changed file');
    files.push({path, bytes: bytes.length, digest: expected.digest, data: bytes.toString('base64')});
  };
  const finish = async () => {
    current();
    const after = await recheck(); current();
    if (catalogHash(after) !== catalogHash(custody)) throw Error('Changed source');
    const result = {reference, files}; verifyCaptured(result); return result;
  };
  if (custody.kind === 'harness') {
    if (reference.sourceId !== 'harness:library' || !custody.record || !readHarnessVersion) throw Error('Unsupported Harness');
    const version = readHarnessVersion(custody.record);
    if (Object.keys(version).length !== custody.files.length) throw Error('Changed Harness inventory');
    for (const file of custody.files) {
      if (!Object.hasOwn(version, file.path) || typeof version[file.path] !== 'string' || Buffer.byteLength(version[file.path]) !== file.bytes) throw Error('Missing Harness file');
      capture(file.path, Buffer.from(version[file.path], 'utf8'));
    }
    return finish();
  }
  if (custody.kind !== 'filesystem' || !/^(?:personal|project|app|bundled):/.test(reference.sourceId) || !custody.root || custody.path !== custody.root || !custody.identity || custody.files.some(file => !file.identity)) throw Error('Unsupported source');
  const root = resolve(custody.root);
  if (root !== custody.root || await realpath(root) !== root) throw Error('Redirected root');
  current();
  return withPathGuard([{path: root, leaf: true, ...custody.identity}, {path: root, leaf: false, tree: true, readOnly: true}], signal, async manifest => {
    current();
    const actual = manifest.filter(entry => !entry.directory).map(entry => ({...entry, path: relative(root, entry.path).split(sep).join('/')}));
    if (actual.length !== custody.files.length || actual.some(entry => !custody.files.some(file => file.path === entry.path && file.bytes === entry.size && file.identity?.dev === entry.dev && file.identity.ino === entry.ino))) throw Error('Changed tree');
    for (const file of custody.files) {
      current();
      const bytes = await readBoundFile(join(root, ...file.path.split('/')), file.path === 'SKILL.md' ? SKILL_INVOCATION_LIMITS.entryBytes : SKILL_INVOCATION_LIMITS.fileBytes, {...file.identity!, size: file.bytes});
      capture(file.path, bytes);
    }
    return finish();
  });
}
