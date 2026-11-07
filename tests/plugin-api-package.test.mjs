import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {existsSync, realpathSync} from 'node:fs';
import {delimiter, dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const typescript = join(repository, 'node_modules/typescript/bin/tsc');
// Invoke pnpm's JavaScript entry directly, including on Windows (no cmd.exe quoting).
function pnpmEntry() {
  for (const directory of process.env.PATH.split(delimiter)) {
    for (const name of ['pnpm', 'pnpm.cmd', 'pnpm.CMD']) {
      const executable = join(directory, name);
      if (!existsSync(executable)) continue;
      const actual = realpathSync(executable);
      for (const candidate of [actual, join(dirname(actual), 'node_modules/pnpm/bin/pnpm.cjs'), join(dirname(actual), '../pnpm/bin/pnpm.cjs')]) {
        if (/\.[cm]?js$/.test(candidate) && existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('Pinned pnpm JavaScript entry must be available on PATH.');
}
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000});
  assert.equal(result.error, undefined, result.error?.message);
  return {...result, output: result.stdout + result.stderr};
}
function succeeds(args, cwd) {
  const result = run(args, cwd);
  assert.equal(result.status, 0, `${process.execPath} ${args.join(' ')}\n${result.output}`);
  return result.output;
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gen-plugin-api-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const path of ['scripts/build-plugin-api.mjs', 'packages/plugins/contracts.ts', 'packages/contracts', 'apps/server/profile-lease.ts', 'LICENSE']) {
    await mkdir(dirname(join(root, path)), {recursive: true});
    await cp(join(repository, path), join(root, path), {recursive: true});
  }
  await symlink(realpathSync(join(repository, 'node_modules')), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return {root, output: join(root, 'dist/plugin-api'), build: () => run(['scripts/build-plugin-api.mjs'], root)};
}
async function snapshot(directory) {
  const entries = {};
  for (const item of await readdir(directory, {withFileTypes: true})) {
    if (item.isDirectory()) {
      for (const [name, value] of Object.entries(await snapshot(join(directory, item.name)))) entries[`${item.name}/${name}`] = value;
    } else entries[item.name] = (await readFile(join(directory, item.name))).toString('base64');
  }
  return entries;
}
const manifest = {
  id: 'example', name: 'Example', version: '1.0.0', apiVersion: 1, compatibleGenVersions: '>=0.6.5',
  frontendEntry: 'frontend/index.html', hostEntry: 'host/index.mjs',
  skills: [{id: 'example', scope: 'personal', entry: 'skills/example/SKILL.md', files: ['skills/example/SKILL.md']}],
};

test('fresh package compiles and preserves skill metadata', async t => {
  const {root, output, build} = await fixture(t);
  const result = build();
  assert.equal(result.status, 0, result.output);
  assert.ok(existsSync(join(output, 'types/plugins/contracts.d.ts')));
  await t.test('packed package resolves Bundler and NodeNext declarations', async () => {
    const pnpm = pnpmEntry();
    assert.equal(succeeds([pnpm, '--version'], root).trim(), '10.30.3');
    const archives = join(root, 'archives');
    await mkdir(archives);
    t.diagnostic(`command: pnpm pack --pack-destination ${archives} (cwd ${output})`);
    t.diagnostic(succeeds([pnpm, 'pack', '--pack-destination', archives], output).trim());
    const files = await readdir(archives);
    assert.equal(files.length, 1);
    const archive = join(archives, files[0]);
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    t.diagnostic(`archive: ${files[0]} sha256:${digest}`);
    // This directory is a sibling of the source fixture, with its own node_modules.
    const consumer = await mkdtemp(join(tmpdir(), 'gen-plugin-consumer-'));
    t.after(() => rm(consumer, {recursive: true, force: true}));
    await writeFile(join(consumer, 'package.json'), JSON.stringify({private: true, type: 'module', dependencies: {'@gen-v1/plugin-api': `file:${archive}`, zod: '4.6.6'}}));
    t.diagnostic(`command: pnpm install --ignore-scripts --strict-peer-dependencies (cwd ${consumer})`);
    t.diagnostic(succeeds([pnpm, 'install', '--ignore-scripts', '--strict-peer-dependencies'], consumer).trim());
    const installed = join(consumer, 'node_modules/@gen-v1/plugin-api');
    assert.ok(!realpathSync(installed).startsWith(root));
    const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(metadata.name, '@gen-v1/plugin-api');
    assert.equal(metadata.version, '1.1.0');
    assert.deepEqual(metadata.peerDependencies, {zod: '4.6.6'});
    assert.equal(JSON.parse(await readFile(join(consumer, 'node_modules/zod/package.json'), 'utf8')).version, '4.6.6');
    assert.equal(metadata.exports['.'].types, './types/plugins/contracts.d.ts');
    for (const entry of Object.values(metadata.exports)) {
      for (const key of ['types', 'default']) assert.ok(existsSync(join(installed, entry[key])), entry[key]);
    }
    assert.deepEqual(await readFile(join(installed, 'LICENSE')), await readFile(join(repository, 'LICENSE')));
    assert.ok(existsSync(join(installed, 'types/contracts/skill-catalog.d.ts')));
    assert.ok(!existsSync(join(installed, 'contracts.d.ts')));
    await writeFile(join(consumer, 'consumer.ts'), `import {pluginManifestSchema, type PluginManifest, type PluginHostModule} from '@gen-v1/plugin-api';\nimport {acquireProfileLease, type ProfileLease} from '@gen-v1/plugin-api/host-utilities';\nconst manifest: PluginManifest = ${JSON.stringify(manifest)};\nconst host: PluginHostModule = {async activate(context) { const directory: string = context.dataDir; return {operations: {}, async close() {}}; }};\nconst acquire: (directory: string) => ProfileLease = acquireProfileLease;\npluginManifestSchema.parse(manifest); void host; void acquire;\n`);
    for (const [resolution, module] of [['Bundler', 'ESNext'], ['NodeNext', 'NodeNext']]) {
      t.diagnostic(`command: tsc consumer.ts --noEmit --strict --skipLibCheck false --moduleResolution ${resolution} --module ${module} --target ES2023 --lib ES2023,DOM`);
      succeeds([typescript, 'consumer.ts', '--noEmit', '--strict', '--skipLibCheck', 'false', '--moduleResolution', resolution, '--module', module, '--target', 'ES2023', '--lib', 'ES2023,DOM'], consumer);
    }
    await writeFile(join(consumer, 'runtime.mjs'), `import assert from 'node:assert/strict';\nimport {pluginManifestSchema} from '@gen-v1/plugin-api';\nimport {acquireProfileLease} from '@gen-v1/plugin-api/host-utilities';\nconst manifest = ${JSON.stringify(manifest)};\nassert.deepEqual(pluginManifestSchema.parse(manifest).skills, manifest.skills);\nfor (const scope of ['provider', 'project', 'private']) assert.equal(pluginManifestSchema.safeParse({...manifest, skills: [{...manifest.skills[0], scope}]}).success, false);\nfor (const entry of ['../SKILL.md', 'skills/example/../SKILL.md', '/skills/example/SKILL.md']) assert.equal(pluginManifestSchema.safeParse({...manifest, skills: [{...manifest.skills[0], entry, files:[entry]}]}).success, false);\nassert.equal(typeof acquireProfileLease, 'function');\n`);
    const runtimeOutput = succeeds(['runtime.mjs'], consumer).trim();
    if (runtimeOutput) t.diagnostic(runtimeOutput);
  });
});

test('rebuild excludes stale declaration and sentinel', async t => {
  const {output, build} = await fixture(t);
  await mkdir(output, {recursive: true});
  await writeFile(join(output, 'contracts.d.ts'), '// stale declaration');
  await writeFile(join(output, 'sentinel.txt'), 'old output');
  const result = build();
  assert.equal(result.status, 0, result.output);
  assert.ok(!existsSync(join(output, 'contracts.d.ts')));
  assert.ok(!existsSync(join(output, 'sentinel.txt')));
});

test('failed build preserves previous complete package', async t => {
  const {root, output, build} = await fixture(t);
  assert.equal(build().status, 0);
  const previous = await snapshot(output);
  await writeFile(join(root, 'packages/plugins/contracts.ts'), '\nexport const invalidDeclaration: string = 42;\n', {flag: 'a'});
  const result = build();
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /TS2322/);
  assert.deepEqual(await snapshot(output), previous);
  assert.deepEqual(await readdir(dirname(output)), ['plugin-api']);
});

test('missing transitive declaration prevents publication', async t => {
  const {root, output, build} = await fixture(t);
  assert.equal(build().status, 0);
  const previous = await snapshot(output);
  // A declaration input is not copied by emitDeclarationOnly; the stage must reject this missing dependency.
  await writeFile(join(root, 'packages/contracts/external.d.ts'), 'export interface Missing {value: string}\n');
  await writeFile(join(root, 'packages/plugins/contracts.ts'), "\nexport type {Missing} from '../contracts/external.js';\n", {flag: 'a'});
  const result = build();
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /declaration|TS2307/i);
  assert.deepEqual(await snapshot(output), previous);
});

