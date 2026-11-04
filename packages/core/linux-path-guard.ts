import {randomUUID} from 'node:crypto';
import {fstatSync} from 'node:fs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {Socket} from 'node:net';
import {posix} from 'node:path';
import {HarnessError} from '../contracts/index.ts';
import type {GuardEntry} from './file-access.ts';

type DirectoryPath={path:string;leaf:boolean;dev?:string;ino?:string;empty?:boolean;tree?:boolean;readOnly?:boolean;allowChildWrites?:boolean;childWriteRoot?:string;gitMetadataImport?:boolean};
interface Session {rpc(request:Record<string,unknown>):Promise<readonly GuardEntry[]>;readonly exited:boolean;loss:Set<()=>void>}
const denied=()=>new HarnessError('CAPABILITY_DENIED','Cannot establish a stable ordinary filesystem resource guard');
const within=(root:string,path:string)=>path===root||path.startsWith(root+'/');
export function validateLinuxDirectoryPaths(paths:DirectoryPath[],root:string){
 if(!paths.length||paths.length>256)throw denied();
 for(const path of paths){
  if(typeof path.path!=='string'||path.path.length>4096||path.path.includes('\0')||!posix.isAbsolute(path.path)||posix.normalize(path.path)!==path.path||!within(root,path.path)
   ||path.leaf||path.tree||path.readOnly||path.empty||path.gitMetadataImport)throw denied();
  if((path.dev===undefined)!==(path.ino===undefined)||path.dev!==undefined&&(!/^\d+$/.test(path.dev)||!/^\d+$/.test(path.ino!)))throw denied();
  if(path.childWriteRoot!==undefined&&(!within(root,path.childWriteRoot)||posix.normalize(path.childWriteRoot)!==path.childWriteRoot||!within(path.childWriteRoot,path.path)))throw denied();
 }
 return paths;
}

/** Verify the OS boundary, not an environment assertion or broker promise. */
async function kernelBoundary(root:string,paths:DirectoryPath[]){
 const uid=process.geteuid?.();if(!uid)throw denied();
 const [status,mapping,mounts,info,actual]=await Promise.all([readFile('/proc/self/status','utf8'),readFile('/proc/self/uid_map','utf8'),readFile('/proc/self/mountinfo','utf8'),lstat(root,{bigint:true}),realpath(root)]);
 if(!/^0\s+0\s+4294967295$/.test(mapping.trim())||!/^NoNewPrivs:\s+1$/m.test(status)||['CapEff','CapPrm','CapBnd','CapAmb'].some(name=>!new RegExp('^'+name+':\\s+0+$','m').test(status)))throw denied();
 const backing=fstatSync(4,{bigint:true});
 if(actual!==root||!backing.isDirectory()||!info.isDirectory()||info.isSymbolicLink()||info.dev!==backing.dev||info.ino!==backing.ino||info.uid!==BigInt(uid)||backing.uid===info.uid||backing.uid===0n||info.mode&0o077n)throw denied();
 const records=mounts.trim().split('\n').map(line=>{const [mount,filesystem]=line.split(' - ');return {path:mount.split(' ')[4]?.replace(/\\(040|011|012|134)/g,(_,code:string)=>String.fromCharCode(parseInt(code,8))),type:filesystem?.split(' ')[0]};});
 const targets=new Set(records.map(record=>record.path));
 if(!records.some(record=>record.path===root&&record.type==='ext4'))throw denied();
 for(const path of paths){
  let current=root;
  for(const name of path.path.slice(root.length).split('/').filter(Boolean)){
   current+='/'+name;if(!targets.has(current))throw denied();
  }
  const directory=await lstat(path.path,{bigint:true});
  if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==BigInt(uid)||directory.mode&0o022n||path.dev!==undefined&&(String(directory.dev)!==path.dev||String(directory.ino)!==path.ino))throw denied();
 }
}

let broker:Promise<{root:string;session:Session}>|undefined;
function connect(){return broker??=(async()=>{
 if(process.platform!=='linux'||!fstatSync(3).isSocket())throw denied();
 const root=await realpath('/proc/self/fd/4');
 // Do not send our protocol to an unrelated inherited Node IPC descriptor.
 await kernelBoundary(root,[]);
 const socket=new Socket({fd:3,readable:true,writable:true});socket.unref();
 let buffer='',ended=false,queue=Promise.resolve();
 const loss=new Set<()=>void>();let pending:((error?:Error,value?:Record<string,unknown>)=>void)|undefined;
 const close=()=>{if(ended)return;ended=true;pending?.(denied());for(const notify of loss)try{notify();}catch{/* Preserve native teardown. */}};
 socket.on('error',close);socket.on('close',close);socket.on('end',close);
 socket.on('data',(chunk:Buffer)=>{
  buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>65536){socket.destroy();return;}
  const newline=buffer.indexOf('\n');if(newline<0)return;
  const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
  try{const value=JSON.parse(line);if(!pending||buffer||!value||typeof value!=='object'||Array.isArray(value))throw denied();pending(undefined,value);}
  catch{socket.destroy();}
 });
 async function request(value:Record<string,unknown>):Promise<Record<string,unknown>>{
  let reply!:Record<string,unknown>;
  const work=queue.then(()=>new Promise<void>((accept,reject)=>{
   if(ended)return reject(denied());
   const timer=setTimeout(()=>{socket.destroy();finish(denied());},15000);
   function finish(error?:Error,result?:Record<string,unknown>){clearTimeout(timer);pending=undefined;if(error)reject(error);else if(result?.id!==value.id||result?.error)reject(denied());else{reply=result!;accept();}}
   pending=finish;socket.write(JSON.stringify(value)+'\n',error=>{if(error)finish(denied());});
  }));queue=work.catch(()=>{});await work;return reply;
 }
 const hello=await request({command:'hello',id:randomUUID()});
 if(hello.protocol!=='gen-linux-directory-guard.v1'||hello.root!==root)throw denied();
 const session:Session={get exited(){return ended;},loss,async rpc(value){
  if(value.command==='acquire')validateLinuxDirectoryPaths(value.paths as DirectoryPath[],root);
  else if(value.command!=='release')throw denied();
  const reply=await request(value);
  if(value.command==='acquire')await kernelBoundary(root,value.paths as DirectoryPath[]);
  if(!Array.isArray(reply.entries)||reply.entries.length)throw denied();return [];
 }};
 return {root,session};
 })().catch(()=>{throw denied();});}

export async function withLinuxDirectoryGuard<T>(paths:DirectoryPath[],signal:AbortSignal,action:(session:Session,manifest:readonly GuardEntry[])=>Promise<T>,onLoss?:()=>void):Promise<T>{
 signal.throwIfAborted();const {session}=await connect();const id=randomUUID();
 await session.rpc({command:'acquire',id,paths});if(onLoss)session.loss.add(onLoss);
 try{signal.throwIfAborted();const result=await action(session,[]);if(session.exited)throw denied();return result;}
 finally{if(onLoss)session.loss.delete(onLoss);if(!session.exited)await session.rpc({command:'release',id});}
}
