import {describe,it,expect} from 'vitest';
import {runtimeSourceAllowed,validateNodeArchive,desktopBuilderConfig,packageManagerInvocation,runtimeInstallArguments,stageRuntimeInstall,REQUIRED_RUNTIME_FILES} from '../scripts/desktop-assets.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

describe('desktop distribution custody',()=>{
 it('requires every fixed provider entry and published distribution before accepting a package',()=>{
  expect(REQUIRED_RUNTIME_FILES).toEqual(expect.arrayContaining([
   'host/packages/runtime-login/index.ts','host/packages/runtime/index.ts','host/apps/server/main.ts',
   'host/third-party/t3code/LICENSE',
   'host/packages/runtime-official/index.ts','host/packages/runtime-pi/worker.ts',
   'host/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
   'host/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
   'host/node_modules/@google/gemini-cli/bundle/gemini.js',
   'host/packages/runtime-official/cursor.ts','host/packages/runtime-official/cursor-worker.ts',
   'host/packages/runtime-official/cursor-credentials.ts','host/packages/runtime-official/cursor-mcp.ts',
   'host/node_modules/@cursor/sdk/dist/cjs/index.js','host/node_modules/@cursor/sdk/dist/esm/index.js',
   'host/node_modules/@cursor/sdk/LICENSE.md','host/node_modules/@cursor/sdk-win32-x64/bin/rg.exe',
   'host/node_modules/@cursor/sdk-win32-x64/bin/cursorsandbox.exe',
   'host/node_modules/@cursor/sdk-win32-x64/vendor/tree-sitter/binding.node',
   'host/node_modules/@cursor/sdk-win32-x64/vendor/tree-sitter-bash/node-types.json',
   'host/node_modules/@modelcontextprotocol/sdk/package.json'
  ]));
 });
 it('isolates production installation from the parent development workspace',()=>{const args=runtimeInstallArguments('C:/build/host');expect(args).toContain('--ignore-workspace');expect(args.slice(args.indexOf('--dir'),args.indexOf('--dir')+2)).toEqual(['--dir','C:/build/host']);expect(args.slice(args.indexOf('--lockfile-dir'),args.indexOf('--lockfile-dir')+2)).toEqual(['--lockfile-dir','C:/build/host']);});
 it('stages the exact dependency patch and standalone configuration without project scripts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gen-runtime-install-')),host=join(root,'host'),patch='reviewed patch\n',lock='lockfileVersion: 9\n';
  try{
   await mkdir(join(root,'patches'));await writeFile(join(root,'patches/node-pty-1.1.0.patch'),patch);await writeFile(join(root,'patches/unreviewed.patch'),'private');
   await writeFile(join(root,'package.json'),JSON.stringify({name:'fixture',scripts:{install:'must not run'},dependencies:{'node-pty':'1.1.0'},pnpm:{overrides:{example:'1.0.0'}}}));await writeFile(join(root,'pnpm-lock.yaml'),lock);
   await stageRuntimeInstall(root,host);
   expect(JSON.parse(await readFile(join(host,'package.json'),'utf8'))).toEqual({name:'fixture',scripts:{},dependencies:{'node-pty':'1.1.0'},pnpm:{overrides:{example:'1.0.0'},patchedDependencies:{'node-pty@1.1.0':'patches/node-pty-1.1.0.patch'}}});
   expect(await readdir(join(host,'patches'))).toEqual(['node-pty-1.1.0.patch']);expect(await readFile(join(host,'patches/node-pty-1.1.0.patch'),'utf8')).toBe(patch);
   expect(await readFile(join(host,'pnpm-lock.yaml'),'utf8')).toBe(lock);expect(await readFile(join(host,'.npmrc'),'utf8')).toBe('node-linker=hoisted\npackage-import-method=copy\n');
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5});}
 });
 it('rejects a dependency patch directory linked outside the source root',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gen-runtime-patch-link-')),root=join(directory,'source'),outside=join(directory,'outside');
  try{
   await mkdir(root);await mkdir(outside);await writeFile(join(root,'package.json'),'{}');await symlink(outside,join(root,'patches'),'junction');
   await expect(stageRuntimeInstall(root,join(directory,'host'))).rejects.toThrow(/ordinary directory/);
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:5});}
 });
 it('requires the generic plugin runtime and updater while excluding private implementation',()=>{
  expect(REQUIRED_RUNTIME_FILES).toEqual(expect.arrayContaining(['host/packages/plugins/host.ts','host/node_modules/electron-updater/out/main.js','host/dist/plugin-runtime/runtime.js']));
  expect(REQUIRED_RUNTIME_FILES.some(path=>path.includes('company'))).toBe(false);
 });
 it('executes a native Windows pnpm binary directly and JavaScript launchers through Node',()=>{expect(packageManagerInvocation('C:/tools/pnpm.exe','C:/node.exe',['install'])).toEqual({file:'C:/tools/pnpm.exe',args:['install']});expect(packageManagerInvocation('C:/tools/pnpm.cjs','C:/node.exe',['install'])).toEqual({file:'C:/node.exe',args:['C:/tools/pnpm.cjs','install']});});
 it('admits runtime source/helpers but excludes user data, tests and executable application content',()=>{
  for(const path of ['apps/server/main.ts','packages/core/windows-path-guard.ps1','packages/capabilities/sqlite-worker.mjs','packages/runtime-pi/worker.ts'])expect(runtimeSourceAllowed(path)).toBe(true);
  for(const path of ['.env','pi/auth.json','.t3/userdata/session.json','tests/fixture.ts','packages/runtime-pi/auth.json','packages/../pi/auth.ts','packages/core/source.exe','apps/web/src/App.tsx'])expect(runtimeSourceAllowed(path)).toBe(false);
 });
 it('excludes every private plugin contract and host entry from public runtime inputs',()=>{
  for(const path of ['apps/server/company-main.ts','packages/company-client/index.ts','packages/company-contracts/generated/work-plan.ts','packages/company-contracts/company-manager.v1.json'])expect(runtimeSourceAllowed(path)).toBe(false);
 });
 it('pins the updater and stable GitHub release feed without changing builder family',()=>{
  const pkg=JSON.parse(readFileSync('package.json','utf8'));expect(pkg.dependencies['electron-updater']).toBe('6.8.11');expect(pkg.devDependencies['electron-builder']).toBe('26.18.0');
  expect(desktopBuilderConfig('C:/build').publish).toEqual([{provider:'github',owner:'Skytuhua',repo:'Gen-V1',releaseType:'release',channel:'latest'}]);
 });
 it('requires the pinned official Node archive hash before extraction',()=>{
  const bytes=Buffer.from('fixture archive'),hash=createHash('sha256').update(bytes).digest('hex');
  expect(()=>validateNodeArchive(bytes,hash)).not.toThrow();
  expect(()=>validateNodeArchive(bytes,'0'.repeat(64))).toThrow(/checksum/i);
 });
 it('packages runtime resources outside ASAR and does not include workspace or credentials',()=>{
  const config=desktopBuilderConfig('C:/build');
  expect(config.appId).toBe('local.generativeharness.desktop');expect(config.productName).toBe('Gen V1');expect(config.nsis.artifactName).toBe('Gen-V1-Setup-${version}-win-x64.exe');
  expect(config.asar).toBe(true);
  expect(config.compression).toBe('normal');
  expect(config.win.target).toEqual([{target:'nsis',arch:['x64']}]);
  expect(config.nsis).toMatchObject({perMachine:false,oneClick:true,allowElevation:false,useZip:true,differentialPackage:false,runAfterFinish:false,deleteAppDataOnUninstall:false});
  expect(config.npmRebuild).toBe(false);expect(config.files).toContain('!node_modules/**/*');
  expect(config.extraResources.map(row=>row.to)).toEqual(['host','host/node_modules','host/.harness-hermes-python-deps','host/.harness-integrations-python-deps','host/.harness-tool-bundles','node']);
  expect(config.directories.app).toBe('C:/build/desktop-app');
  expect(JSON.stringify(config)).not.toMatch(/userdata|auth\.json|\.codex/);
 });
});
