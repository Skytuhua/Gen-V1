import {mkdir,readFile,writeFile,copyFile,readdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build,type Configuration} from 'electron-builder';
import {runtimeSourceAllowed,validateNodeArchive,desktopBuilderConfig,packageManagerInvocation,runtimeInstallArguments,readDesktopOutputRoot,reserveDesktopRelease,REQUIRED_RUNTIME_FILES,NODE_VERSION,NODE_ARCHIVE_SHA256} from './desktop-assets.ts';
import {collectHermesPayload,discoverHermesPython,stageHermesPayload,verifyHermesPayload,verifyRelocatedHermesPython} from './hermes-assets.ts';

if(process.platform!=='win32'||process.arch!=='x64')throw Error('This package target requires Windows x64');
const root=resolve('.'),dist=readDesktopOutputRoot(process.argv.slice(2)),pkg=JSON.parse(await readFile('package.json','utf8')),release=await reserveDesktopRelease(dist,pkg.version),stage=resolve(dist,'desktop-stage-'+Date.now()),host=resolve(stage,'desktop-host'),cache=resolve('.harness-desktop-cache');
const hermes=await collectHermesPayload(root,await discoverHermesPython());
await mkdir(host,{recursive:true});await mkdir(cache,{recursive:true});
const run=(file:string,args:string[],cwd:string,extraEnv:Record<string,string>={})=>new Promise<void>((accept,reject)=>{const child=spawn(file,args,{cwd,windowsHide:true,stdio:'inherit',env:{...process.env,...extraEnv}});child.on('error',reject);child.on('exit',code=>code===0?accept():reject(Error(file+' exited '+code)));});
async function copySources(directory:string){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name),part=relative(root,path).replaceAll('\\','/');if(entry.isSymbolicLink())throw Error('Runtime source link is not allowed: '+part);if(entry.isDirectory()){if(!entry.name.startsWith('.')&&!['node_modules','tests','fixtures'].includes(entry.name))await copySources(path);}else if(runtimeSourceAllowed(part)){const info=await lstat(path);if(!info.isFile()||info.size>2*1024*1024)throw Error('Invalid runtime source: '+part);const output=resolve(host,part);await mkdir(dirname(output),{recursive:true});await copyFile(path,output);}}}
await copySources(resolve('packages'));await copySources(resolve('apps/server'));
async function copyTree(source:string,target:string){await mkdir(target,{recursive:true});for(const entry of await readdir(source,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Asset links are unsupported');const input=join(source,entry.name),output=join(target,entry.name);if(entry.isDirectory())await copyTree(input,output);else await copyFile(input,output);}}
await copyTree(resolve('dist/web'),resolve(host,'dist/web'));await copyTree(resolve('dist/widget-runtime'),resolve(host,'dist/widget-runtime'));
await copyTree(resolve('dist/desktop-app'),resolve(stage,'desktop-app'));
await copyTree(resolve('third-party/t3code'),resolve(host,'third-party/t3code'));
await stageHermesPayload(host,hermes);
await writeFile(resolve(host,'package.json'),JSON.stringify({...pkg,scripts:{}},null,2));await copyFile('pnpm-lock.yaml',resolve(host,'pnpm-lock.yaml'));await writeFile(resolve(host,'.npmrc'),'node-linker=hoisted\npackage-import-method=copy\n');
const pnpm=process.env.npm_execpath;if(!pnpm)throw Error('Use pnpm desktop:package so the locked package manager is available');
const install=packageManagerInvocation(pnpm,process.execPath,runtimeInstallArguments(host));await run(install.file,install.args,host);
const archive=resolve(cache,`node-v${NODE_VERSION}-win-x64.zip`);let bytes:Buffer;
try{bytes=await readFile(archive);validateNodeArchive(bytes);}catch{const response=await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`);if(!response.ok)throw Error('Node distribution unavailable');bytes=Buffer.from(await response.arrayBuffer());validateNodeArchive(bytes);await writeFile(archive,bytes);}
const extractionRoot=resolve(cache,'extract-'+Date.now());await mkdir(extractionRoot);const extracted=resolve(extractionRoot,`node-v${NODE_VERSION}-win-x64`);
await run('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:HARNESS_NODE_ZIP -DestinationPath $env:HARNESS_NODE_EXTRACT'],cache,{HARNESS_NODE_ZIP:archive,HARNESS_NODE_EXTRACT:extractionRoot});
// Expand-Archive uses fixed environment paths; never interpolate shell text.
const nodeTarget=resolve(stage,'desktop-node');await mkdir(nodeTarget,{recursive:true});await copyFile(resolve(extracted,'node.exe'),resolve(nodeTarget,'node.exe'));await copyFile(resolve(extracted,'LICENSE'),resolve(nodeTarget,'LICENSE'));
const config=desktopBuilderConfig(stage);config.directories.output=release;
const options={projectDir:resolve(stage,'desktop-app'),config:{...config,afterPack:async(context:import('electron-builder').AfterPackContext)=>{for(const file of REQUIRED_RUNTIME_FILES){const path=resolve(context.appOutDir,'resources',file);if(!(await lstat(path)).isFile())throw Error('Packaged runtime is incomplete: '+file);}const packagedHost=resolve(context.appOutDir,'resources/host');await verifyHermesPayload(packagedHost,hermes);await verifyRelocatedHermesPython(packagedHost);}} as Configuration};
const result=await build(options);
await writeFile(resolve(release,'build-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),nodeVersion:NODE_VERSION,nodeArchiveSha256:NODE_ARCHIVE_SHA256,electronVersion:'45.2.0',hermes:{pythonVersion:hermes.python.version,files:hermes.files.length,bytes:hermes.bytes,sourceCommit:'c627ec84664d43e0b18b95d9d86d8963747d56c7'},files:await Promise.all(result.map(async file=>({file:relative(root,file),bytes:(await lstat(file)).size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))},null,2),{flag:'wx'});
console.log(JSON.stringify({artifacts:result}));
