import {createHash} from 'node:crypto';

export const NODE_VERSION='24.22.2';
export const NODE_ARCHIVE_SHA256='ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2';
export const REQUIRED_RUNTIME_FILES=[
 'node/node.exe','host/apps/server/main.ts','host/node_modules/tsx/dist/loader.mjs',
 'host/node_modules/fastify/package.json','host/node_modules/@earendil-works/pi-coding-agent/package.json',
 'host/packages/runtime/index.ts','host/packages/runtime-login/index.ts','host/packages/runtime-pi/worker.ts',
 'host/packages/runtime-official/index.ts','host/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
 'host/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
 'host/packages/runtime-official/cursor.ts','host/packages/runtime-official/cursor-worker.ts',
 'host/packages/runtime-official/cursor-credentials.ts','host/packages/runtime-official/cursor-mcp.ts',
 'host/node_modules/@cursor/sdk/package.json','host/node_modules/@cursor/sdk/LICENSE.md',
 'host/node_modules/@cursor/sdk/dist/cjs/index.js','host/node_modules/@cursor/sdk/dist/esm/index.js','host/node_modules/@cursor/sdk/dist/bundled/index.js',
 'host/node_modules/@cursor/sdk-win32-x64/package.json','host/node_modules/@cursor/sdk-win32-x64/bin/rg.exe','host/node_modules/@cursor/sdk-win32-x64/bin/cursorsandbox.exe',
 ...['tree-sitter/binding.node','tree-sitter/index.js','tree-sitter/package.json','tree-sitter-bash/binding.node','tree-sitter-bash/index.js','tree-sitter-bash/node-types.json','tree-sitter-bash/package.json'].map(path=>'host/node_modules/@cursor/sdk-win32-x64/vendor/'+path),
 'host/node_modules/@google/gemini-cli/bundle/gemini.js','host/node_modules/@modelcontextprotocol/sdk/package.json',
 'host/packages/core/windows-path-guard.ps1','host/packages/capabilities/sqlite-worker.mjs','host/dist/web/index.html'
] as const;
export function packageManagerInvocation(manager:string,node:string,args:string[]){return /\.exe$/i.test(manager)?{file:manager,args}:{file:node,args:[manager,...args]};}
export function runtimeInstallArguments(host:string){return ['install','--ignore-workspace','--dir',host,'--lockfile-dir',host,'--prod','--frozen-lockfile','--offline','--ignore-scripts'];}
export function runtimeSourceAllowed(path:string){
 const value=path.replaceAll('\\','/'),parts=value.split('/');
 if(parts.some(part=>!part||part==='..'||part.startsWith('.')||['node_modules','tests','fixtures','userdata'].includes(part)))return false;
 if(!value.startsWith('packages/')&&!value.startsWith('apps/server/'))return false;
 return value.endsWith('.ts')&&!value.endsWith('.test.ts')||value==='packages/core/windows-path-guard.ps1'||value==='packages/capabilities/sqlite-worker.mjs';
}
export function validateNodeArchive(bytes:Uint8Array,expected=NODE_ARCHIVE_SHA256){if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Bundled Node archive checksum mismatch');}
export function desktopBuilderConfig(dist:string){
 const root=dist.replaceAll('\\','/').replace(/\/$/,'');
 return {appId:'local.generativeharness.desktop',productName:'Generative Harness',electronVersion:'45.2.0',asar:true,npmRebuild:false,forceCodeSigning:false,
  directories:{app:root+'/desktop-app',output:root+'/desktop-release'},files:['main.mjs','preload.cjs','package.json','!node_modules/**/*'],
  extraResources:[{from:root+'/desktop-host',to:'host'},{from:root+'/desktop-host/node_modules',to:'host/node_modules',filter:['**/*']},{from:root+'/desktop-node',to:'node'}],
  // Install once, then launch directly. Standard ZIP extraction avoids the
  // portable 7z extractor's additional full-tree copy on every application start.
  win:{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false},
  nsis:{artifactName:'Generative-Harness-Setup-${version}-win-x64.exe',oneClick:true,perMachine:false,allowElevation:false,packElevateHelper:false,useZip:true,differentialPackage:false,runAfterFinish:false,deleteAppDataOnUninstall:false,createDesktopShortcut:false,createStartMenuShortcut:true},compression:'normal' as const};
}
