import {afterEach, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {appendFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {promisify} from 'node:util';
import * as packaging from '../scripts/integration-assets.ts';

type LockedFile = {path: string; bytes: number; sha256: string};
type Member = {path: string; content: string};
type Distribution = {name: string; version: string; sourceUrl: string; wheelSha256: string};
type ProjectedFile = LockedFile & {source?: string; content?: string};
type Projection = {files: ProjectedFile[]; bytes: number; receipt: {
  version: 2; mode: 'wheel-canonical-record-v2'; sourceLockSha256: string;
  wheels: {name: string; version: string; sha256: string}[]; files: LockedFile[];
}};
type Collector = (root: string, options: {wheelDirectory: string; pythonExecutable: string}) => Promise<Projection>;
type Fixture = Awaited<ReturnType<typeof fixture>>;

const prefix = '.harness-integrations-python-deps/';
const python = process.env.HARNESS_HERMES_PYTHON ?? 'python';
const execute = promisify(execFile);
const roots: string[] = [];
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const alpha = 'fixture_alpha-1.0.0.dist-info';
const beta = 'fixture_beta-1.0.0.dist-info';
const lockPath = (root: string) => join(root, 'third-party/integrations/PYTHON_LOCK.json');

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true, maxRetries: 5});
});

// Test ZIPs are produced by Python's standard library, not a custom ZIP writer.
// Member timestamps are fixed so two fixture constructions produce identical bytes.
const zipScript = String.raw`
import base64, csv, hashlib, io, json, sys, warnings, zipfile
manifest, target, record_path = sys.argv[1:]
entries = json.load(open(manifest, encoding="utf-8"))
rows = []
for entry in entries:
    data = entry["content"].encode("utf-8")
    rows.append((entry["path"], "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), str(len(data))))
rows.append((record_path, "", ""))
record = io.StringIO(newline="")
csv.writer(record, lineterminator="\n").writerows(sorted(rows))
entries.append({"path": record_path, "content": record.getvalue()})
with warnings.catch_warnings():
    warnings.simplefilter("ignore", UserWarning)
    with zipfile.ZipFile(target, "w") as archive:
        for entry in entries:
            info = zipfile.ZipInfo(entry["path"], (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, entry["content"].encode("utf-8"))
`;

async function createWheel(root: string, path: string, members: Member[], distInfo: string) {
  const manifest = join(root, basename(path) + '.members.json');
  await writeFile(manifest, JSON.stringify(members));
  await execute(python, ['-I', '-S', '-B', '-c', zipScript, manifest, path, distInfo + '/RECORD'], {timeout: 15_000, maxBuffer: 64 * 1024});
  return sha(await readFile(path));
}

