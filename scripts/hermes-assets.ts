import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {promisify} from 'node:util';

const COMMIT='c627ec84664d43e0b18b95d9d86d8963747d56c7';
const MAX_FILES=15000,MAX_BYTES=256*1024*1024,MAX_FILE_BYTES=32*1024*1024;
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const normalized=(name:string)=>name.toLowerCase().replace(/[-_.]+/g,'-');
const omitted=new Set(['__pycache__','site-packages','test','tests','idlelib','tkinter','turtledemo','ensurepip','venv']);
export interface HermesPython {directory:string;version:number[];implementation:string;platform:string;bits:number;machine:string}
interface PayloadFile {path:string;source?:string;content?:string;bytes:number;sha256:string}
export interface HermesPayload {python:HermesPython;files:PayloadFile[];bytes:number}

function supported(python:HermesPython){if(python.implementation!=='cpython'||python.version[0]!==3||python.version[1]!==14||python.platform!=='win32'||python.bits!==64||!['AMD64','x86_64'].includes(python.machine))throw Error('Hermes packaging requires installed CPython 3.14 for Windows x64.');}
function child(root:string,path:string){if(!path||path.includes('\\')||path.includes(':')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid Hermes payload path.');const output=resolve(root,...path.split('/'));if(relative(root,output).startsWith('..'))throw Error('Hermes payload leaves its root.');return output;}
async function bytes(path:string):Promise<Buffer>{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>MAX_FILE_BYTES)throw Error('Hermes payload requires bounded ordinary single-link files: '+path);const data=await readFile(path);if(data.length!==info.size||data.length>MAX_FILE_BYTES)throw Error('Hermes payload changed during inspection: '+path);return data;}
async function ordinaryDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Hermes payload requires ordinary directories without links: '+path);}

async function probe(executable:string,args:string[]=[]):Promise<HermesPython>{
 const script='import json,sys,struct,platform; print(json.dumps({"directory":sys.base_prefix,"version":list(sys.version_info[:3]),"implementation":sys.implementation.name,"platform":sys.platform,"bits":struct.calcsize("P")*8,"machine":platform.machine()}))';
 const env:NodeJS.ProcessEnv={...process.env,PYTHON_MANAGER_AUTOMATIC_INSTALL:'false'};delete env.PYLAUNCHER_ALLOW_INSTALL;delete env.PYLAUNCHER_ALWAYS_INSTALL;
 const result=await promisify(execFile)(executable,[...args,'-I','-S','-B','-c',script],{env,windowsHide:true,timeout:10000,maxBuffer:65536});
 const python=JSON.parse(result.stdout) as HermesPython;supported(python);return python;
}
export async function discoverHermesPython():Promise<HermesPython>{
 const selected=process.env.HARNESS_HERMES_PYTHON;
 return probe(selected??join(process.env.SystemRoot??'C:/Windows','py.exe'),selected?[]:['-3.14']);
}

/** Read-only preflight. No installer staging exists until the complete payload is admitted. */
export async function collectHermesPayload(root:string,python:HermesPython):Promise<HermesPayload>{
 supported(python);root=resolve(root);python={...python,directory:resolve(python.directory)};
 const payload:HermesPayload={python,files:[],bytes:0};let inspected=0;
 const add=async(source:string,path:string,expected?:{bytes:number;sha256:string;gitBlob?:string})=>{
  child(root,path);const data=await bytes(source),hash=sha(data);
  if(expected&&(data.length!==expected.bytes||hash!==expected.sha256||expected.gitBlob&&createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')!==expected.gitBlob))throw Error('Hermes source custody checksum mismatch: '+path);
  payload.bytes+=data.length;if(payload.files.length>=MAX_FILES||payload.bytes>MAX_BYTES)throw Error('Hermes runtime payload exceeds its bounded file/byte limit.');
  payload.files.push({path,source,bytes:data.length,sha256:hash});
 };
 const walk=async(directory:string,prefix:string,filter:(path:string,directory:boolean)=>boolean,depth=0):Promise<void>=>{
  if(depth>64)throw Error('Hermes payload directory depth exceeds its limit.');await ordinaryDirectory(directory);
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(++inspected>30000)throw Error('Hermes payload exceeds its inspected-entry limit.');
   const input=join(directory,entry.name),part=prefix+'/'+entry.name;
   if(entry.isSymbolicLink())throw Error('Hermes payload links are unsupported: '+input);
   if(!filter(part,entry.isDirectory()))continue;
   if(entry.isDirectory())await walk(input,part,filter,depth+1);else await add(input,part);
  }
 };
 await ordinaryDirectory(python.directory);
 for(const name of ['python.exe','python3.dll','python314.dll','LICENSE.txt'])await add(join(python.directory,name),'hermes-python/'+name);
 for(const name of await readdir(python.directory))if(/^vcruntime.*\.dll$/i.test(name))await add(join(python.directory,name),'hermes-python/'+name);
 if(!payload.files.some(file=>file.path==='hermes-python/vcruntime140.dll'))throw Error('Hermes Python runtime is missing vcruntime140.dll.');
 await walk(join(python.directory,'DLLs'),'hermes-python/DLLs',path=>!/^(_test|_tkinter|xxlimited)/i.test(path.split('/').at(-1)!));
 await walk(join(python.directory,'Lib'),'hermes-python/Lib',path=>!path.split('/').some(part=>omitted.has(part))&&!/\.py[co]$/i.test(path));
 for(const name of ['Lib/os.py','Lib/encodings/__init__.py'])if(!payload.files.some(file=>file.path==='hermes-python/'+name))throw Error('Hermes Python runtime is missing '+name);
 const content='.\nLib\nDLLs\n';payload.files.push({path:'hermes-python/python314._pth',content,bytes:Buffer.byteLength(content),sha256:sha(content)});payload.bytes+=Buffer.byteLength(content);

 const third=join(root,'third-party/hermes-agent'),requirements=await bytes(join(third,'runtime-requirements.txt'));
 const lock=JSON.parse((await bytes(join(third,'RUNTIME_DEPENDENCIES.json'))).toString()) as {sourceCommit:string;requirementsSha256:string;distributionCount:number;distributions:{name:string;version:string}[]};
 const manifest=JSON.parse((await bytes(join(third,'UPSTREAM_MANIFEST.json'))).toString()) as {commit:string;files:{path:string;bytes:number;sha256:string;gitBlob:string}[]};
 if(lock.sourceCommit!==COMMIT||manifest.commit!==COMMIT||lock.requirementsSha256!==sha(requirements)||lock.distributionCount!==lock.distributions.length||manifest.files.length>5000)throw Error('Hermes source/dependency lock is inconsistent.');
 const dependencyRoot=join(root,'.harness-hermes-python-deps'),actual=new Map<string,string>();await ordinaryDirectory(dependencyRoot);
 for(const entry of await readdir(dependencyRoot,{withFileTypes:true}))if(entry.name.endsWith('.dist-info')){
  await ordinaryDirectory(join(dependencyRoot,entry.name));const metadata=(await bytes(join(dependencyRoot,entry.name,'METADATA'))).toString(),name=/^Name: (.+)\r?$/m.exec(metadata)?.[1],version=/^Version: (.+)\r?$/m.exec(metadata)?.[1];
  if(!name||!version||actual.has(normalized(name)))throw Error('Hermes dependency metadata does not match the lock.');actual.set(normalized(name),version);
 }
 if(actual.size!==lock.distributionCount||lock.distributions.some(item=>actual.get(normalized(item.name))!==item.version))throw Error('Hermes dependency versions do not match the dependency lock.');
 await walk(dependencyRoot,'.harness-hermes-python-deps',path=>!path.split('/').some(part=>['__pycache__','bin','Scripts'].includes(part))&&!/\.py[co]$/i.test(path));
 await add(join(root,'packages/runtime-hermes/worker.py'),'packages/runtime-hermes/worker.py');
 for(const name of ['LICENSE','runtime-requirements.txt','RUNTIME_DEPENDENCIES.json','UPSTREAM_MANIFEST.json'])await add(join(third,name),'third-party/hermes-agent/'+name);
 for(const name of ['README.md','RUNTIME_PROTOCOL.md'])try{await add(join(third,name),'third-party/hermes-agent/'+name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 for(const file of manifest.files)await add(child(join(third,'upstream'),file.path),'third-party/hermes-agent/upstream/'+file.path,file);
 return payload;
}

export async function stageHermesPayload(host:string,payload:HermesPayload):Promise<void>{
 host=resolve(host);await mkdir(host,{recursive:true});await ordinaryDirectory(host);
 for(const file of payload.files){
  const destination=child(host,file.path);await mkdir(dirname(destination),{recursive:true});
  if(file.source){if(sha(await bytes(file.source))!==file.sha256)throw Error('Hermes payload source changed after preflight: '+file.path);try{await copyFile(file.source,destination,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||sha(await bytes(destination))!==file.sha256)throw error;}}
  else await writeFile(destination,file.content!,{flag:'wx'});
 }
 await verifyHermesPayload(host,payload);
}
export async function verifyHermesPayload(host:string,payload:HermesPayload):Promise<void>{
 for(const file of payload.files)if(sha(await bytes(child(host,file.path)))!==file.sha256)throw Error('Packaged Hermes payload checksum changed: '+file.path);
}
/** The relative ._pth file prevents registry, environment and global site-package fallback. */
export async function verifyRelocatedHermesPython(host:string):Promise<void>{
 const directory=resolve(host,'hermes-python'),python=await probe(join(directory,'python.exe'));if(resolve(python.directory)!==directory)throw Error('Packaged Python resolved outside its own payload.');
 const script='import sys,ssl,sqlite3,ctypes,asyncio; from pathlib import Path; root=Path(sys.executable).parent.resolve(); assert all(Path(p).resolve().is_relative_to(root) for p in sys.path); sys.path.insert(0,str(root.parent/".harness-hermes-python-deps")); import openai,pydantic_core,ruamel.yaml,snowballstemmer';
 await promisify(execFile)(join(directory,'python.exe'),['-I','-S','-B','-c',script],{cwd:directory,windowsHide:true,timeout:20000,maxBuffer:65536});
}
