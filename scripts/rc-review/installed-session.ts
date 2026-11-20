import {chromium,expect,type Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {terminateProcessTree} from '../../packages/runtime-pi/process-tree.ts';
import {run} from './common.ts';

export async function nativeBounds(pid:number,bounds?:{left:number;top:number;width:number;height:number}){
 if(!Number.isInteger(pid)||pid<1||bounds&&(!Object.values(bounds).every(Number.isInteger)||bounds.width<1||bounds.height<1))throw Error('Invalid native window bounds.');
 const script=String.raw`$ErrorActionPreference='Stop';Add-Type @'
using System;using System.Runtime.InteropServices;public class RcWindow{public delegate bool Visitor(IntPtr w,IntPtr l);[DllImport("user32.dll")]public static extern bool EnumWindows(Visitor f,IntPtr l);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr w);[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr w,out Rect r);[DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr w,int x,int y,int width,int height,bool repaint);public struct Rect{public int Left,Top,Right,Bottom;}}
'@
$script:found=[IntPtr]::Zero;[RcWindow]::EnumWindows({param($w,$l) [uint32]$owner=0;[void][RcWindow]::GetWindowThreadProcessId($w,[ref]$owner);if($owner -eq [uint32]$env:RC_PID -and [RcWindow]::IsWindowVisible($w)){$script:found=$w;return $false};return $true},[IntPtr]::Zero)|Out-Null;if($script:found -eq [IntPtr]::Zero){throw 'Owned native window not found'};if($env:RC_BOUNDS){$b=$env:RC_BOUNDS|ConvertFrom-Json;if(-not [RcWindow]::MoveWindow($script:found,$b.left,$b.top,$b.width,$b.height,$true)){throw 'MoveWindow failed'}};$r=New-Object RcWindow+Rect;if(-not [RcWindow]::GetWindowRect($script:found,[ref]$r)){throw 'GetWindowRect failed'};[Console]::Write((@{left=$r.Left;top=$r.Top;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top}|ConvertTo-Json -Compress))`;
 return JSON.parse(await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{capture:true,env:{...process.env,RC_PID:String(pid),RC_BOUNDS:bounds?JSON.stringify(bounds):''}})) as {left:number;top:number;width:number;height:number};
}

export async function cleanupInstalledSession(closeBrowser:(()=>Promise<void>)|undefined,stopChild:()=>Promise<void>){try{await closeBrowser?.();}catch(error){try{await stopChild();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Installed RC session cleanup failed.');}throw error;}await stopChild();}

export async function installedSession(executable:string,action:(page:Page,pid:number)=>Promise<void>){
 if(Object.keys(process.env).some(key=>/^HARNESS_/i.test(key)))throw Error('Remove all HARNESS_* overrides before a real-profile installed launch.');
 const server=createServer();await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const address=server.address();if(!address||typeof address==='string')throw Error('No CDP port.');const port=address.port;await new Promise<void>(accept=>server.close(()=>accept()));
 const nonce=randomUUID(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 const child=spawn(resolve(executable),['--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{env,stdio:'ignore'});let spawnError:Error|undefined;child.once('error',error=>{spawnError=error;});let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,owned=false;
 try{
  await expect.poll(async()=>{if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Installed app exited before CDP.');try{return (await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:60000}).toBe(true);
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const session=await browser.newBrowserCDPSession();const {arguments:argv}=await session.send('Browser.getBrowserCommandLine');await session.detach();if(!argv.includes('--harness-verification='+nonce)||resolve(argv[0]).toLowerCase()!==resolve(executable).toLowerCase())throw Error('CDP process ownership mismatch.');owned=true;
  await expect.poll(()=>browser!.contexts().flatMap(context=>context.pages()).some(page=>/^http:\/\/127\.0\.0\.1:4317\//.test(page.url())),{timeout:90000}).toBe(true);
  const page=browser.contexts().flatMap(context=>context.pages()).find(page=>/^http:\/\/127\.0\.0\.1:4317\//.test(page.url()))!;await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:60000});await action(page,child.pid!);
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});await expect.poll(()=>child.exitCode,{timeout:30000}).toBe(0);
 }finally{await cleanupInstalledSession(owned&&browser?()=>browser!.close():undefined,async()=>{if(child.exitCode===null&&child.signalCode===null)await terminateProcessTree(child);});}
}
