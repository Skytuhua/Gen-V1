import {spawn,type ChildProcess} from 'node:child_process';
import {isAbsolute,basename,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isConnectionProviderId,type ConnectionProviderId} from '../../packages/contracts/connections.ts';
import {isAccountId} from '../../packages/contracts/accounts.ts';

export interface DesktopSignInOptions {nodePath:string;hostRoot:string;dataDir:string;provider?:ConnectionProviderId;accountId?:string;signal?:AbortSignal}
export interface DesktopSignInHandle {completion:Promise<void>;cancel():Promise<void>}

export function quoteWindowsArgument(value:string):string {
 if(/[\u0000-\u001f]/.test(value))throw Error('Invalid sign-in argument');
 return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
}
export function parseDesktopSignInTarget(value:unknown):{provider:ConnectionProviderId;accountId?:string}{
 if(value===undefined)return {provider:'openai'};
 if(isConnectionProviderId(value))return {provider:value};
 if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&['provider','accountId'].every(key=>Object.hasOwn(value,key))){const input=value as Record<string,unknown>;if(isConnectionProviderId(input.provider)&&isAccountId(input.accountId))return {provider:input.provider,accountId:input.accountId};}
 throw Error('Choose an available provider and saved account. Sign-in accepts no executable arguments.');
}
export function desktopSignInArguments(hostRoot:string,dataDir:string,provider:ConnectionProviderId='openai',accountId?:string):string[] {
 if(!isConnectionProviderId(provider))throw Error('Unsupported subscription provider');
 if(accountId!==undefined&&!isAccountId(accountId))throw Error('Choose a saved subscription account.');
 return ['--import',pathToFileURL(join(hostRoot,'node_modules/tsx/dist/loader.mjs')).href,join(hostRoot,'packages/runtime-login/index.ts'),'--data-dir',dataDir,'--provider',provider,...(accountId?['--account-id',accountId]:[])];
}

