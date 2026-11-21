import {mkdir,readFile,rename,writeFile,lstat,realpath,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import {hookSchema,hooksDocumentSchema,type Hook,type HooksDocument} from '../contracts/hooks.ts';

// Hooks are global (device-level): a single file-backed document under
// <dataDir>/hooks/, which security.ts lists as PROTECTED_STORAGE so agent file
// tools can never reach it. Follows the EnvironmentSettings pattern: strict
// schema, serialized mutations, temp-file rename, optimistic baseRevision.
const empty=():HooksDocument=>({version:1,revision:0,enabled:true,hooks:[]});
const hookId=()=>'hook_'+randomUUID().replace(/-/g,'').slice(0,16);
const matcherOk=(matcher:string)=>{if(!matcher||matcher==='*')return;try{new RegExp(matcher);}catch{throw new HarnessError('HOOKS_INVALID','The hook matcher must be a valid regular expression.');}};
const putInput=z.strictObject({hook:hookSchema.omit({id:true}).extend({id:hookSchema.shape.id.optional()}),baseRevision:z.number().int().nonnegative()});
const idInput=z.strictObject({id:hookSchema.shape.id,baseRevision:z.number().int().nonnegative()});
const enabledInput=z.strictObject({enabled:z.boolean(),baseRevision:z.number().int().nonnegative()});

const settingsByDirectory=new Map<string,HookSettings>();
export function hookSettingsFor(dataDir:string){const key=resolve(dataDir);let settings=settingsByDirectory.get(key);if(!settings){settings=new HookSettings(key);settingsByDirectory.set(key,settings);}return settings;}

export class HookSettings {
 private queue:Promise<unknown>=Promise.resolve();
 private readonly directory:string;
 private readonly file:string;
 private cached:HooksDocument|undefined;
 constructor(dataDir:string){this.directory=resolve(dataDir,'hooks');this.file=join(this.directory,'hooks.json');void this.load().catch(()=>{});}
 private async load():Promise<HooksDocument>{try{const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw Error('Invalid hooks storage');this.cached=hooksDocumentSchema.parse(JSON.parse(await readFile(this.file,'utf8')));return this.cached;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();throw new HarnessError('HOOKS_UNAVAILABLE','Hooks could not be read. Existing hooks are kept on disk.');}}
 async read():Promise<HooksDocument>{await this.queue.catch(()=>{});return this.load();}
 /** Cached parsed document for the runner: one in-memory lookup per tool call, no file read. */
 snapshot():HooksDocument{return this.cached??empty();}
 private mutate(action:(value:HooksDocument)=>HooksDocument|Promise<HooksDocument>){const next=this.queue.catch(()=>{}).then(async()=>{
  await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink()||resolve(await realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase())throw new HarnessError('HOOKS_UNAVAILABLE','Hook storage is unavailable.');
  const value=hooksDocumentSchema.parse(await action(await this.load())),serialized=JSON.stringify(value),temporary=join(this.directory,randomUUID()+'.tmp');
  if(Buffer.byteLength(serialized,'utf8')>2*1024*1024)throw new HarnessError('HOOKS_LIMIT','Hooks reached the storage limit. Remove an unused hook before adding another.');
  try{await writeFile(temporary,serialized,{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temporary,this.file);}finally{await unlink(temporary).catch(()=>{});}
  this.cached=value;
  return value;
 });this.queue=next;return next;}
 async save(raw:unknown):Promise<HooksDocument>{const input=putInput.parse(raw);matcherOk(input.hook.matcher);return this.mutate(current=>{
  if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before saving.');
  const hook:Hook={...input.hook,id:input.hook.id??hookId()};
  return {...current,revision:current.revision+1,hooks:[...current.hooks.filter(item=>item.id!==hook.id),hook]};
 });}
 async remove(raw:unknown):Promise<HooksDocument>{const input=idInput.parse(raw);return this.mutate(current=>{
  if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before removing.');
  return {...current,revision:current.revision+1,hooks:current.hooks.filter(item=>item.id!==input.id)};
 });}
 async setEnabled(raw:unknown):Promise<HooksDocument>{const input=enabledInput.parse(raw);return this.mutate(current=>{
  if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before saving.');
  return {...current,revision:current.revision+1,enabled:input.enabled};
 });}
}
