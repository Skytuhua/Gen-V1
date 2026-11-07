import {publicRuntimeSourceAllowed} from './public-source.ts';
import {createHash} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';

export function readDesktopOutputRoot(args:string[]):string{
 if(!args.length)return resolve('dist');
 if(args.length!==2||args[0]!=='--output-root'||!args[1].trim())throw Error('Usage: desktop:package [--output-root <directory>]');
 return resolve(args[1]);
}
export async function reserveDesktopRelease(outputRoot:string,version:string):Promise<string>{
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw Error('Invalid desktop release version.');
 const release=resolve(outputRoot,'desktop-release-'+version);
 try{await lstat(release);throw Error('The desktop release destination already exists. Choose another --output-root; existing releases are never overwritten.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await mkdir(resolve(outputRoot),{recursive:true});
 try{await mkdir(release);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('The desktop release destination already exists. Choose another --output-root; existing releases are never overwritten.');throw error;}
 return release;
}

export const NODE_VERSION='24.22.2';
export const NODE_ARCHIVE_SHA256='ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2';
export const REQUIRED_RUNTIME_FILES=[
 'node/node.exe','host/apps/server/main.ts','host/node_modules/tsx/dist/loader.mjs',
 'host/packages/plugins/host.ts','host/packages/plugins/installation.ts','host/packages/plugins/contracts.ts',
 'host/node_modules/electron-updater/out/main.js','host/node_modules/semver/index.js',
 'host/dist/plugin-runtime/runtime.js','host/dist/plugin-runtime/runtime.css',
 'host/third-party/t3code/LICENSE',
 'host/third-party/hermes-agent/LICENSE',
 'host/packages/runtime-hermes/worker.py','host/packages/runtime-hermes/acp-server.ts',
 'host/hermes-python/python.exe','host/hermes-python/python314.dll','host/hermes-python/python314._pth','host/hermes-python/LICENSE.txt',
 'host/hermes-python/Lib/encodings/__init__.py','host/hermes-python/DLLs/_ssl.pyd',
 'host/.harness-hermes-python-deps/openai/__init__.py','host/.harness-hermes-python-deps/pydantic_core/__init__.py',
 'host/third-party/hermes-agent/upstream/run_agent.py','host/third-party/hermes-agent/UPSTREAM_MANIFEST.json','host/third-party/hermes-agent/RUNTIME_DEPENDENCIES.json',
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
export async function stageRuntimeInstall(root:string,host:string){
 const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
 const patches={'node-pty@1.1.0':'patches/node-pty-1.1.0.patch'};
 const directory=await lstat(resolve(root,'patches'));
 if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Dependency patch directory must be an ordinary directory.');
 for(const path of Object.values(patches)){
  const input=resolve(root,path),info=await lstat(input);
  if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw Error('Invalid dependency patch: '+path);
  const output=resolve(host,path);await mkdir(dirname(output),{recursive:true});await copyFile(input,output);
 }
 // --ignore-workspace keeps installation isolated and also ignores workspace patch settings.
 await writeFile(resolve(host,'package.json'),JSON.stringify({...pkg,scripts:{},pnpm:{...pkg.pnpm,patchedDependencies:patches}},null,2));
 await copyFile(resolve(root,'pnpm-lock.yaml'),resolve(host,'pnpm-lock.yaml'));
 await writeFile(resolve(host,'.npmrc'),'node-linker=hoisted\npackage-import-method=copy\n');
}
export function runtimeSourceAllowed(path:string){return publicRuntimeSourceAllowed(path);}

export function validateNodeArchive(bytes:Uint8Array,expected=NODE_ARCHIVE_SHA256){if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Bundled Node archive checksum mismatch');}
export function desktopBuilderConfig(dist:string){
 const root=dist.replaceAll('\\','/').replace(/\/$/,'');
 return {appId:'local.generativeharness.desktop',productName:'Gen V1',electronVersion:'45.2.0',asar:true,npmRebuild:false,forceCodeSigning:false,
  publish:[{provider:'github' as const,owner:'Skytuhua',repo:'Gen-V1',releaseType:'release' as const,channel:'latest'}],
  directories:{app:root+'/desktop-app',output:root+'/desktop-release'},files:['main.mjs','preload.cjs','startup.html','package.json','!node_modules/**/*'],
  extraResources:[{from:root+'/desktop-host',to:'host'},{from:root+'/desktop-host/node_modules',to:'host/node_modules',filter:['**/*']},{from:root+'/desktop-host/.harness-hermes-python-deps',to:'host/.harness-hermes-python-deps',filter:['**/*']},{from:root+'/desktop-host/.harness-integrations-python-deps',to:'host/.harness-integrations-python-deps',filter:['**/*']},{from:root+'/desktop-host/.harness-tool-bundles',to:'host/.harness-tool-bundles',filter:['**/*']},{from:root+'/desktop-node',to:'node'}],
  // Install once, then launch directly. Standard ZIP extraction avoids the
  // portable 7z extractor's additional full-tree copy on every application start.
  win:{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false},
  nsis:{artifactName:'Gen-V1-Setup-${version}-win-x64.exe',oneClick:true,perMachine:false,allowElevation:false,packElevateHelper:false,useZip:true,differentialPackage:false,runAfterFinish:false,deleteAppDataOnUninstall:false,createDesktopShortcut:false,createStartMenuShortcut:true},compression:'normal' as const};
}
