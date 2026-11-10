import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, version as esbuildVersion} from 'esbuild';

export const COMPANY_NODE_VERSION = '24.22.2';
const NODE_SHA256 = '48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75';
const roots = {ajv: '8.18.0', fastify: '5.12.7', zod: '4.6.6'};
const require = createRequire(import.meta.url);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, path: string) => {const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));};
async function ordinary(path: string, limit = 16 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw Error('Expected a bounded ordinary package input: ' + path);
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw Error('Package input changed while reading: ' + path);
  return bytes;
}

export function validateCompanyNodeArchive(bytes: Uint8Array) {
  if (sha(bytes) !== NODE_SHA256) throw Error('Pinned Linux Node archive checksum mismatch.');
}
export async function reserveCompanyPackage(outputRoot: string, version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid company package version.');
  await mkdir(outputRoot, {recursive: true});
  const target = resolve(outputRoot, `gen-v1-company-host-${version}-linux-x64`);
  for (const path of [target + '.tar.gz', target + '.tar.gz.sha256']) {
    try {await lstat(path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;}
    throw Error('Company package archive already exists; choose a new output root.');
  }
  try {await mkdir(target);} catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Company package destination already exists; choose a new output root.');
    throw error;
  }
  return target;
}

export async function bundleCompanyHost(sourceRoot: string) {
  const root = await realpath(sourceRoot), inputs: {path: string; bytes: number; sha256: string}[] = [];
  if (esbuildVersion !== '0.25.12') throw Error('Use the existing pinned esbuild 0.25.12.');
  const result = await build({
    absWorkingDir: root, entryPoints: ['apps/server/company-main.ts'], bundle: true, packages: 'external',
    platform: 'node', format: 'esm', target: 'node24', write: false, metafile: true,
    outfile: join(root, 'apps/server/company-main.mjs'), logLevel: 'silent',
    plugins: [{name: 'bounded-company-source', setup(builder) {
      builder.onLoad({filter: /\.(ts|json)$/}, async args => {
        if (!within(root, args.path) || await realpath(args.path) !== resolve(args.path)) throw Error('Company source leaves its root or uses a link.');
        const bytes = await ordinary(args.path, 2 * 1024 * 1024);
        inputs.push({path: relative(root, args.path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes)});
        return {contents: bytes.toString('utf8'), loader: args.path.endsWith('.json') ? 'json' : 'ts'};
      });
    }}],
  });
  const output = result.outputFiles[0];
  const externalPackages = [...new Set(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports
    .filter(item => item.external && !item.path.startsWith('node:'))
    .map(item => item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]))].sort();
  if (JSON.stringify(externalPackages) !== JSON.stringify(Object.keys(roots))) throw Error('Default company host dependency boundary changed; review before packaging.');
  for (const input of inputs) if (sha(await ordinary(join(root, input.path))) !== input.sha256) throw Error('Company source changed during compilation.');
  return {code: output.text, inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)), externalPackages};
}

type Dependency = {name: string; version: string; directory: string; installPath: string};
function packageFile(name: string, from: string) {
  const local = createRequire(from);
  try {return local.resolve(name + '/package.json');} catch {
    let path = dirname(local.resolve(name));
    while (dirname(path) !== path) {
      try {if (require(join(path, 'package.json')).name === name) return join(path, 'package.json');} catch { /* Walk to the installed package root. */ }
      path = dirname(path);
    }
    throw Error('Cannot locate installed production dependency: ' + name);
  }
}
export async function collectCompanyDependencies() {
  const found: Dependency[] = [];
  async function visit(name: string, from: string, installPath: string, ancestors: string[] = []) {
    const file = await realpath(packageFile(name, from)), pkg = JSON.parse((await ordinary(file)).toString('utf8'));
    if (pkg.name !== name || typeof pkg.version !== 'string' || found.length >= 256 || ancestors.includes(file)) throw Error('Invalid or cyclic installed production dependency.');
    found.push({name, version: pkg.version, directory: dirname(file), installPath});
    // Preserve each consumer's locked version; flattening changes fast-uri resolution.
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) await visit(dependency, file, installPath + '/node_modules/' + dependency, [...ancestors, file]);
  }
  for (const [name, version] of Object.entries(roots)) {
    await visit(name, fileURLToPath(import.meta.url), name);
    if (found.find(dependency => dependency.installPath === name)?.version !== version) throw Error('Pinned company dependency version changed: ' + name);
  }
  return found.sort((a, b) => a.installPath.localeCompare(b.installPath));
}