// Only this fixed helper is executed. Paths/arguments arrive as JSON data on
// stdin, never as interpolated PowerShell code. The actual login console owns
// its input/output; authorization codes cannot enter the desktop logs or IPC.
const helper=String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $config = [Console]::In.ReadLine() | ConvertFrom-Json
  Add-Type -TypeDefinition 'using System; using System.Threading.Tasks; public static class HarnessDesktopLogin { public static Task<string> ReadCancellation() { return Task.Run(() => Console.In.ReadLine()); } }'
  $process = Start-Process -FilePath $config.nodePath -ArgumentList $config.arguments -WorkingDirectory $config.hostRoot -WindowStyle Normal -PassThru
  $handle = $process.Handle
  [Console]::Out.WriteLine((@{type='started';pid=$process.Id} | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $cancellation = [HarnessDesktopLogin]::ReadCancellation()
  while (-not $process.WaitForExit(100)) {
    if ($cancellation.IsCompleted) {
      $process.Kill()
      $process.WaitForExit()
      [Console]::Out.WriteLine('{"type":"cancelled"}')
      exit 0
    }
  }
  [Console]::Out.WriteLine((@{type='complete';exitCode=$process.ExitCode} | ConvertTo-Json -Compress))
  exit 0
} catch {
  [Console]::Out.WriteLine('{"type":"error"}')
  exit 1
} finally {
  if ($process -and -not $process.HasExited) { try { $process.Kill() } catch {} }
}
`;

function paths(options:DesktopSignInOptions){
 if(process.platform!=='win32')throw Error('Desktop subscription sign-in requires Windows');
 for(const path of [options.nodePath,options.hostRoot,options.dataDir])if(!isAbsolute(path)||/[\u0000-\u001f"]/.test(path))throw Error('Desktop sign-in paths are invalid');
 if(basename(options.nodePath).toLowerCase()!=='node.exe')throw Error('The bundled Node executable is required for sign-in');
 const systemRoot=resolve(process.env.SystemRoot??'C:/Windows');
 return {executable:join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),taskkill:join(systemRoot,'System32/taskkill.exe'),arguments:desktopSignInArguments(resolve(options.hostRoot),resolve(options.dataDir),options.provider,options.accountId).map(quoteWindowsArgument).join(' ')};
}

export async function launchDesktopSignIn(options:DesktopSignInOptions):Promise<DesktopSignInHandle>{
 if(options.signal?.aborted)throw Error('Subscription sign-in cancelled.');
 const launch=paths(options),env:NodeJS.ProcessEnv={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 const child:ChildProcess=spawn(launch.executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',helper],{env,windowsHide:true,stdio:['pipe','pipe','ignore']});
 let started=false,startSettled=false,finished=false,cancelled=false,exitCode:number|undefined,buffer='',startTimer:ReturnType<typeof setTimeout>|undefined,stopping:Promise<void>|undefined,failure:string|undefined;
 let acceptStart!:(handle:DesktopSignInHandle)=>void,rejectStart!:(error:Error)=>void,acceptCompletion!:()=>void,rejectCompletion!:(error:Error)=>void;
 const start=new Promise<DesktopSignInHandle>((accept,reject)=>{acceptStart=accept;rejectStart=reject;});
 const completion=new Promise<void>((accept,reject)=>{acceptCompletion=accept;rejectCompletion=reject;});void completion.catch(()=>{});
 const settle=(code:number|null)=>{if(finished)return;finished=true;clearTimeout(startTimer);options.signal?.removeEventListener('abort',abort);const message=cancelled?'Subscription sign-in cancelled.':failure??(!started?'The subscription sign-in console could not open.':'Subscription sign-in did not finish. Try again.');if(!startSettled){startSettled=true;rejectStart(Error(message));}if(!cancelled&&!failure&&started&&code===0&&exitCode===0)acceptCompletion();else rejectCompletion(Error(message));};
 // The fallback targets only the still-running helper spawned above. /T is
 // essential: killing PowerShell alone could leave its interactive Node alive.
 const terminateTree=()=>new Promise<void>(accept=>{if(!child.pid||child.exitCode!==null||child.signalCode){accept();return;}const kill=spawn(launch.taskkill,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('error',()=>accept());kill.once('exit',()=>accept());});
 const cancel=()=>stopping??= (async()=>{if(finished)return;cancelled=true;child.stdin?.write('cancel\n');let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([completion.catch(()=>{}),new Promise<void>(accept=>{timer=setTimeout(()=>{void terminateTree().then(accept);},5000);})]);}finally{clearTimeout(timer);}})();
 const abort=()=>{void cancel();};
 const handle:DesktopSignInHandle={completion,cancel};
 const invalid=()=>{failure='The subscription sign-in console returned an invalid response.';void terminateTree();};
 child.once('error',()=>{failure='The subscription sign-in console could not open.';settle(null);});
 child.stdout?.on('data',chunk=>{
  buffer+=String(chunk);if(buffer.length>4096){invalid();return;}
  let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(!line)continue;let parsed:unknown;try{parsed=JSON.parse(line);}catch{invalid();return;}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.getPrototypeOf(parsed)!==Object.prototype){invalid();return;}const value=parsed as Record<string,unknown>,keys=Object.keys(value);
   if(value.type==='started'&&!started&&keys.length===2&&Number.isSafeInteger(value.pid)&&Number(value.pid)>0){started=true;clearTimeout(startTimer);if(!cancelled){startSettled=true;acceptStart(handle);}}
   else if(value.type==='complete'&&keys.length===2&&Number.isInteger(value.exitCode))exitCode=Number(value.exitCode);
   else if(value.type==='cancelled'&&keys.length===1)cancelled=true;
   else if(value.type==='error'&&keys.length===1)failure='The subscription sign-in console could not complete. Try again.';
   else {invalid();return;}
  }
 });
 child.once('exit',settle);
 startTimer=setTimeout(()=>{failure='The subscription sign-in console did not become ready.';void terminateTree();},15000);
 child.stdin?.on('error',()=>{});child.stdin?.write(JSON.stringify({nodePath:options.nodePath,hostRoot:options.hostRoot,arguments:launch.arguments})+'\n');
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 return start;
}
