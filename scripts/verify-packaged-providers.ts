import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,lstat,readdir,realpath,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';

type ManifestFile={path:string;bytes:number;sha256:string};
export type DistributionManifest={files:ManifestFile[];bytes:number;sha256:string};
export function assertContainedPath(root:string,path:string){
 const part=relative(resolve(root),resolve(path));
 if(part==='..'||part.startsWith('..\\')||part.startsWith('../')||isAbsolute(part))throw Error('Resolved distribution is outside the packaged host.');
}
async function sha256(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
/** The package root may itself be a pnpm junction. Distribution children must be ordinary files. */
export async function distributionManifest(root:string,options:{excludeNodeModules?:boolean}={}):Promise<DistributionManifest>{
 const canonical=await realpath(root),files:ManifestFile[]=[];let bytes=0,entries=0;
 async function visit(directory:string,depth:number){
  if(depth>32)throw Error('Distribution tree exceeds its depth bound.');
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(options.excludeNodeModules&&entry.name==='node_modules')continue;
   if(++entries>20000)throw Error('Distribution tree exceeds its entry bound.');
   const path=join(directory,entry.name),info=await lstat(path);
   if(info.isSymbolicLink())throw Error('Distribution contains a nested link.');
   if(info.isDirectory()){await visit(path,depth+1);continue;}
   if(!info.isFile())throw Error('Distribution contains a non-file entry.');
   bytes+=info.size;if(bytes>2*1024**3)throw Error('Distribution exceeds its byte bound.');
   files.push({path:relative(canonical,path).replaceAll('\\','/'),bytes:info.size,sha256:await sha256(path)});
  }
 }
 await visit(canonical,0);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {files,bytes,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export function assertDistributionMatches(expected:DistributionManifest,actual:DistributionManifest){
 if(expected.sha256!==actual.sha256||expected.bytes!==actual.bytes||expected.files.length!==actual.files.length)throw Error('Packaged and pinned workspace distributions differ.');
}

const CURSOR_VERSION='1.0.38';
const CURSOR_SDK_ASSETS=['package.json','LICENSE.md','dist/cjs/index.js','dist/esm/index.js','dist/bundled/index.js'];
const CURSOR_NATIVE_ASSETS=['package.json','bin/rg.exe','bin/cursorsandbox.exe','vendor/tree-sitter/binding.node','vendor/tree-sitter/index.js','vendor/tree-sitter/package.json','vendor/tree-sitter-bash/binding.node','vendor/tree-sitter-bash/index.js','vendor/tree-sitter-bash/node-types.json','vendor/tree-sitter-bash/package.json'];
/** Read the target inventory, never the verifier workspace or a child-reported requirement. */
export async function cursorDependencyVersion(host:string):Promise<string|undefined>{
 const manifest=JSON.parse(await readFile(join(host,'package.json'),'utf8'));
 if(!Object.hasOwn(manifest.dependencies??{},'@cursor/sdk'))return;
 if(manifest.dependencies['@cursor/sdk']!==CURSOR_VERSION)throw Error('Cursor dependency must use the pinned SDK version '+CURSOR_VERSION+'.');
 return CURSOR_VERSION;
}
export async function resolveCursorDistributions(host:string){
 const canonical=await realpath(host),require=createRequire(join(canonical,'package.json'));
 const entry=await realpath(require.resolve('@cursor/sdk')),cursorSdk=dirname(dirname(dirname(entry)));
 assertContainedPath(canonical,cursorSdk);
 const cursorRequire=createRequire(entry),cursorNative=await realpath(dirname(cursorRequire.resolve('@cursor/sdk-win32-x64/package.json')));
 assertContainedPath(canonical,cursorNative);
 for(const [root,name,assets] of [[cursorSdk,'@cursor/sdk',CURSOR_SDK_ASSETS],[cursorNative,'@cursor/sdk-win32-x64',CURSOR_NATIVE_ASSETS]] as const){
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  if(manifest.name!==name||manifest.version!==CURSOR_VERSION)throw Error('Cursor distribution name or version differs from the pinned SDK.');
  for(const asset of assets){
   const path=join(root,asset),info=await lstat(path).catch(()=>undefined);
   if(!info?.isFile()||info.isSymbolicLink())throw Error('Cursor distribution is missing a regular required asset: '+asset);
   assertContainedPath(root,await realpath(path));
  }
 }
 if(entry!==await realpath(join(cursorSdk,'dist/cjs/index.js')))throw Error('Cursor SDK resolved an unexpected entry.');
 return {cursorSdk,cursorNative,entry,rg:await realpath(join(cursorNative,'bin/rg.exe'))};
}

type VersionCheck={provider:string;entry:string;versionOutput:string;elapsedMs:number;arguments:string[];home:string;auth:false;inference:false};
type CursorCheck=VersionCheck&{bootstrap:{credentialStore:'empty-memory';authStatus:'logged-out';agentCreate:true;networkRequests:0;sandboxExecution:false;nativeHelper:{entry:string;versionOutput:string;arguments:['--version']}}};
type ProbeResult={node:{path:string;version:string};checks:(VersionCheck|CursorCheck)[];roots:{claudeSdk:string;claudeNative:string;geminiBundle:string;cursorSdk?:string;cursorNative?:string}};
function unexpectedProbe():never{throw Error('Packaged probe returned an unexpected result.');}
function assertProbeCheck(host:string,value:unknown):asserts value is VersionCheck{
 const check=value as VersionCheck;
 if(!check||check.auth!==false||check.inference!==false||typeof check.entry!=='string'||typeof check.versionOutput!=='string'||!check.versionOutput||check.versionOutput.length>1024||!Number.isFinite(check.elapsedMs)||check.elapsedMs<0||typeof check.home!=='string')unexpectedProbe();
 assertContainedPath(host,check.entry);
}
function assertCursorCheck(host:string,value:unknown,roots:{cursorSdk?:string;cursorNative?:string}):asserts value is CursorCheck{
 assertProbeCheck(host,value);const check=value as CursorCheck,bootstrap=check.bootstrap;
 if(typeof roots.cursorSdk!=='string'||typeof roots.cursorNative!=='string')unexpectedProbe();
 assertContainedPath(host,roots.cursorSdk);assertContainedPath(host,roots.cursorNative);
 if(check.provider!=='cursor-sdk'||check.versionOutput!==CURSOR_VERSION||resolve(check.entry)!==resolve(roots.cursorSdk,'dist/esm/index.js')||JSON.stringify(check.arguments)!=='[]'||!bootstrap||bootstrap.credentialStore!=='empty-memory'||bootstrap.authStatus!=='logged-out'||bootstrap.agentCreate!==true||bootstrap.networkRequests!==0||bootstrap.sandboxExecution!==false||!bootstrap.nativeHelper||typeof bootstrap.nativeHelper.entry!=='string'||resolve(bootstrap.nativeHelper.entry)!==resolve(roots.cursorNative,'bin/rg.exe')||JSON.stringify(bootstrap.nativeHelper.arguments)!=='["--version"]'||typeof bootstrap.nativeHelper.versionOutput!=='string'||!bootstrap.nativeHelper.versionOutput.startsWith('ripgrep ')||bootstrap.nativeHelper.versionOutput.length>1024)unexpectedProbe();
 assertContainedPath(host,bootstrap.nativeHelper.entry);
}
export function assertPackagedProbe(host:string,value:unknown,cursorRequired:boolean):asserts value is ProbeResult{
 const result=value as ProbeResult,providers=cursorRequired?['claude-code','gemini-cli','cursor-sdk']:['claude-code','gemini-cli'];
 const expectedRoots=cursorRequired?['claudeSdk','claudeNative','geminiBundle','cursorSdk','cursorNative']:['claudeSdk','claudeNative','geminiBundle'];
 if(!result||!result.node||typeof result.node.path!=='string'||typeof result.node.version!=='string'||!Array.isArray(result.checks)||result.checks.length!==providers.length||!result.roots||Object.keys(result.roots).sort().join()!==expectedRoots.sort().join())unexpectedProbe();
 for(const path of Object.values(result.roots)){if(typeof path!=='string')unexpectedProbe();assertContainedPath(host,path);}
 for(const [index,check] of result.checks.entries()){
  assertProbeCheck(host,check);if(check.provider!==providers[index])unexpectedProbe();
  if(check.provider!=='cursor-sdk'){if(JSON.stringify(check.arguments)!=='["--version"]')unexpectedProbe();continue;}
  assertCursorCheck(host,check,result.roots);
 }
}

// Fixed verification code runs under bundled Node and uses only packaged provider/runtime assets.
const PROBE=String.raw`
import {spawn} from 'node:child_process';
import {mkdir,realpath,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const host=await realpath(process.env.HARNESS_VERIFY_HOST),directory=await realpath(process.env.HARNESS_VERIFY_DIRECTORY);
const {officialRuntimeCommand,officialRuntimeEnvironment,officialRuntimeHome}=await import(pathToFileURL(join(host,'packages/runtime-official/environment.ts')).href);
const {terminateProcessTree}=await import(pathToFileURL(join(host,'packages/runtime-pi/process-tree.ts')).href);
const require=createRequire(join(host,'package.json'));
const cursorRequired=process.env.HARNESS_VERIFY_CURSOR==='1',cursorOnly=process.env.HARNESS_VERIFY_CURSOR_ONLY==='1';
function contained(path){const part=relative(host,path).replaceAll(String.fromCharCode(92),'/');if(part==='..'||part.startsWith('../')||isAbsolute(part))throw Error('Provider escaped the packaged host.');}
const checks=[];
for(const provider of cursorOnly?[]:['claude-code','gemini-cli']){
 const command=officialRuntimeCommand(provider),entry=await realpath(command.args[0]??command.file);contained(entry);
 if(provider==='gemini-cli'&&(await realpath(command.file)!==await realpath(process.execPath)||command.args.length!==1))throw Error('Gemini did not resolve through bundled Node.');
 if(provider==='claude-code'&&command.args.length!==0)throw Error('Claude command arguments changed.');
 const env=officialRuntimeEnvironment(directory,provider),home=officialRuntimeHome(directory,provider);
 await Promise.all([home,env.TEMP,env.APPDATA,env.LOCALAPPDATA,env.XDG_CONFIG_HOME,env.XDG_DATA_HOME].map(path=>mkdir(path,{recursive:true})));
 const started=Date.now(),child=spawn(command.file,[...command.args,'--version'],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 const output=await new Promise((accept,reject)=>{
  let stdout='',stderr='',bytes=0,failed=false;
  const fail=error=>{if(failed)return;failed=true;clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),reject);};
  const timer=setTimeout(()=>fail(Error('Published CLI version check exceeded 30 seconds.')),30000);
  child.once('error',fail);
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){fail(Error('Published CLI output exceeded its bound.'));return;}if(stream===child.stdout)stdout+=String(chunk);else stderr=(stderr+String(chunk)).slice(-8000);});
  child.once('close',code=>{clearTimeout(timer);if(failed)return;failed=true;code===0?accept(stdout.trim()):reject(Error('Published CLI version check failed with exit '+code+'. '+stderr));});
 });
 if(!output||output.length>1024)throw Error('Unexpected CLI version output.');
 checks.push({provider,entry,versionOutput:output,elapsedMs:Date.now()-started,arguments:['--version'],home,auth:false,inference:false});
}
const roots={};
if(!cursorOnly){
 const sdk=require.resolve('@anthropic-ai/claude-agent-sdk'),sdkRequire=createRequire(sdk);
 Object.assign(roots,{claudeSdk:dirname(sdk),claudeNative:dirname(sdkRequire.resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json')),geminiBundle:join(dirname(require.resolve('@google/gemini-cli/package.json')),'bundle')});
}
if(cursorRequired){
 const sdkEntry=await realpath(require.resolve('@cursor/sdk')),cursorSdk=dirname(dirname(dirname(sdkEntry))),cursorRequire=createRequire(sdkEntry);
 const cursorNative=await realpath(dirname(cursorRequire.resolve('@cursor/sdk-win32-x64/package.json'))),entry=await realpath(join(cursorSdk,'dist/esm/index.js')),rg=await realpath(join(cursorNative,'bin/rg.exe'));
 for(const path of [cursorSdk,cursorNative,entry,rg])contained(path);
 for(const [root,name] of [[cursorSdk,'@cursor/sdk'],[cursorNative,'@cursor/sdk-win32-x64']]){const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(manifest.name!==name||manifest.version!=='1.0.38')throw Error('Cursor probe found an unexpected distribution version.');}
 const env=officialRuntimeEnvironment(directory,'cursor-sdk'),home=officialRuntimeHome(directory,'cursor-sdk');
 await Promise.all([home,env.TEMP,env.TMP,env.TMPDIR,env.APPDATA,env.LOCALAPPDATA,env.XDG_CONFIG_HOME,env.XDG_DATA_HOME,env.XDG_STATE_HOME,env.XDG_CACHE_HOME].map(path=>mkdir(path,{recursive:true})));
 // No ambient credential path, key, endpoint, proxy, or Node option survives SDK import.
 for(const name of Object.keys(process.env))delete process.env[name];Object.assign(process.env,env);process.chdir(home);
 let networkRequests=0;globalThis.fetch=async()=>{networkRequests++;throw Error('Network is forbidden in the Cursor bootstrap probe.');};
 const started=Date.now(),sdk=await import(pathToFileURL(entry).href);
 const status=await sdk.Cursor.auth.status({store:new sdk.InMemoryCredentialStore()});
 if(status.status!=='logged-out'||typeof sdk.Agent.create!=='function'||networkRequests!==0)throw Error('Cursor empty-store bootstrap did not remain logged out.');
 const child=spawn(rg,['--version'],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 const output=await new Promise((accept,reject)=>{
  let stdout='',stderr='',bytes=0,failed=false;
  const fail=error=>{if(failed)return;failed=true;clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),reject);};
  const timer=setTimeout(()=>fail(Error('Cursor rg version check exceeded 30 seconds.')),30000);child.once('error',fail);
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){fail(Error('Cursor rg output exceeded its bound.'));return;}if(stream===child.stdout)stdout+=String(chunk);else stderr=(stderr+String(chunk)).slice(-8000);});
  child.once('close',code=>{clearTimeout(timer);if(failed)return;failed=true;code===0?accept(stdout.trim()):reject(Error('Cursor rg version check failed with exit '+code+'. '+stderr));});
 });
 if(!output.startsWith('ripgrep ')||output.length>1024||networkRequests!==0)throw Error('Unexpected Cursor rg bootstrap output.');
 checks.push({provider:'cursor-sdk',entry,versionOutput:'1.0.38',elapsedMs:Date.now()-started,arguments:[],home,auth:false,inference:false,bootstrap:{credentialStore:'empty-memory',authStatus:status.status,agentCreate:true,networkRequests,sandboxExecution:false,nativeHelper:{entry:rg,versionOutput:output,arguments:['--version']}}});
 Object.assign(roots,{cursorSdk,cursorNative});
}
console.log(JSON.stringify({node:{path:process.execPath,version:process.versions.node},checks,roots}));
`;

async function runProbe(host:string,node:string,directory:string,cursorRequired:boolean,cursorOnly=false):Promise<unknown>{
 const env:NodeJS.ProcessEnv={HARNESS_VERIFY_HOST:host,HARNESS_VERIFY_DIRECTORY:directory,HARNESS_VERIFY_CURSOR:cursorRequired?'1':'0',HARNESS_VERIFY_CURSOR_ONLY:cursorOnly?'1':'0'};
 for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TERM'])if(process.env[name]!==undefined)env[name]=process.env[name];
 const child=spawn(node,['--import',pathToFileURL(join(host,'node_modules/tsx/dist/loader.mjs')).href,'--input-type=module','-e',PROBE],{cwd:host,env,windowsHide:true,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 const output=await new Promise<string>((accept,reject)=>{
  let stdout='',stderr='',bytes=0,failed=false;
  const fail=(error:Error)=>{if(failed)return;failed=true;clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),reject);};
  const timer=setTimeout(()=>fail(Error('Packaged runtime verification exceeded its deadline.')),90000);
  child.once('error',fail);
  for(const stream of [child.stdout,child.stderr])stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>256*1024){fail(Error('Packaged verification output exceeded its bound.'));return;}if(stream===child.stdout)stdout+=String(chunk);else stderr=(stderr+String(chunk)).slice(-16000);});
  child.once('close',code=>{clearTimeout(timer);if(failed)return;failed=true;code===0?accept(stdout.trim()):reject(Error('Packaged runtime verification exited '+code+'. No authentication or inference was requested. '+stderr));});
 });
 return JSON.parse(output);
}
async function probePackage(host:string,node:string,directory:string,cursorRequired:boolean):Promise<ProbeResult>{
 const result=await runProbe(host,node,directory,cursorRequired);assertPackagedProbe(host,result,cursorRequired);
 if(await realpath(result.node.path)!==await realpath(node))throw Error('Probe did not use the packaged Node binary.');
 return result;
}

