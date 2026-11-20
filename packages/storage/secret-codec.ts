import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {HarnessError} from '../contracts/index.ts';

export interface SecretCodec {protect(value:string):Promise<string>;unprotect(value:string):Promise<string>}

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
