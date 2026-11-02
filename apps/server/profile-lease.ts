import {mkdirSync,openSync,closeSync,lstatSync,realpathSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {HarnessError} from '../../packages/contracts/index.ts';

export interface ProfileLease {dataDir:string;close():void}

/** SQLite's process lock survives neither a crash nor process exit; no stale PID file is reclaimed. */
export function acquireProfileLease(directory:string):ProfileLease {
 if(!directory.trim())throw new HarnessError('PROFILE_LEASE_INVALID','The profile directory must be nonempty.');
 mkdirSync(resolve(directory),{recursive:true});const dataDir=realpathSync(directory),path=join(dataDir,'.host-lease.sqlite');
 const parent=statSync(dataDir,{bigint:true});
 try{const file=openSync(path,'wx',0o600);closeSync(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const identity=lstatSync(path,{bigint:true});
 if(!identity.isFile()||identity.isSymbolicLink()||identity.nlink!==1n)throw new HarnessError('PROFILE_LEASE_INVALID','The profile ownership file must be an ordinary private file.');
 let database:DatabaseSync|undefined;
 try{
  database=new DatabaseSync(path,{timeout:0});database.exec('BEGIN EXCLUSIVE');
  const acquired=lstatSync(path,{bigint:true}),currentParent=statSync(dataDir,{bigint:true});
  if(!acquired.isFile()||acquired.isSymbolicLink()||acquired.nlink!==1n||identity.dev!==acquired.dev||identity.ino!==acquired.ino||parent.dev!==currentParent.dev||parent.ino!==currentParent.ino||realpathSync(directory)!==dataDir)throw new HarnessError('PROFILE_LEASE_INVALID','The profile directory changed while acquiring ownership.');
 }catch(error){database?.close();if((error as {errcode?:number}).errcode===5||(error as {code?:string}).code==='SQLITE_BUSY')throw new HarnessError('PROFILE_IN_USE','This profile is already open in another harness process. Close that owner before starting another host.');throw error;}
 let closed=false;const owned=database;
 return {dataDir,close(){if(closed)return;owned.exec('ROLLBACK');owned.close();closed=true;}};
}
