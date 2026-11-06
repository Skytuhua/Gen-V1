import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {launchDesktopSignIn,desktopSignInArguments,parseDesktopSignInTarget,quoteWindowsArgument} from '../apps/desktop/auth-launcher.ts';
import {execFileSync} from 'node:child_process';

describe('packaged subscription sign-in',()=>{
 it('validates both IPC account fields and preserves legacy provider calls',()=>{
  const accountId='8933cc31-976d-4f76-a183-035c4b3263e8';
  expect(parseDesktopSignInTarget({provider:'openai',accountId})).toEqual({provider:'openai',accountId});
  expect(parseDesktopSignInTarget('claude-code')).toEqual({provider:'claude-code'});
  expect(parseDesktopSignInTarget(undefined)).toEqual({provider:'openai'});
  for(const value of [{provider:'openai',accountId,exec:'cmd'}, {provider:'openai',accountId:'../other'}, Object.assign(Object.create({provider:'openai'}),{accountId,exec:'cmd'}), ['openai',accountId]])expect(()=>parseDesktopSignInTarget(value)).toThrow();
 });
 it('targets an explicit opaque account without accepting a renderer profile path',()=>{
  const root=resolve('host'),data=resolve('data'),id='8933cc31-976d-4f76-a183-035c4b3263e8';
  expect(desktopSignInArguments(root,data,'claude-code',id).slice(-4)).toEqual(['--provider','claude-code','--account-id',id]);
  expect(()=>desktopSignInArguments(root,data,'openai','../other')).toThrow();
 });
 it('uses only the fixed bundled login entry and a file URL loader',()=>{
  const root=resolve('a folder with spaces');
  const args=desktopSignInArguments(root,resolve('data folder'));
  expect(args).toEqual(['--import',pathToFileURL(join(root,'node_modules/tsx/dist/loader.mjs')).href,join(root,'packages/runtime-login/index.ts'),'--data-dir',resolve('data folder'),'--provider','openai']);
  expect(args.join(' ')).not.toContain('pnpm');
 });
 it('quotes Windows argument data without turning it into script text',()=>{
  expect(quoteWindowsArgument('C:\\folder with spaces\\')).toBe('"C:\\folder with spaces\\\\"');
  expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"');
 });
 it.runIf(process.platform==='win32')('rejects arbitrary executables before opening a console',async()=>{
  await expect(launchDesktopSignIn({nodePath:resolve('cmd.exe'),hostRoot:resolve('.'),dataDir:resolve('data')})).rejects.toThrow(/bundled Node/);
  await expect(launchDesktopSignIn({nodePath:process.execPath,hostRoot:'relative',dataDir:resolve('data')})).rejects.toThrow(/paths/);
 });
 it('rejects an already revoked startup before process creation',async()=>{
  const control=new AbortController();control.abort();await expect(launchDesktopSignIn({nodePath:process.execPath,hostRoot:resolve('.'),dataDir:resolve('data'),signal:control.signal})).rejects.toThrow('cancelled');
 });
 it.runIf(process.platform==='win32')('opens a real interactive console with the bundled-style Node path',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness desktop auth '));
  await mkdir(join(root,'packages/runtime-login'),{recursive:true});await mkdir(join(root,'node_modules/tsx/dist'),{recursive:true});
  await writeFile(join(root,'node_modules/tsx/dist/loader.mjs'),'export {};');
  await writeFile(join(root,'packages/runtime-login/index.ts'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root,'tty.json'))},JSON.stringify({stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,args:process.argv.slice(2)}));console.log('CONSOLE_ONLY_SENTINEL');setTimeout(()=>{},100);`);
  const handle=await launchDesktopSignIn({nodePath:process.execPath,hostRoot:root,dataDir:join(root,'data')});
  await handle.completion;
  const tty=JSON.parse(await readFile(join(root,'tty.json'),'utf8'));
  expect(tty.stdin).toBe(true);expect(tty.stdout).toBe(true);expect(tty.args).toEqual(['--data-dir',join(root,'data'),'--provider','openai']);
 },20000);
 it.runIf(process.platform==='win32')('cancels its owned interactive process and reports cancellation without forwarding console output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness desktop auth cancel '));await mkdir(join(root,'packages/runtime-login'),{recursive:true});await mkdir(join(root,'node_modules/tsx/dist'),{recursive:true});await writeFile(join(root,'node_modules/tsx/dist/loader.mjs'),'export {};');
  await writeFile(join(root,'packages/runtime-login/index.ts'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root,'pid.json'))},JSON.stringify({pid:process.pid}));console.log('CONSOLE_ONLY_SENTINEL');setInterval(()=>{},1000);`);
  const handle=await launchDesktopSignIn({nodePath:process.execPath,hostRoot:root,dataDir:join(root,'data')});
  let pid=0;try{for(let attempt=0;attempt<50;attempt++){try{pid=JSON.parse(await readFile(join(root,'pid.json'),'utf8')).pid;break;}catch{await new Promise(accept=>setTimeout(accept,20));}}expect(pid).toBeGreaterThan(0);await handle.cancel();await expect(handle.completion).rejects.toThrow('cancelled');expect(()=>process.kill(pid,0)).toThrow();}finally{await handle.cancel();}
 },20000);
 it.runIf(process.platform==='win32')('cancels a native sign-in descendant as well as its console helper',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness auth descendants '));await mkdir(join(root,'packages/runtime-login'),{recursive:true});await mkdir(join(root,'node_modules/tsx/dist'),{recursive:true});await writeFile(join(root,'node_modules/tsx/dist/loader.mjs'),'export {};');
  await writeFile(join(root,'packages/runtime-login/index.ts'),`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});writeFileSync(${JSON.stringify(join(root,'pid.json'))},JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`);
  const handle=await launchDesktopSignIn({nodePath:process.execPath,hostRoot:root,dataDir:join(root,'data')});let pid=0;
  try{for(let attempt=0;attempt<100;attempt++){try{pid=JSON.parse(await readFile(join(root,'pid.json'),'utf8')).pid;break;}catch{await new Promise(done=>setTimeout(done,20));}}expect(pid).toBeGreaterThan(0);await handle.cancel();await expect(handle.completion).rejects.toThrow('cancelled');expect(()=>process.kill(pid,0)).toThrow();}
  finally{await handle.cancel();if(pid){try{process.kill(pid,0);execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}}
 },20000);
 it.runIf(process.platform==='win32')('cancels startup before metadata without leaving a late interactive process',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness desktop auth early '));await mkdir(join(root,'packages/runtime-login'),{recursive:true});await mkdir(join(root,'node_modules/tsx/dist'),{recursive:true});await writeFile(join(root,'node_modules/tsx/dist/loader.mjs'),'export {};');
  await writeFile(join(root,'packages/runtime-login/index.ts'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root,'pid.json'))},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
  const control=new AbortController(),starting=launchDesktopSignIn({nodePath:process.execPath,hostRoot:root,dataDir:join(root,'data'),signal:control.signal});control.abort();await expect(starting).rejects.toThrow('cancelled');
  let pid=0;try{pid=JSON.parse(await readFile(join(root,'pid.json'),'utf8')).pid;}catch{}if(pid)expect(()=>process.kill(pid,0)).toThrow();
 },20000);
 it.runIf(process.platform==='win32')('preserves Unicode, spaces and literal shell characters in host and data paths',async()=>{
  const root=await mkdtemp(join(tmpdir(),'harness 中文 $() '));await mkdir(join(root,'packages/runtime-login'),{recursive:true});await mkdir(join(root,'node_modules/tsx/dist'),{recursive:true});await writeFile(join(root,'node_modules/tsx/dist/loader.mjs'),'export {};');
  await writeFile(join(root,'packages/runtime-login/index.ts'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root,'args.json'))},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),tty:process.stdin.isTTY}));`);
  const dataDir=join(root,'资料 with spaces $()'),handle=await launchDesktopSignIn({nodePath:process.execPath,hostRoot:root,dataDir});try{await handle.completion;const value=JSON.parse(await readFile(join(root,'args.json'),'utf8'));expect(value.args).toEqual(['--data-dir',dataDir,'--provider','openai']);expect(value.cwd).toBe(root);expect(value.tty).toBe(true);}finally{await handle.cancel();}
 },20000);
});
