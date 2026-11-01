import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {officialRuntimeCommand,officialRuntimeEnvironment,officialRuntimeHome,type OfficialProvider} from '../packages/runtime-official/environment.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';

const directory=resolve('.harness-official-distributions/run-'+Date.now());await mkdir(directory,{recursive:true});
const checks=[];
for(const provider of ['claude-code','gemini-cli'] as OfficialProvider[]){
 const command=officialRuntimeCommand(provider),env=officialRuntimeEnvironment(directory,provider),home=officialRuntimeHome(directory,provider);
 await Promise.all([home,env.TEMP!,env.APPDATA!,env.LOCALAPPDATA!,env.XDG_CONFIG_HOME!].map(path=>mkdir(path,{recursive:true})));
 const started=Date.now(),child=spawn(command.file,[...command.args,'--version'],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 const output=await new Promise<string>((done,reject)=>{
  let text='';const timer=setTimeout(()=>{void terminateProcessTree(child).finally(()=>reject(Error('Official distribution version check exceeded its deadline.')));},30000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.stdout.on('data',chunk=>{text+=String(chunk);if(text.length>65536){void terminateProcessTree(child);reject(Error('Official version output exceeded its bound.'));}});
  child.stderr.on('data',()=>{});
  child.once('close',code=>{clearTimeout(timer);code===0?done(text.trim()):reject(Error('Official distribution version check failed.'));});
 });
 const entry=command.args[0]??command.file;
 checks.push({provider,passed:true,versionOutput:output,elapsedMs:Date.now()-started,distributionEntry:entry,entrySha256:createHash('sha256').update(await readFile(entry)).digest('hex'),arguments:['--version'],auth:false,inference:false});
}
await writeFile(join(directory,'verification.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Published bundled CLI startup/version only; isolated empty homes, no auth or inference.',checks},null,2));
console.log(JSON.stringify({directory,checks}));
