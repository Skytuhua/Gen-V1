import { expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REQUIRED_RUNTIME_FILES, runtimeSourceAllowed, stageRepositoryMapParser, stageRuntimeInstall } from '../scripts/desktop-assets';

const parserFiles = ['package.json', 'lib/typescript.js', 'LICENSE.txt', 'ThirdPartyNoticeText.txt'];

it('preserves the pinned compiler development classification and unchanged lockfile while staging runtime sources', async () => {
  const host = await mkdtemp(join(tmpdir(), 'm04-repo-map-package-'));
  const originalPackage = await readFile('package.json', 'utf8'), originalLock = await readFile('pnpm-lock.yaml', 'utf8');
  try {
    await stageRuntimeInstall(resolve('.'), host);
    const pkg = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
    expect(pkg.dependencies.typescript).toBeUndefined(); expect(pkg.devDependencies.typescript).toBe('5.9.3');
    expect(await readFile(join(host, 'pnpm-lock.yaml'), 'utf8')).toBe(originalLock);
    expect(await readFile('package.json', 'utf8')).toBe(originalPackage); expect(await readFile('pnpm-lock.yaml', 'utf8')).toBe(originalLock);
    expect(REQUIRED_RUNTIME_FILES).toEqual(expect.arrayContaining(parserFiles.map(path => 'host/node_modules/typescript/' + path)));
    for (const path of ['packages/core/repository-map-tool.ts', 'packages/core/repository-map-host.ts', 'packages/workspace/repo-map.ts']) expect(runtimeSourceAllowed(path)).toBe(true);
  } finally { await rm(host, { recursive: true, force: true, maxRetries: 5 }); }
});

it('executes the repository map after relocating only the pinned parser closure without ambient module resolution', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'm04-parser-relocation-')), host = join(folder, 'stage'), moved = join(folder, 'relocated');
  try {
    await stageRuntimeInstall(resolve('.'), host);
    await stageRepositoryMapParser(resolve('.'), host);
    expect((await readdir(join(host, 'node_modules/typescript'))).sort()).toEqual(['LICENSE.txt', 'ThirdPartyNoticeText.txt', 'lib', 'package.json']);
    expect(await readdir(join(host, 'node_modules/typescript/lib'))).toEqual(['typescript.js']);
    for (const path of parserFiles) expect(Buffer.compare(await readFile(join(host, 'node_modules/typescript', path)), await readFile(join('node_modules/typescript', path)))).toBe(0);
    await mkdir(join(host, 'packages/workspace'), {recursive: true});
    await copyFile('packages/workspace/repo-map.ts', join(host, 'packages/workspace/repo-map.ts'));
    await writeFile(join(host, 'probe.mjs'), `
      import {createRequire} from 'node:module';
      import {realpathSync} from 'node:fs';
      import {fileURLToPath} from 'node:url';
      import {buildRepoMap, REPO_MAP_PARSER} from './packages/workspace/repo-map.ts';
      const expected = fileURLToPath(new URL('./node_modules/typescript/lib/typescript.js', import.meta.url));
      const resolved = createRequire(import.meta.url).resolve('typescript');
      if (realpathSync(resolved) !== realpathSync(expected)) throw new Error('Parser resolved outside the relocated stage.');
      const result = buildRepoMap(['src/example.ts'], () => 'import {value} from "./dep";\\nexport const result = value;');
      process.stdout.write(JSON.stringify({parser: REPO_MAP_PARSER, result}));
    `);
    await rename(host, moved);
    const {stdout} = await promisify(execFile)(process.execPath, [join(moved, 'probe.mjs')], {
      cwd: moved, env: {...process.env, NODE_PATH: '', NODE_OPTIONS: ''}, timeout: 10_000,
    });
    expect(JSON.parse(stdout)).toEqual({parser: 'typescript@5.9.3', result: {omittedFiles: 0, files: [
      {path: 'src/example.ts', mode: 'PARSED', imports: ['./dep'], exports: [{name: 'result', line: 2}]},
    ]}});
  } finally { await rm(folder, {recursive: true, force: true, maxRetries: 5}); }
});

it.each(['lib/typescript.js', 'ThirdPartyNoticeText.txt'])('refuses altered pinned %s bytes before staging any parser output', async path => {
  const folder = await mkdtemp(join(tmpdir(), 'm04-parser-mutation-')), root = join(folder, 'source'), host = join(folder, 'host');
  try {
    await mkdir(join(root, 'node_modules/typescript/lib'), {recursive: true}); await mkdir(host);
    await writeFile(join(root, 'package.json'), JSON.stringify({devDependencies: {typescript: '5.9.3'}}));
    for (const file of parserFiles) await copyFile(join('node_modules/typescript', file), join(root, 'node_modules/typescript', file));
    const changed = await readFile(join(root, 'node_modules/typescript', path)); changed[0] = changed[0]! ^ 1;
    await writeFile(join(root, 'node_modules/typescript', path), changed);
    await expect(stageRepositoryMapParser(root, host)).rejects.toThrow('Pinned repository-map parser bytes changed: ' + path);
    expect(await readdir(host)).toEqual([]);
  } finally { await rm(folder, {recursive: true, force: true, maxRetries: 5}); }
});
