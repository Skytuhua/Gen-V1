import {lstat,mkdir,readFile,realpath,rename,unlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import {hookSchema,hooksDocumentSchema,type Hook,type HooksDocument} from '../contracts/hooks.ts';

const empty=():HooksDocument=>({version:1,revision:0,enabled:true,hooks:[]});
const saveInput=z.strictObject({hook:hookSchema,baseRevision:z.number().int().nonnegative()});
const removeInput=z.strictObject({id:z.string(),baseRevision:z.number().int().nonnegative()});
const enabledInput=z.strictObject({enabled:z.boolean(),baseRevision:z.number().int().nonnegative()});

const settingsByDirectory=new Map<string,HookSettings>();
export function hookSettingsFor(dataDir:string){const key=resolve(dataDir);let settings=settingsByDirectory.get(key);if(!settings){settings=new HookSettings(key);settingsByDirectory.set(key,settings);}return settings;}

export class HookSettings {
 private queue:Promise<unknown>=Promise.resolve();
 private readonly directory:string;
 private readonly file:string;
 private cached:HooksDocument|null=null;
 constructor(dataDir:string){this.directory=resolve(dataDir,'hooks');this.file=join(this.directory,'hooks.json');}
 private async load():Promise<HooksDocument>{try{const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)throw Error('Invalid hooks storage');return hooksDocumentSchema.parse(JSON.parse(await readFile(this.file,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();throw new HarnessError('HOOKS_UNAVAILABLE','The hooks file could not be read. Existing hooks are kept on disk.');}}
 async read():Promise<HooksDocument>{await this.queue.catch(()=>{});return this.load();}
 /** Cached parsed document for the runner; invalidated on every mutation. */
 async snapshot():Promise<HooksDocument>{if(!this.cached)this.cached=await this.read();return this.cached;}
 private mutate(action:(value:HooksDocument)=>HooksDocument|Promise<HooksDocument>){const next=this.queue.catch(()=>{}).then(async()=>{
  await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink()||resolve(await realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase())throw new HarnessError('HOOKS_UNAVAILABLE','Hooks storage is unavailable.');
  const value=hooksDocumentSchema.parse(await action(await this.load())),serialized=JSON.stringify(value),temporary=join(this.directory,randomBytes(8).toString('hex')+'.tmp');
  try{await writeFile(temporary,serialized,{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temporary,this.file);}finally{await unlink(temporary).catch(()=>{});}
  this.cached=value;return value;
 });this.queue=next;return next;}
 private validate(hook:Hook){if(hook.matcher&&hook.matcher!=='*'){try{new RegExp('^(?:'+hook.matcher+')$');}catch{throw new HarnessError('HOOK_INVALID','The matcher is not a valid regular expression.');}}}
 async save(raw:unknown){const input=saveInput.parse(raw);this.validate(input.hook);return this.mutate(async current=>{
  if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before saving.');
  const hooks=current.hooks.filter(item=>item.id!==input.hook.id);if(hooks.length>=50)throw new HarnessError('HOOK_LIMIT','At most 50 hooks can be saved. Remove one first.');hooks.push(input.hook);return{...current,revision:current.revision+1,hooks};
 });}
 async remove(raw:unknown){const input=removeInput.parse(raw);return this.mutate(async current=>{if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before removing.');return{...current,revision:current.revision+1,hooks:current.hooks.filter(item=>item.id!==input.id)}});}
 async setEnabled(raw:unknown){const input=enabledInput.parse(raw);return this.mutate(async current=>{if(current.revision!==input.baseRevision)throw new HarnessError('HOOKS_CHANGED','Hooks changed. Refresh before saving.');return{...current,revision:current.revision+1,enabled:input.enabled}});}
}
export function newHookId(){return 'hook_'+randomBytes(6).toString('hex');}
