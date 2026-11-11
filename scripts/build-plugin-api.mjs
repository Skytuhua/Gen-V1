import {build} from 'esbuild';
import ts from 'typescript';
import {copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const readme = '# Gen plug-in API v1\n\nPluginManifest, ConversationAdapter and PluginSurface are the public data contracts. Hosts export default {activate({dataDir,genVersion})}. The context contains no personal Store, runtime, account or credential manager. Frontends run in an opaque sandbox and share GenPluginUI presentation components; all operations cross its source-checked bridge. Host utilities provide single-writer profile leasing. Package installation requires a trusted SHA-256 inventory digest. See the public Gen plug-in guide for the full package format.\n';

async function validatePackage(stage, metadata) {
  const declarationRoots = [];
  for (const entry of Object.values(metadata.exports)) {
    for (const [kind, target] of Object.entries(entry)) {
      const path = resolve(stage, target);
      const within = relative(stage, path);
      if (isAbsolute(within) || within.startsWith('..') || !(await lstat(path)).isFile()) {
        throw new Error(`Invalid plug-in API export target: ${target}`);
      }
      if (kind === 'types') declarationRoots.push(path);
    }
  }
  // Resolve the emitted declarations themselves, before publication. In particular,
  // a .d.ts source dependency is not automatically copied by declaration emit.
  const options = {
    noEmit: true, allowImportingTsExtensions: true, skipLibCheck: false, types: [],
    moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2023,
    paths: {zod: [join(root, 'node_modules/zod')]},
  };
  const program = ts.createProgram(declarationRoots, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(`Plug-in API declaration validation failed.\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
    })}`);
  }
  for (const source of program.getSourceFiles()) {
    // External peer declarations and TypeScript's libraries may live outside the
    // stage. Every relative dependency of our declarations must remain inside it.
    const location = relative(stage, source.fileName);
    if (!isAbsolute(location) && !location.startsWith('..')) {
      for (const imported of ts.preProcessFile(source.text).importedFiles) {
        if (!imported.fileName.startsWith('.')) continue;
        const resolved = ts.resolveModuleName(imported.fileName, source.fileName, options, ts.sys).resolvedModule;
        const path = resolved && relative(stage, resolved.resolvedFileName);
        if (!resolved || isAbsolute(path) || path.startsWith('..') || !resolved.resolvedFileName.endsWith('.d.ts')) {
          throw new Error(`Plug-in API declaration dependency is missing or outside the package: ${imported.fileName}`);
        }
      }
    }
  }
  if (!(await readFile(join(stage, 'LICENSE'))).equals(await readFile(join(root, 'LICENSE')))) {
    throw new Error('Plug-in API LICENSE differs from the source license.');
  }
}

async function publish(stage, destination) {
  let previous;
  try {
    await lstat(destination);
    previous = await mkdtemp(join(dirname(destination), `.${basename(destination)}.backup-`));
    // Windows cannot rename over an existing directory, even an empty one.
    await rm(previous, {recursive: true});
    await rename(destination, previous);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (previous) throw error;
  }
  try {
    await rename(stage, destination);
  } catch (error) {
    if (previous) {
      try {
        await rename(previous, destination);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Plug-in API replacement failed; previous complete package is recoverable at ${previous}`);
      }
    }
    throw error;
  }
  if (previous) await rm(previous, {recursive: true, force: true});
}

/** Build into an empty sibling, validate it, then replace only this destination. */
export async function buildPluginApi(destination) {
  destination = resolve(destination);
  await mkdir(dirname(destination), {recursive: true});
  const stage = await mkdtemp(join(dirname(destination), `.${basename(destination)}.stage-`));
  try {
    await build({absWorkingDir: root, entryPoints: ['packages/plugins/contracts.ts'], outfile: join(stage, 'index.mjs'), bundle: true, format: 'esm', platform: 'neutral', external: ['zod'], target: 'es2022', sourcemap: false});
    await build({absWorkingDir: root, entryPoints: ['apps/server/profile-lease.ts'], outfile: join(stage, 'host-utilities.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node24', sourcemap: false});
    const result = spawnSync(process.execPath, [compiler, 'packages/plugins/contracts.ts', '--allowImportingTsExtensions', '--declaration', '--emitDeclarationOnly', '--rootDir', 'packages', '--outDir', join(stage, 'types'), '--skipLibCheck', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2023'], {cwd: root, stdio: 'inherit', windowsHide: true});
    if (result.error || result.status !== 0) throw new Error('Plug-in API declarations failed.', {cause: result.error});
    await writeFile(join(stage, 'host-utilities.d.ts'), 'export interface ProfileLease {dataDir:string;close():void}\nexport declare function acquireProfileLease(directory:string):ProfileLease;\n');
    const metadata = {
      name: '@gen-v1/plugin-api', version: '1.1.0', private: true, type: 'module',
      exports: {'.': {types: './types/plugins/contracts.d.ts', default: './index.mjs'}, './host-utilities': {types: './host-utilities.d.ts', default: './host-utilities.mjs'}},
      files: ['*.mjs', 'host-utilities.d.ts', 'types', 'README.md', 'LICENSE'],
      peerDependencies: {zod: '4.6.6'}, engines: {node: '>=24.10.0'},
    };
    await writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2));
    await writeFile(join(stage, 'README.md'), readme);
    await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
    await validatePackage(stage, metadata);
    await publish(stage, destination);
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildPluginApi(join(root, 'dist/plugin-api'));
}
