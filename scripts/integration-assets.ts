import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {dependencyFile,ordinaryFile,payloadPath,readManifest,sha256,verifyDefinition,type IntegrationFile} from '../packages/integrations/manifest.ts';

interface LockedFile {path:string;bytes:number;sha256:string}
interface Distribution {name:string;version:string;wheelSha256?:string;sourceUrl?:string}
interface PythonLock {version:1;python:'3.14';requirements:string[];distributions:Distribution[];files:LockedFile[];bytes:number}
interface PayloadFile extends LockedFile {source?:string;content?:string}
export interface CanonicalPythonOptions {wheelDirectory:string;pythonExecutable:string}
interface CanonicalPythonReceipt {version:2;mode:'wheel-canonical-record-v2';sourceLockSha256:string;wheels:{name:string;version:string;sha256:string}[];files:LockedFile[]}
interface CanonicalPythonProjection {files:PayloadFile[];bytes:number;receipt:CanonicalPythonReceipt;inputDiagnosis:unknown}
export interface IntegrationPayload {files:PayloadFile[];bytes:number;integrations:number;pythonProjection?:CanonicalPythonReceipt;pythonInputDiagnosis?:unknown}
const MAX_BYTES=1024*1024*1024,MAX_FILES=20000;
const normalize=(name:string)=>name.toLowerCase().replace(/[-_.]+/g,'-');
async function walk(root:string,prefix:string,omitInstallArtifacts=true):Promise<LockedFile[]>{
 const result:LockedFile[]=[];let bytes=0;
 async function visit(directory:string,part:string,depth:number):Promise<void>{
  if(depth>48)throw Error('Integration payload nesting exceeds its bound');const directoryInfo=await lstat(directory);if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink())throw Error('Integration payload directory must be ordinary');
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(omitInstallArtifacts&&(['__pycache__','bin','Scripts'].includes(entry.name)||/\.py[co]$/i.test(entry.name)))continue;
   const path=part+'/'+entry.name,input=join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Integration payload contains a link');
   if(entry.isDirectory())await visit(input,path,depth+1);else{const data=await ordinaryFile(input);bytes+=data.length;if(bytes>MAX_BYTES||result.length>=MAX_FILES)throw Error('Integration dependency payload exceeds budget');result.push({path,bytes:data.length,sha256:sha256(data)});}
  }
 }
 await visit(root,prefix,0);return result.sort((a,b)=>a.path.localeCompare(b.path));
}