function wheelMembers(name: string, distInfo: string, module: string): Member[] {
  return [
    {path: module, content: `VALUE = ${JSON.stringify(name)}\n`},
    {path: distInfo + '/METADATA', content: `Metadata-Version: 2.4\nName: ${name}\nVersion: 1.0.0\n`},
    {path: distInfo + '/WHEEL', content: 'Wheel-Version: 1.0\nGenerator: owned-test-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n'},
    {path: distInfo + '/entry_points.txt', content: `[console_scripts]\n${name} = shared.${module.includes('alpha') ? 'alpha' : 'beta'}:main\n`},
    {path: distInfo + '/licenses/LICENSE', content: `Disposable ${name} fixture license.\n`},
  ];
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'integration-projection-')); roots.push(root);
  const wheelDirectory = join(root, 'wheels'); await mkdir(wheelDirectory);
  const members = [wheelMembers('fixture-alpha', alpha, 'shared/alpha.py'), wheelMembers('fixture-beta', beta, 'shared/beta.py')];
  const infos = [alpha, beta];
  const distributions: Distribution[] = [];
  const files: LockedFile[] = [];
  const originalContents = new Map<string, string>();
  for (let index = 0; index < members.length; index++) {
    const name = index === 0 ? 'fixture-alpha' : 'fixture-beta';
    const wheelName = infos[index].replace('.dist-info', '') + '-py3-none-any.whl';
    const wheelSha256 = await createWheel(root, join(wheelDirectory, wheelName), members[index], infos[index]);
    distributions.push({name, version: '1.0.0', sourceUrl: 'https://files.pythonhosted.org/packages/owned-fixture/' + wheelName, wheelSha256});
    for (const member of [...members[index], {path: infos[index] + '/INSTALLER', content: 'pip\n'}, ...(index === 0 ? [{path: infos[index] + '/REQUESTED', content: ''}] : [])]) {
      const path = prefix + member.path;
      files.push({path, bytes: Buffer.byteLength(member.content), sha256: sha(member.content)});
      originalContents.set(path, member.content);
      const target = join(root, path); await mkdir(dirname(target), {recursive: true}); await writeFile(target, member.content);
    }
    const oldRecord = `${infos[index]}/RECORD,,\n../../Scripts/${name}.exe,sha256=original-machine-wrapper,123\n`;
    files.push({path: prefix + infos[index] + '/RECORD', bytes: Buffer.byteLength(oldRecord), sha256: sha(oldRecord)});
    await writeFile(join(root, prefix, infos[index], 'RECORD'), 'different cache-generated RECORD\n');
    // pip marks each explicit URL requirement; these cache-only files are not
    // authority for the immutable application payload or its ownership map.
    await writeFile(join(root, prefix, infos[index], 'REQUESTED'), '');
    await writeFile(join(root, prefix, infos[index], 'direct_url.json'), JSON.stringify({url: distributions[index].sourceUrl, archive_info: {hashes: {sha256: wheelSha256}}}));
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const lock = {version: 1, python: '3.14', requirements: ['fixture-alpha==1.0.0'], distributions, files, bytes: files.reduce((total, file) => total + file.bytes, 0)};
  await mkdir(dirname(lockPath(root)), {recursive: true}); await writeFile(lockPath(root), JSON.stringify(lock, null, 2) + '\n');
  return {root, wheelDirectory, members, infos, lock, originalContents};
}

async function collect(value: Fixture) {
  const collector = (packaging as unknown as {collectCanonicalPythonPayload: Collector}).collectCanonicalPythonPayload;
  expect(typeof collector).toBe('function');
  return collector(value.root, {wheelDirectory: value.wheelDirectory, pythonExecutable: python});
}

async function rewriteWheel(value: Fixture, index: number, members: Member[]) {
  const distribution = value.lock.distributions[index];
  const path = join(value.wheelDirectory, basename(new URL(distribution.sourceUrl).pathname));
  distribution.wheelSha256 = await createWheel(value.root, path, members, value.infos[index]);
  await writeFile(lockPath(value.root), JSON.stringify(value.lock, null, 2) + '\n');
}

async function projectedBytes(file: ProjectedFile) {
  expect(Number(typeof file.source === 'string') + Number(typeof file.content === 'string')).toBe(1);
  return file.source === undefined ? Buffer.from(file.content!, 'utf8') : readFile(file.source);
}

