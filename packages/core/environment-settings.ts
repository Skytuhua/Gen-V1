import {mkdir,readFile,rename,writeFile,lstat,realpath,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';

// These values are for project tools. Subscription runtimes retain their own
// pinned environments, authentication homes, model selection and billing route.
const reserved=/^(?:PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMP|TEMP|TMPDIR|COMSPEC|SYSTEMROOT|WINDIR|PATHEXT|LD_.*|DYLD_.*|NODE_.*|ELECTRON_.*|HARNESS_.*|GEN_.*|PI_.*|CODEX_.*|CLAUDE_.*|GEMINI_.*|CURSOR_.*|OPENAI_BASE_URL|ANTHROPIC_BASE_URL|GOOGLE_GEMINI_BASE_URL)$/i;
export const environmentName=z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/).refine(value=>!reserved.test(value),'This name is reserved for runtime or host configuration.');
const scope=z.string().regex(/^(?:device|project:[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/);
const entry=z.strictObject({scope,name:environmentName,secret:z.boolean(),stored:z.string().max(65536),updatedAt:z.string().datetime()});
const document=z.strictObject({version:z.literal(1),revision:z.number().int().nonnegative(),entries:z.array(entry).max(200)});
type EnvironmentDocument=z.infer<typeof document>;
export interface EnvironmentMetadata {revision:number;secretStorageAvailable:boolean;appliesTo:'new-project-terminals';entries:{scope:string;name:string;secret:boolean;configured:true;updatedAt:string}[]}
export interface SecretCodec {protect(value:string):Promise<string>;unprotect(value:string):Promise<string>}
const empty=():EnvironmentDocument=>({version:1,revision:0,entries:[]});

/** Current-user DPAPI. The value travels through stdin, never a command line,
 * ordinary Store transaction, child error, environment variable or diagnostic. */
export function windowsSecretCodec():SecretCodec {
 const run=(operation:'protect'|'unprotect',value:string):Promise<string>=>new Promise((accept,reject)=>{
  if(process.platform!=='win32'){reject(new HarnessError('SECRET_STORAGE_UNAVAILABLE','Protected secret storage is unavailable on this host.'));return;}
  const script="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Security; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; if($r.operation -eq 'protect'){$b=[Text.Encoding]::UTF8.GetBytes([string]$r.value); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))}else{$b=[Convert]::FromBase64String([string]$r.value); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))}";
  const child=spawn(join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let output='',done=false;const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else accept(output.replace(/\r?\n$/,''));};
  const timer=setTimeout(()=>{child.kill();finish(new HarnessError('SECRET_STORAGE_UNAVAILABLE','Protected secret storage did not respond.'));},10000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();finish(new HarnessError('SECRET_STORAGE_UNAVAILABLE','Protected storage returned an invalid value.'));}});
  child.once('error',()=>finish(new HarnessError('SECRET_STORAGE_UNAVAILABLE','Protected secret storage is unavailable.')));
  child.once('close',code=>finish(code===0?undefined:new HarnessError('SECRET_STORAGE_UNAVAILABLE','Protected secret storage is unavailable.')));
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({operation,value}));
 });
 return {protect:value=>run('protect',value),unprotect:value=>run('unprotect',value)};
}
const settingsByDirectory=new Map<string,EnvironmentSettings>();
export function environmentSettingsFor(dataDir:string){const key=resolve(dataDir);let settings=settingsByDirectory.get(key);if(!settings){settings=new EnvironmentSettings(key);settingsByDirectory.set(key,settings);}return settings;}

export class EnvironmentSettings {
 private queue:Promise<unknown>=Promise.resolve();
 private readonly directory:string;
 private readonly file:string;
 private readonly codec:SecretCodec;
 private readonly secretStorageAvailable:boolean;
 constructor(dataDir:string,codec?:SecretCodec){this.directory=resolve(dataDir,'environment');this.file=join(this.directory,'values.json');this.codec=codec??windowsSecretCodec();this.secretStorageAvailable=Boolean(codec)||process.platform==='win32';}
 private async load():Promise<EnvironmentDocument>{try{const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw Error('Invalid environment storage');return document.parse(JSON.parse(await readFile(this.file,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return empty();throw new HarnessError('ENVIRONMENT_UNAVAILABLE','Environment settings could not be read. Existing values are retained.');}}
 private metadata(value:EnvironmentDocument):EnvironmentMetadata{return{revision:value.revision,secretStorageAvailable:this.secretStorageAvailable,appliesTo:'new-project-terminals',entries:value.entries.map(({stored:_stored,...item})=>({...item,configured:true}))};}
 async read():Promise<EnvironmentMetadata>{await this.queue.catch(()=>{});return this.metadata(await this.load());}
 private mutate(action:(value:EnvironmentDocument)=>Promise<EnvironmentDocument>){const next=this.queue.catch(()=>{}).then(async()=>{
  await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink()||resolve(await realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase())throw new HarnessError('ENVIRONMENT_UNAVAILABLE','Environment storage is unavailable.');
  const value=document.parse(await action(await this.load())),serialized=JSON.stringify(value),temporary=join(this.directory,randomUUID()+'.tmp');
  if(Buffer.byteLength(serialized,'utf8')>2*1024*1024)throw new HarnessError('ENVIRONMENT_LIMIT','Environment settings reached the storage limit. Remove an unused value before adding another.');
  try{await writeFile(temporary,serialized,{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temporary,this.file);}finally{await unlink(temporary).catch(()=>{});}
  return this.metadata(value);
 });this.queue=next;return next;}
 async save(raw:unknown){const input=z.strictObject({scope,name:environmentName,value:z.string().min(1).max(8192).refine(value=>!value.includes('\0')),secret:z.boolean(),baseRevision:z.number().int().nonnegative()}).parse(raw);return this.mutate(async current=>{
  if(current.revision!==input.baseRevision)throw new HarnessError('ENVIRONMENT_CHANGED','Environment settings changed. Refresh before saving.');
  const stored=input.secret?await this.codec.protect(input.value):input.value;
  const entries=current.entries.filter(item=>item.scope!==input.scope||item.name!==input.name);entries.push({scope:input.scope,name:input.name,secret:input.secret,stored,updatedAt:new Date().toISOString()});return{version:1 as const,revision:current.revision+1,entries};
 });}
 async remove(raw:unknown){const input=z.strictObject({scope,name:environmentName,baseRevision:z.number().int().nonnegative()}).parse(raw);return this.mutate(async current=>{if(current.revision!==input.baseRevision)throw new HarnessError('ENVIRONMENT_CHANGED','Environment settings changed. Refresh before removing.');return{...current,revision:current.revision+1,entries:current.entries.filter(item=>item.scope!==input.scope||item.name!==input.name)};});}
 /** Host use only; never exposed by the Settings HTTP endpoint or plug-in RPC. */
 async resolve(projectId:string):Promise<Record<string,string>>{scope.parse('project:'+projectId);await this.queue.catch(()=>{});const current=await this.load(),values:Record<string,string>={};for(const layer of ['device','project:'+projectId])for(const item of current.entries.filter(value=>value.scope===layer))values[item.name]=item.secret?await this.codec.unprotect(item.stored):item.stored;return values;}
}
