import {chromium,expect,type Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {terminateProcessTree} from '../../packages/runtime-pi/process-tree.ts';

export async function installedSession(executable:string,action:(page:Page)=>Promise<void>){
 if(Object.keys(process.env).some(key=>/^HARNESS_/i.test(key)))throw Error('Remove all HARNESS_* overrides before a real-profile installed launch.');
 const server=createServer();await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const address=server.address();if(!address||typeof address==='string')throw Error('No CDP port.');const port=address.port;await new Promise<void>(accept=>server.close(()=>accept()));
 const nonce=randomUUID(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 const child=spawn(resolve(executable),['--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{env,stdio:'ignore'});let spawnError:Error|undefined;child.once('error',error=>{spawnError=error;});let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined,owned=false;
 try{
  await expect.poll(async()=>{if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Installed app exited before CDP.');try{return (await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:60000}).toBe(true);
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const session=await browser.newBrowserCDPSession();const {arguments:argv}=await session.send('Browser.getBrowserCommandLine');await session.detach();if(!argv.includes('--harness-verification='+nonce)||resolve(argv[0]).toLowerCase()!==resolve(executable).toLowerCase())throw Error('CDP process ownership mismatch.');owned=true;
  await expect.poll(()=>browser!.contexts().flatMap(context=>context.pages()).some(page=>/^http:\/\/127\.0\.0\.1:4317\//.test(page.url())),{timeout:90000}).toBe(true);
  const page=browser.contexts().flatMap(context=>context.pages()).find(page=>/^http:\/\/127\.0\.0\.1:4317\//.test(page.url()))!;await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:60000});await action(page);
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});await expect.poll(()=>child.exitCode,{timeout:30000}).toBe(0);
 }finally{if(owned)await browser?.close();if(child.exitCode===null&&child.signalCode===null)await terminateProcessTree(child);}
}
