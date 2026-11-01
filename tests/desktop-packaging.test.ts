import {describe,it,expect} from 'vitest';
import {runtimeSourceAllowed,validateNodeArchive,desktopBuilderConfig,packageManagerInvocation,runtimeInstallArguments,REQUIRED_RUNTIME_FILES} from '../scripts/desktop-assets.ts';
import {createHash} from 'node:crypto';

describe('desktop distribution custody',()=>{
 it('requires every fixed provider entry and published distribution before accepting a package',()=>{
  expect(REQUIRED_RUNTIME_FILES).toEqual(expect.arrayContaining([
   'host/packages/runtime-login/index.ts','host/packages/runtime/index.ts',
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
 it('executes a native Windows pnpm binary directly and JavaScript launchers through Node',()=>{expect(packageManagerInvocation('C:/tools/pnpm.exe','C:/node.exe',['install'])).toEqual({file:'C:/tools/pnpm.exe',args:['install']});expect(packageManagerInvocation('C:/tools/pnpm.cjs','C:/node.exe',['install'])).toEqual({file:'C:/node.exe',args:['C:/tools/pnpm.cjs','install']});});
 it('admits runtime source/helpers but excludes user data, tests and executable application content',()=>{
  for(const path of ['apps/server/main.ts','packages/core/windows-path-guard.ps1','packages/capabilities/sqlite-worker.mjs','packages/runtime-pi/worker.ts'])expect(runtimeSourceAllowed(path)).toBe(true);
  for(const path of ['.env','pi/auth.json','.t3/userdata/session.json','tests/fixture.ts','packages/runtime-pi/auth.json','packages/../pi/auth.ts','packages/core/source.exe','apps/web/src/App.tsx'])expect(runtimeSourceAllowed(path)).toBe(false);
 });
 it('requires the pinned official Node archive hash before extraction',()=>{
  const bytes=Buffer.from('fixture archive'),hash=createHash('sha256').update(bytes).digest('hex');
  expect(()=>validateNodeArchive(bytes,hash)).not.toThrow();
  expect(()=>validateNodeArchive(bytes,'0'.repeat(64))).toThrow(/checksum/i);
 });
 it('packages runtime resources outside ASAR and does not include workspace or credentials',()=>{
  const config=desktopBuilderConfig('C:/build');
  expect(config.asar).toBe(true);
  expect(config.compression).toBe('normal');
  expect(config.win.target).toEqual([{target:'nsis',arch:['x64']}]);
  expect(config.nsis).toMatchObject({perMachine:false,oneClick:true,allowElevation:false,useZip:true,differentialPackage:false,runAfterFinish:false,deleteAppDataOnUninstall:false});
  expect(config.npmRebuild).toBe(false);expect(config.files).toContain('!node_modules/**/*');
  expect(config.extraResources.map(row=>row.to)).toEqual(['host','host/node_modules','host/.harness-hermes-python-deps','node']);
  expect(config.directories.app).toBe('C:/build/desktop-app');
  expect(JSON.stringify(config)).not.toMatch(/userdata|auth\.json|\.codex/);
 });
});
