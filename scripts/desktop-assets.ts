import {publicRuntimeSourceAllowed} from './public-source.ts';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile,writeFile,copyFile} from 'node:fs/promises';
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

export async function reserveDesktopStage(outputRoot:string,timestamp=Date.now()):Promise<string>{
 return mkdtemp(resolve(outputRoot,'desktop-stage-'+timestamp+'-'));
}

export const NODE_ARCHIVE_EXTRACT_COMMAND=[
 "$ErrorActionPreference = 'Stop'",
 'Add-Type -AssemblyName System.IO.Compression.FileSystem',
 '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:HARNESS_NODE_ZIP, $env:HARNESS_NODE_EXTRACT)'
].join('; ');
export const NODE_VERSION='24.22.2';
export const NODE_ARCHIVE_SHA256='ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2';
export const REQUIRED_RUNTIME_FILES=[
 'node/node.exe','host/apps/server/main.ts','host/node_modules/tsx/dist/loader.mjs',
 'host/packages/plugins/host.ts','host/packages/plugins/installation.ts','host/packages/plugins/contracts.ts',
 'host/node_modules/electron-updater/out/main.js','host/node_modules/semver/index.js',
 'host/dist/plugin-runtime/runtime.js','host/dist/plugin-runtime/runtime.css',
 'host/third-party/t3code/LICENSE',
 'host/third-party/hermes-agent/LICENSE',
 'host/packages/runtime-hermes/worker.py','host/packages/runtime-hermes/memory_checkpoint.py','host/packages/runtime-hermes/acp-server.ts',
 'host/packages/runtime-hermes/context_capture.py','host/packages/runtime-hermes/context.ts',
 'host/packages/runtime-hermes/context-budget.ts',
 'host/packages/runtime-hermes/compaction_protection.py',
 'host/hermes-python/python.exe','host/hermes-python/python314.dll','host/hermes-python/python314._pth','host/hermes-python/LICENSE.txt',
 'host/hermes-python/Lib/encodings/__init__.py','host/hermes-python/DLLs/_ssl.pyd',
 'host/.harness-hermes-python-deps/openai/__init__.py','host/.harness-hermes-python-deps/pydantic_core/__init__.py',
 'host/third-party/hermes-agent/upstream/run_agent.py','host/third-party/hermes-agent/UPSTREAM_MANIFEST.json','host/third-party/hermes-agent/RUNTIME_DEPENDENCIES.json',
 'host/node_modules/fastify/package.json','host/node_modules/@earendil-works/pi-coding-agent/package.json',
 'host/node_modules/axe-core/axe.min.js','host/node_modules/axe-core/LICENSE',
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
 'host/node_modules/typescript/lib/typescript.js','host/node_modules/typescript/package.json',
 'host/node_modules/typescript/LICENSE.txt','host/node_modules/typescript/ThirdPartyNoticeText.txt',
 'host/packages/core/windows-path-guard.ps1','host/packages/core/windows-credential-lease.node','host/packages/capabilities/sqlite-worker.mjs','host/dist/web/index.html'
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
// Parser-only closure from the existing, unchanged TypeScript 5.9.3 development pin.
// Stage after the frozen production install; do not reclassify dependencies or install more packages.
const REPOSITORY_MAP_PARSER_FILES=[
 {path:'package.json',bytes:3620,sha256:'822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6'},
 {path:'lib/typescript.js',bytes:9112572,sha256:'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675'},
 {path:'LICENSE.txt',bytes:9197,sha256:'a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47'},
 {path:'ThirdPartyNoticeText.txt',bytes:37824,sha256:'1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c'},
] as const;
export async function stageRepositoryMapParser(root:string,host:string){
 const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
 if(pkg.devDependencies?.typescript!=='5.9.3'||pkg.dependencies?.typescript!==undefined)throw Error('Repository-map parser requires the unchanged TypeScript 5.9.3 development pin.');
 const source=resolve(root,'node_modules/typescript'),target=resolve(host,'node_modules/typescript');
 const files:{path:string;bytes:Buffer;sha256:string}[]=[];
 for(const expected of REPOSITORY_MAP_PARSER_FILES){
  const input=resolve(source,expected.path),info=await lstat(input);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==expected.bytes)throw Error('Invalid pinned repository-map parser file: '+expected.path);
  const bytes=await readFile(input);
  if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Pinned repository-map parser bytes changed: '+expected.path);
  files.push({path:expected.path,bytes,sha256:expected.sha256});
 }
 // Validate the complete source closure before creating output. A failed stage is never packaged.
 for(const directory of [resolve(host,'node_modules'),target,resolve(target,'lib')]){
  try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Parser output must be an ordinary directory.');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(directory);}
 }
 for(const file of files){
  const output=resolve(target,file.path);
  try{await writeFile(output,file.bytes,{flag:'wx'});}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const info=await lstat(output);
   if(!info.isFile()||info.isSymbolicLink()||info.size!==file.bytes.length||createHash('sha256').update(await readFile(output)).digest('hex')!==file.sha256)throw Error('Existing parser output does not match the pinned file: '+file.path);
  }
 }
}
export function runtimeSourceAllowed(path:string){return publicRuntimeSourceAllowed(path);}

export function validateNodeArchive(bytes:Uint8Array,expected=NODE_ARCHIVE_SHA256){if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Bundled Node archive checksum mismatch');}
export function desktopBuilderConfig(dist:string,channel=process.env.HARNESS_RELEASE_CHANNEL){
 if(channel!==undefined&&channel!=='stable'&&channel!=='prerelease')throw Error('HARNESS_RELEASE_CHANNEL must be stable or prerelease.');
 const root=dist.replaceAll('\\','/').replace(/\/$/,'');
 return {appId:'local.generativeharness.desktop',productName:'Gen V1',electronVersion:'45.2.0',asar:true,npmRebuild:false,forceCodeSigning:false,
  publish:[{provider:'github' as const,owner:'skytuhua-org',repo:'Gen-V1',releaseType:'release' as const,channel:channel==='prerelease'?'beta':'latest'}],
  directories:{app:root+'/desktop-app',output:root+'/desktop-release'},files:['main.mjs','preload.cjs','startup.html','package.json','!node_modules/**/*'],
  extraResources:[{from:root+'/desktop-host',to:'host'},{from:root+'/desktop-host/node_modules',to:'host/node_modules',filter:['**/*']},{from:root+'/desktop-host/.harness-hermes-python-deps',to:'host/.harness-hermes-python-deps',filter:['**/*']},{from:root+'/desktop-host/.harness-integrations-python-deps',to:'host/.harness-integrations-python-deps',filter:['**/*']},{from:root+'/desktop-host/.harness-tool-bundles',to:'host/.harness-tool-bundles',filter:['**/*']},{from:root+'/desktop-node',to:'node'}],
  // Use the supported 7z payload for large file counts. Its temporary-tree copy
  // occurs during installation; the installed application launches directly.
  win:{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false},
  nsis:{artifactName:'Gen-V1-Setup-${version}-win-x64.exe',oneClick:true,perMachine:false,allowElevation:false,packElevateHelper:false,useZip:false,differentialPackage:channel!==undefined,runAfterFinish:false,deleteAppDataOnUninstall:false,createDesktopShortcut:false,createStartMenuShortcut:true},compression:'normal' as const};
}