test('failed replacement restores previous package', async t => {
  const {root, output, build} = await fixture(t);
  assert.equal(build().status, 0);
  const previous = await snapshot(output);
  await writeFile(join(root, 'packages/plugins/contracts.ts'), '\nexport const replacementMarker = true;\n', {flag: 'a'});
  // Fault only the stage -> destination OS rename. All build and restore I/O remains real.
  await writeFile(join(root, 'replacement-failure.mjs'), `import fs from 'node:fs/promises';\nimport {syncBuiltinESMExports} from 'node:module';\nimport {resolve} from 'node:path';\nconst rename = fs.rename; let injected = false;\nfs.rename = async (from, to) => {if (!injected && resolve(to) === ${JSON.stringify(output)} && String(from).includes('.stage-')) {injected = true; const error = new Error('injected replacement failure'); error.code = 'EACCES'; throw error;} return rename(from, to);};\nsyncBuiltinESMExports();\nconst {buildPluginApi} = await import('./scripts/build-plugin-api.mjs');\ntry {await buildPluginApi(${JSON.stringify(output)}); throw new Error('replacement unexpectedly succeeded');} catch (error) {if (!injected || !String(error).includes('injected replacement failure')) throw error;}\n`);
  succeeds(['replacement-failure.mjs'], root);
  assert.deepEqual(await snapshot(output), previous);
  assert.deepEqual(await readdir(dirname(output)), ['plugin-api']);
});