/** Source bootstrap characterization; the release verifier separately requires pinned full-distribution custody. */
export async function probeCursorBootstrap(host:string,node:string,directory:string){
 await resolveCursorDistributions(host);
 const result=await runProbe(host,node,directory,true,true) as {node:ProbeResult['node'];checks:CursorCheck[];roots:{cursorSdk:string;cursorNative:string}};
 if(!result?.node||typeof result.node.path!=='string'||typeof result.node.version!=='string'||!Array.isArray(result.checks)||result.checks.length!==1||!result.roots||Object.keys(result.roots).sort().join()!=='cursorNative,cursorSdk')unexpectedProbe();
 assertCursorCheck(host,result.checks[0],result.roots);
 if(await realpath(result.node.path)!==await realpath(node))throw Error('Probe did not use the requested Node binary.');
 return {node:result.node,check:result.checks[0],roots:result.roots};
}

export async function verifyPackagedProviders(unpacked:string){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('This verification requires the Windows x64 package.');
 const packageRoot=await realpath(resolve(unpacked)),host=await realpath(join(packageRoot,'resources/host')),node=await realpath(join(packageRoot,'resources/node/node.exe'));
 assertContainedPath(packageRoot,host);assertContainedPath(packageRoot,node);
 const directory=resolve('.harness-packaged-providers','run-'+Date.now()+'-'+randomUUID());await mkdir(directory,{recursive:true});
 const cursorRequired=await cursorDependencyVersion(host)!==undefined;
 const receipt:Record<string,unknown>={createdAt:new Date().toISOString(),packageRoot,inventory:cursorRequired?['claude-code','gemini-cli','cursor-sdk']:['claude-code','gemini-cli'],scope:'Actual packaged Node and resolver, published CLI version startup, and Cursor empty-store SDK import plus stock rg version when declared by the target. Full declared distribution custody. Empty isolated homes; no sign-in, model request, inference, sandbox acceptance, or live-account acceptance.',auth:false,inference:false,passed:false};
 try{
  const require=createRequire(import.meta.url),sdk=require.resolve('@anthropic-ai/claude-agent-sdk'),sdkRequire=createRequire(sdk);
  const sourceRoots:Record<string,string>={claudeSdk:dirname(sdk),claudeNative:dirname(sdkRequire.resolve('@anthropic-ai/claude-agent-sdk-win32-x64/package.json')),geminiBundle:join(dirname(require.resolve('@google/gemini-cli/package.json')),'bundle')};
  const custody=[];
  const cursorTarget=cursorRequired?await resolveCursorDistributions(host):undefined;
  // Verify all published Cursor bytes before executing even its stock rg helper.
  if(cursorRequired){
   const source=await resolveCursorDistributions(dirname(dirname(fileURLToPath(import.meta.url)))),target=cursorTarget!;
   for(const key of ['cursorSdk','cursorNative'] as const){
    const expected=await distributionManifest(source[key],{excludeNodeModules:true}),actual=await distributionManifest(target[key],{excludeNodeModules:true});assertDistributionMatches(expected,actual);
    custody.push({distribution:key,sourceRoot:source[key],packagedRoot:target[key],matches:true,...actual});
   }
  }
  const probe=await probePackage(host,node,directory,cursorRequired);
  if(cursorTarget)for(const key of ['cursorSdk','cursorNative'] as const)if(await realpath(probe.roots[key]!)!==cursorTarget[key])throw Error('Cursor probe resolved a distribution different from the verified custody root.');
  for(const key of ['claudeSdk','claudeNative','geminiBundle'] as const){
   const options={excludeNodeModules:key!=='geminiBundle'},expected=await distributionManifest(sourceRoots[key],options),actual=await distributionManifest(probe.roots[key],options);
   assertDistributionMatches(expected,actual);
   custody.push({distribution:key,sourceRoot:await realpath(sourceRoots[key]),packagedRoot:await realpath(probe.roots[key]),matches:true,...actual});
  }
  Object.assign(receipt,{passed:true,...probe,custody,nodeSha256:await sha256(node)});
 }catch(error){receipt.error=error instanceof Error?error.message:'Packaged verification failed.';throw error;}
 finally{await writeFile(join(directory,'verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({directory,passed:receipt.passed}));}
 return {directory,receipt};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const unpacked=process.argv[2];if(!unpacked)throw Error('Pass the absolute win-unpacked package directory.');
 await verifyPackagedProviders(unpacked);
}