/** Explicit v2 input: pinned wheels authenticate ownership; no cached RECORD is shipped. */
export async function collectCanonicalPythonPayload(root:string,options:CanonicalPythonOptions):Promise<CanonicalPythonProjection>{
 root=resolve(root);
 if(!options.wheelDirectory||!options.pythonExecutable)throw Error('Canonical Python packaging requires explicit wheels and an interpreter');
 const lockBytes=await ordinaryFile(join(root,'third-party/integrations/PYTHON_LOCK.json'),8*1024*1024),lock=JSON.parse(lockBytes.toString()) as PythonLock;
 const helper=fileURLToPath(new URL('./integration_python_projection.py',import.meta.url));
 const result=await promisify(execFile)(options.pythonExecutable,['-I','-S','-B',helper,'--root',root,'--wheel-directory',resolve(options.wheelDirectory)],{windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
 const projection=JSON.parse(result.stdout) as CanonicalPythonProjection;
 if(projection.receipt?.version!==2||projection.receipt.mode!=='wheel-canonical-record-v2'||projection.receipt.sourceLockSha256!==sha256(lockBytes)||!Array.isArray(projection.files)||projection.files.length!==lock.files.length)throw Error('Canonical Python projection does not match its original lock');
 const expected=new Map(lock.files.map(file=>[file.path,file])),paths=new Set<string>();let total=0;
 for(const file of projection.files){
  const original=expected.get(file.path),source=payloadPath(root,file.path);
  if(!original||paths.has(file.path)||Number(typeof file.source==='string')+Number(typeof file.content==='string')!==1||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid canonical Python projected file');
  paths.add(file.path);total+=file.bytes;
  const record=/^\.harness-integrations-python-deps\/[^/]+\.dist-info\/RECORD$/.test(file.path),requested=/^\.harness-integrations-python-deps\/[^/]+\.dist-info\/REQUESTED$/.test(file.path);
  if(!record&&(file.bytes!==original.bytes||file.sha256!==original.sha256))throw Error('Canonical projection changed a locked non-RECORD file');
  if(typeof file.content==='string'){
   if(!record&&!requested||Buffer.byteLength(file.content)!==file.bytes||sha256(file.content)!==file.sha256)throw Error('Canonical Python generated bookkeeping is invalid');
  }else{
   if(record||resolve(file.source!)!==source)throw Error('Canonical Python source is outside its locked input');
   const bytes=await ordinaryFile(source);if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw Error('Canonical Python input changed after projection: '+file.path);
  }
 }
 const inventory=projection.files.map(({path,bytes,sha256})=>({path,bytes,sha256}));
 const wheels=lock.distributions.map(item=>({name:item.name,version:item.version,sha256:item.wheelSha256}));
 if(total!==projection.bytes||total>MAX_BYTES||paths.size>MAX_FILES||JSON.stringify(inventory)!==JSON.stringify(projection.receipt.files)||JSON.stringify(wheels)!==JSON.stringify(projection.receipt.wheels))throw Error('Canonical Python projection inventory differs from its authenticated inputs');
 return projection;
}
/** Explicit install-time lock, after the parent's wheel-only isolated installation. */
async function lockIntegrationDependencies(root:string,pipReport?:string){
 root=resolve(root);const directory=join(root,'.harness-integrations-python-deps'),files=await walk(directory,'.harness-integrations-python-deps');
 const distributions:Distribution[]=[];for(const file of files.filter(file=>file.path.endsWith('.dist-info/METADATA'))){const text=(await ordinaryFile(payloadPath(root,file.path))).toString(),name=/^Name: (.+)\r?$/m.exec(text)?.[1],version=/^Version: (.+)\r?$/m.exec(text)?.[1];if(!name||!version)throw Error('Integration distribution metadata is incomplete');distributions.push({name:normalize(name),version});}
 distributions.sort((a,b)=>a.name.localeCompare(b.name));if(new Set(distributions.map(item=>item.name)).size!==distributions.length||!distributions.some(item=>item.name==='graphifyy'&&item.version==='0.9.100')||!distributions.some(item=>item.name==='specify-cli'&&item.version==='1.2.5'))throw Error('Pinned main Python integration distributions are absent');
 if(pipReport){const report=JSON.parse(await readFile(resolve(pipReport),'utf8')) as {install:{metadata:{name:string;version:string};download_info:{url:string;archive_info:{hashes:{sha256?:string}}}}[]};for(const item of distributions){const row=report.install.find(row=>normalize(row.metadata.name)===item.name&&row.metadata.version===item.version);if(!row||!row.download_info.url.endsWith('.whl')||!row.download_info.archive_info.hashes.sha256)throw Error('Every integration dependency needs a hashed compatible wheel receipt');item.wheelSha256=row.download_info.archive_info.hashes.sha256;item.sourceUrl=row.download_info.url;}}
 const lock:PythonLock={version:1,python:'3.14',requirements:['graphifyy[mcp,pdf,office,svg]==0.9.100','specify-cli==1.2.5'],distributions,files,bytes:files.reduce((sum,file)=>sum+file.bytes,0)};
 await writeFile(join(root,'third-party/integrations/PYTHON_LOCK.json'),JSON.stringify(lock,null,2)+'\n');
 const manifest=await readManifest(root),nodeFiles:LockedFile[]=[];
 for(const item of manifest.integrations.filter(item=>item.runtime?.kind==='node')){
  const runtime=item.runtime!,pkg=JSON.parse((await dependencyFile(join(root,'node_modules',runtime.package!,'package.json'))).toString());if(pkg.version!==runtime.version)throw Error('Pinned Node integration package is absent');
  for(const path of [runtime.entry,`node_modules/${runtime.package}/package.json`,...(item.id==='biome'?['node_modules/@biomejs/cli-win32-x64/biome.exe','node_modules/@biomejs/cli-win32-x64/package.json']:[])]){const data=await dependencyFile(payloadPath(root,path));nodeFiles.push({path,bytes:data.length,sha256:sha256(data)});}
 }
 await writeFile(join(root,'third-party/integrations/NODE_LOCK.json'),JSON.stringify({version:1,node:'24.22.2',files:nodeFiles},null,2)+'\n');
 return {distributions:distributions.length,files:files.length,bytes:lock.bytes,nodeFiles:nodeFiles.length};
}
export async function collectIntegrationPayload(root:string,options:{canonicalPython?:CanonicalPythonOptions}={}):Promise<IntegrationPayload>{
 root=resolve(root);const manifest=await readManifest(root),payload:IntegrationPayload={files:[],bytes:0,integrations:manifest.integrations.length};
 const add=async(file:LockedFile|IntegrationFile)=>{const data=await ordinaryFile(payloadPath(root,file.path));if(data.length!==file.bytes||sha256(data)!==file.sha256)throw Error('Integration custody checksum mismatch: '+file.path);payload.bytes+=data.length;if(payload.bytes>MAX_BYTES||payload.files.length>=MAX_FILES)throw Error('Integration payload exceeds packaging budget');payload.files.push({path:file.path,bytes:data.length,sha256:file.sha256,source:payloadPath(root,file.path)});};
 for(const item of manifest.integrations){await verifyDefinition(root,item);for(const file of item.files)await add(file);}
 const python=JSON.parse((await ordinaryFile(join(root,'third-party/integrations/PYTHON_LOCK.json'),8*1024*1024)).toString()) as PythonLock;
 if(python.version!==1||python.python!=='3.14'||python.files.length>MAX_FILES)throw Error('Invalid integration Python lock');
 if(options.canonicalPython){
  const projection=await collectCanonicalPythonPayload(root,options.canonicalPython);
  payload.files.push(...projection.files);payload.bytes+=projection.bytes;payload.pythonProjection=projection.receipt;payload.pythonInputDiagnosis=projection.inputDiagnosis;
  const path='third-party/integrations/PYTHON_INSTALLATION_V2.json',content=JSON.stringify(projection.receipt,null,2)+'\n';
  payload.files.push({path,content,bytes:Buffer.byteLength(content),sha256:sha256(content)});payload.bytes+=Buffer.byteLength(content);
  if(payload.bytes>MAX_BYTES||payload.files.length>MAX_FILES)throw Error('Canonical integration payload exceeds packaging budget');
 }else{
  const actual=await walk(join(root,'.harness-integrations-python-deps'),'.harness-integrations-python-deps');if(actual.length!==python.files.length||actual.some((file,index)=>JSON.stringify(file)!==JSON.stringify(python.files[index])))throw Error('Installed Python integration payload differs from the exact lock');
  for(const file of python.files)await add(file);
 }
 for(const path of ['third-party/integrations/manifest.json','third-party/integrations/PYTHON_LOCK.json','third-party/integrations/NODE_LOCK.json','packages/integrations/hermes.py','packages/integrations/python-entry.py','packages/integrations/promptfoo-provider.mjs']){const data=await ordinaryFile(payloadPath(root,path));await add({path,bytes:data.length,sha256:sha256(data)});}
 return payload;
}
export async function stageIntegrationPayload(host:string,payload:IntegrationPayload){
 host=resolve(host);for(const file of payload.files){
  const path=payloadPath(host,file.path);await mkdir(dirname(path),{recursive:true});
  if(Number(typeof file.source==='string')+Number(typeof file.content==='string')!==1)throw Error('Integration payload source is ambiguous');
  const data=file.source?await ordinaryFile(file.source):Buffer.from(file.content!);
  if(data.length!==file.bytes||sha256(data)!==file.sha256)throw Error('Integration source changed after preflight');
  try{if(file.source)await copyFile(file.source,path,constants.COPYFILE_EXCL);else await writeFile(path,data,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha256(await ordinaryFile(path))!==file.sha256)throw error;}
 }
 await verifyIntegrationPayload(host,payload);
}
export async function verifyIntegrationPayload(host:string,payload:IntegrationPayload){
 for(const file of payload.files)if(sha256(await ordinaryFile(payloadPath(host,file.path)))!==file.sha256)throw Error('Packaged integration checksum mismatch: '+file.path);
 if(payload.pythonProjection){
  const actual=await walk(resolve(host,'.harness-integrations-python-deps'),'.harness-integrations-python-deps',false),expected=new Map(payload.pythonProjection.files.map(file=>[file.path,file]));
  if(actual.length!==expected.size||actual.some(file=>JSON.stringify(file)!==JSON.stringify(expected.get(file.path))))throw Error('Packaged canonical Python file set differs from its exact projection');
 }
 const lock=JSON.parse((await ordinaryFile(resolve(host,'third-party/integrations/NODE_LOCK.json'))).toString()) as {version:number;files:LockedFile[]};if(lock.version!==1)throw Error('Invalid integration Node lock');for(const file of lock.files)if(sha256(await dependencyFile(payloadPath(host,file.path)))!==file.sha256)throw Error('Packaged Node integration changed: '+file.path);
}
export async function verifyRelocatedIntegrations(host:string){
 const python=resolve(host,'hermes-python/python.exe'),entry=resolve(host,'packages/integrations/python-entry.py'),env={...process.env,PYTHON_MANAGER_AUTOMATIC_INSTALL:'false',PYTHONDONTWRITEBYTECODE:'1'};
 for(const args of [['graphify','--version'],['specify','version','--json']])await promisify(execFile)(python,['-I','-S','-B',entry,...args],{cwd:host,env,windowsHide:true,timeout:30000,maxBuffer:256*1024});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv[2]!=='--lock')throw Error('Use --lock <pip-install-report.json> after the explicit isolated installation');console.log(JSON.stringify(await lockIntegrationDependencies(resolve('.'),process.argv[3])));}