describe('wheel-authenticated canonical Python packaging', () => {
  it('derives deterministic per-distribution RECORDs while preserving every original non-RECORD byte', async () => {
    const value = await fixture(), originalLock = await readFile(lockPath(value.root));
    const first = await collect(value), second = await collect(value);
    expect(first.receipt).toEqual(second.receipt);
    expect(first.receipt).toMatchObject({version: 2, mode: 'wheel-canonical-record-v2', sourceLockSha256: sha(originalLock)});
    expect(await readFile(lockPath(value.root))).toEqual(originalLock);
    expect(first.files.map(file => file.path).sort()).toEqual(value.lock.files.map(file => file.path).sort());
    expect(first.receipt.files).toEqual(first.files.map(({path, bytes, sha256}) => ({path, bytes, sha256})));
    expect(first.bytes).toBe(first.files.reduce((total, file) => total + file.bytes, 0));
    expect(first.receipt.wheels).toEqual(value.lock.distributions.map(dist => ({name: dist.name, version: dist.version, sha256: dist.wheelSha256})));
    for (const file of first.files) {
      const bytes = await projectedBytes(file);
      expect(bytes.length).toBe(file.bytes); expect(sha(bytes)).toBe(file.sha256);
      if (!file.path.endsWith('/RECORD')) expect(bytes.toString('utf8')).toBe(value.originalContents.get(file.path));
    }
    for (const [index, info] of value.infos.entries()) {
      const file = first.files.find(file => file.path === prefix + info + '/RECORD')!;
      const content = (await projectedBytes(file)).toString('utf8');
      // Fixture paths contain no CSV metacharacters. This only inspects output;
      // it does not implement the production parser.
      const rows = content.trimEnd().split(/\r?\n/).map(line => line.split(','));
      const own = value.lock.files.filter(file => file.path.startsWith(prefix + info + '/') || file.path === prefix + `shared/${index === 0 ? 'alpha' : 'beta'}.py`);
      expect(rows.map(row => row[0]).sort()).toEqual(own.map(file => file.path.slice(prefix.length)).sort());
      expect(rows.find(row => row[0] === info + '/RECORD')).toEqual([info + '/RECORD', '', '']);
      for (const locked of own.filter(file => !file.path.endsWith('/RECORD'))) {
        expect(rows.find(row => row[0] === locked.path.slice(prefix.length))).toEqual([locked.path.slice(prefix.length), 'sha256=' + Buffer.from(locked.sha256, 'hex').toString('base64url'), String(locked.bytes)]);
      }
      expect(content).not.toContain('Scripts/'); expect(content).not.toContain('direct_url.json');
    }
  });

  it('rejects an archive whose complete bytes do not match its pinned wheel hash', async () => {
    const value = await fixture();
    await appendFile(join(value.wheelDirectory, basename(new URL(value.lock.distributions[0].sourceUrl).pathname)), 'changed');
    await expect(collect(value)).rejects.toThrow(/wheel|archive|checksum|hash/i);
  });

  it.each(['../escape.py', '/absolute.py', 'C:/drive.py', '..\\escape.py'])('rejects unsafe authenticated ZIP member %s', async path => {
    const value = await fixture(); await rewriteWheel(value, 0, [...value.members[0], {path, content: 'escape = True\n'}]);
    await expect(collect(value)).rejects.toThrow(/path|travers|absolute|unsafe|member|archive|wheel/i);
  });

  it('rejects duplicate ZIP names even when their bytes match', async () => {
    const value = await fixture(); await rewriteWheel(value, 0, [...value.members[0], value.members[0][0]]);
    await expect(collect(value)).rejects.toThrow(/duplicate|collision|member|archive|wheel/i);
  });

  it('rejects a wheel that claims another distribution metadata directory', async () => {
    const value = await fixture(); await rewriteWheel(value, 0, [...value.members[0], value.members[1].find(member => member.path.endsWith('/METADATA'))!]);
    await expect(collect(value)).rejects.toThrow(/foreign|owner|distribution|dist-info|duplicate|wheel/i);
  });

  it('rejects foreign distribution metadata ownership after wheel data spreading', async () => {
    const value = await fixture();
    const foreign = value.members[1].find(member => member.path.endsWith('/licenses/LICENSE'))!;
    await rewriteWheel(value, 1, value.members[1].filter(member => member !== foreign));
    await rewriteWheel(value, 0, [...value.members[0], {...foreign, path: 'fixture_alpha-1.0.0.data/purelib/' + foreign.path}]);
    await expect(collect(value)).rejects.toThrow(/foreign|owner|distribution|dist-info|wheel/i);
  });

  it('rejects an own RECORD alias after wheel data spreading instead of generating duplicate self rows', async () => {
    const value = await fixture(), record = alpha + '/RECORD';
    const content = `${record},,\n../../Scripts/fixture-alpha.exe,sha256=original-machine-wrapper,123\n`;
    // Matching the original lock isolates the reserved RECORD ownership error.
    expect(value.lock.files.find(file => file.path === prefix + record)).toMatchObject({bytes: Buffer.byteLength(content), sha256: sha(content)});
    await rewriteWheel(value, 0, [...value.members[0], {path: 'fixture_alpha-1.0.0.data/purelib/' + record, content}]);
    await expect(collect(value)).rejects.toThrow(/record|self|bookkeeping|owner|wheel/i);
  });

  it('rejects two authenticated wheels claiming the same runtime file', async () => {
    const value = await fixture(); await rewriteWheel(value, 1, [...value.members[1], value.members[0][0]]);
    await expect(collect(value)).rejects.toThrow(/owner|duplicate|collision|covered|wheel/i);
  });

  it('requires authenticated wheel membership for every locked runtime file', async () => {
    const value = await fixture(); await rewriteWheel(value, 0, value.members[0].filter(member => member.path !== 'shared/alpha.py'));
    await expect(collect(value)).rejects.toThrow(/cover|owner|missing|member|unclaimed|wheel/i);
  });

  it('rejects a wheel member whose bytes conflict with the original runtime lock', async () => {
    const value = await fixture(); await rewriteWheel(value, 0, value.members[0].map(member => member.path === 'shared/alpha.py' ? {...member, content: 'CHANGED = True\n'} : member));
    await expect(collect(value)).rejects.toThrow(/checksum|hash|content|lock|wheel/i);
  });

  it.each(['shared/alpha.py', alpha + '/METADATA', alpha + '/INSTALLER', alpha + '/entry_points.txt', alpha + '/licenses/LICENSE', alpha + '/REQUESTED'])('rejects changed locked non-RECORD file %s', async path => {
    const value = await fixture(); await appendFile(join(value.root, prefix, path), 'tamper');
    await expect(collect(value)).rejects.toThrow(/checksum|hash|content|lock|payload|requested|installer/i);
  });

  it('rejects a missing locked runtime file', async () => {
    const value = await fixture(); await rm(join(value.root, prefix, 'shared/alpha.py'));
    await expect(collect(value)).rejects.toThrow(/missing|lock|file|payload|ENOENT/i);
  });

  it.each(['rogue.py', alpha + '/rogue.py', 'unknown-1.0.0.dist-info/direct_url.json'])('rejects undeclared cache runtime file %s', async path => {
    const value = await fixture(), target = join(value.root, prefix, path); await mkdir(dirname(target), {recursive: true}); await writeFile(target, 'undeclared');
    await expect(collect(value)).rejects.toThrow(/unexpected|unknown|undeclared|extra|payload|lock|file/i);
  });

  it.each(['rogue.py', alpha + '/direct_url.json', 'Scripts/rogue.exe', 'shared/__pycache__/alpha.cpython-314.pyc'])('rejects undeclared final staged file %s after a valid canonical stage', async path => {
    const value = await fixture(), projection = await collect(value), host = join(value.root, 'staged-host');
    await mkdir(join(host, 'third-party/integrations'), {recursive: true});
    await writeFile(join(host, 'third-party/integrations/NODE_LOCK.json'), JSON.stringify({version: 1, files: []}));
    const payload: packaging.IntegrationPayload = {files: projection.files, bytes: projection.bytes, integrations: 0, pythonProjection: projection.receipt};
    await packaging.stageIntegrationPayload(host, payload);
    await packaging.verifyIntegrationPayload(host, payload);
    for (const file of projection.files) expect(await readFile(join(host, file.path))).toEqual(await projectedBytes(file));
    const unexpected = join(host, prefix, path); await mkdir(dirname(unexpected), {recursive: true}); await writeFile(unexpected, 'not in the canonical final payload');
    await expect(packaging.verifyIntegrationPayload(host, payload)).rejects.toThrow(/unexpected|extra|payload|projection|canonical|file|differ/i);
  });

  it('rechecks an original locked source file immediately before staging', async () => {
    const value = await fixture(), projection = await collect(value), host = join(value.root, 'staged-host');
    await mkdir(join(host, 'third-party/integrations'), {recursive: true});
    await writeFile(join(host, 'third-party/integrations/NODE_LOCK.json'), JSON.stringify({version: 1, files: []}));
    await appendFile(join(value.root, prefix, 'shared/alpha.py'), 'changed after collection');
    const payload: packaging.IntegrationPayload = {files: projection.files, bytes: projection.bytes, integrations: 0, pythonProjection: projection.receipt};
    await expect(packaging.stageIntegrationPayload(host, payload)).rejects.toThrow(/source|checksum|hash|changed|payload/i);
  });
});
