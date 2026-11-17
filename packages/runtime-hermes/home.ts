import {lstat,mkdir,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {HarnessError} from '../contracts/index.ts';
import {withPathGuard} from '../core/file-access.ts';

/** Leaves stay replaceable because original Hermes saves and rolls back atomically. */
export async function assertHermesTree(home:string):Promise<void> {
 let count=0;
 async function visit(path:string,depth:number):Promise<void>{
  if(depth>64||++count>10000)throw new HarnessError('CAPABILITY_DENIED','The source storage exceeds its entry limit.');
  const info=await lstat(path,{bigint:true});
  if(info.isSymbolicLink()||(!info.isDirectory()&&(!info.isFile()||info.nlink!==1n)))throw new HarnessError('CAPABILITY_DENIED','Source storage must use ordinary local directories and single-link files.');
  if(info.isDirectory())for(const name of await readdir(path))await visit(join(path,name),depth+1);
 }
 await visit(home,0);
}

export async function withHermesHome<T>(home:string,action:()=>Promise<T>,onLoss?:()=>void):Promise<T>{
 home=resolve(home);const parent=dirname(home),signal=new AbortController().signal;
 const info=await lstat(parent);if(!info.isDirectory()||info.isSymbolicLink())throw new HarnessError('CAPABILITY_DENIED','Source storage requires an ordinary app-owned parent.');
 return withPathGuard([{path:parent,leaf:false,allowChildWrites:true,childWriteRoot:parent}],signal,async()=>{
  try{await mkdir(home,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await assertHermesTree(home);
  const roots=[home];for(const name of ['skills','sessions','workspace','.curator_backups']){const path=join(home,name);try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}roots.push(path);}
  return withPathGuard(roots.map(path=>({path,leaf:false,allowChildWrites:true,childWriteRoot:parent})),signal,async()=>{await assertHermesTree(home);return action();});
 },onLoss);
}