async function copyTree(source: string, target: string) {
  const info = await lstat(source);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Expected an ordinary package asset directory.');
  await mkdir(target, {recursive: true});
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) throw Error('Package asset links are not supported.');
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const input = join(source, entry.name), output = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(input, output);
    else {await ordinary(input); await copyFile(input, output);}
  }
}
const run = (file: string, args: string[]) => new Promise<void>((done, reject) => {
  const child = spawn(file, args, {stdio: 'inherit', windowsHide: true});
  child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(Error('Package archive command failed: ' + code)));
});

export async function packageCompanyHost(sourceRoot: string, outputRoot: string, nodeArchive: string) {
  const root = resolve(sourceRoot);
  if (within(root, resolve(outputRoot))) throw Error('Company package output must be outside its source tree.');
  const pkg = JSON.parse((await ordinary(join(root, 'package.json'))).toString('utf8'));
  const nodeBytes = await ordinary(nodeArchive, 100 * 1024 * 1024); validateCompanyNodeArchive(nodeBytes);
  const bundle = await bundleCompanyHost(root), dependencies = await collectCompanyDependencies();
  const target = await reserveCompanyPackage(outputRoot, pkg.version);
  await mkdir(join(target, 'apps/server'), {recursive: true});
  await writeFile(join(target, 'apps/server/company-main.mjs'), bundle.code, {flag: 'wx'});
  for (const input of bundle.inputs) {
    await mkdir(dirname(join(target, 'source', input.path)), {recursive: true});
    const bytes = await ordinary(join(root, input.path));
    if (sha(bytes) !== input.sha256) throw Error('Pinned source changed before staging.');
    await writeFile(join(target, 'source', input.path), bytes, {flag: 'wx'});
  }
  for (const dependency of dependencies) await copyTree(dependency.directory, join(target, 'node_modules', dependency.installPath));
  await copyTree(join(root, 'dist/web'), join(target, 'dist/web'));
  await copyFile(join(root, 'LICENSE'), join(target, 'LICENSE'));
  await mkdir(join(target, 'bin')); await mkdir(join(target, 'runtime'));
  const start = await ordinary(fileURLToPath(new URL('./company-host/start.sh', import.meta.url)));
  if (start.includes(13)) throw Error('Linux start script must use LF line endings.');
  await writeFile(join(target, 'bin/start.sh'), start, {flag: 'wx', mode: 0o755});
  await run('tar', ['-xJf', resolve(nodeArchive), '-C', join(target, 'runtime'), '--strip-components=1', `node-v${COMPANY_NODE_VERSION}-linux-x64/bin/node`, `node-v${COMPANY_NODE_VERSION}-linux-x64/LICENSE`]);
  await writeFile(join(target, 'package.json'), JSON.stringify({name: 'gen-v1-company-host', version: pkg.version, private: true, type: 'module', engines: {node: COMPANY_NODE_VERSION}, dependencies: roots}, null, 2) + '\n', {flag: 'wx'});
  const files: {path: string; bytes: number; sha256: string}[] = [];
  async function inventory(directory: string) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inventory(path);
      else {const bytes = await ordinary(path, 150 * 1024 * 1024); files.push({path: relative(target, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes)});}
    }
  }
  await inventory(target);
  await writeFile(join(target, 'manifest.json'), JSON.stringify({
    component: 'Gen company default status-only host', version: pkg.version, platform: 'linux-x64',
    node: {version: COMPANY_NODE_VERSION, archiveSHA256: NODE_SHA256}, compiler: {name: 'esbuild', version: esbuildVersion},
    entry: 'apps/server/company-main.mjs', sourceEntry: 'apps/server/company-main.ts', sourceInputs: bundle.inputs,
    lockSHA256: sha(await ordinary(join(root, 'pnpm-lock.yaml'))),
    dependencies: dependencies.map(({name, version, installPath}) => ({name, version, installPath})),
    managerComposed: false, hermesReference: {commit: 'c627ec84664d43e0b18b95d9d86d8963747d56c7', activated: false, bundled: false},
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }, null, 2) + '\n', {flag: 'wx'});
  const archive = target + '.tar.gz';
  await run('tar', ['-czf', archive, '-C', dirname(target), target.slice(dirname(target).length + 1)]);
  const digest = sha(await ordinary(archive, 200 * 1024 * 1024));
  await writeFile(archive + '.sha256', digest + '  ' + archive.split(/[\\/]/).at(-1) + '\n', {flag: 'wx'});
  return {directory: target, archive, sha256: digest, files: files.length, dependencies: dependencies.length};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--output-root' || args[2] !== '--node-archive') throw Error('Usage: package-company-host.ts --output-root <new directory> --node-archive <pinned Linux Node tar.xz>');
  console.log(JSON.stringify(await packageCompanyHost(resolve('.'), resolve(args[1]), resolve(args[3]))));
}
