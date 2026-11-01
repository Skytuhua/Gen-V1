import {_electron,expect,type ElectronApplication,type Page} from '@playwright/test';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SUBSCRIPTION_CONNECTIONS,isConnectionProviderId} from '../packages/contracts/connections.ts';
import type {Snapshot} from '../packages/contracts/index.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';

// Actual desktop bridge, HTTP host and SQLite; synthetic local labels and empty profiles.
// No Connect click, credential access, task submission, sign-in or inference.
const executable=process.argv[2]&&process.argv[2]!=='--source'?resolve(process.argv[2]):undefined;
const directory=resolve('.harness-accounts-native','run-'+Date.now());
await mkdir(directory,{recursive:true});
async function freePort(){const server=createServer();await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});const port=(server.address() as {port:number}).port;await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return port;}
const hostPort=await freePort();let widgetPort=await freePort();while(widgetPort===hostPort)widgetPort=await freePort();
const env=Object.fromEntries(Object.entries({...process.env,HARNESS_DESKTOP_TEST_DATA_DIR:directory,HARNESS_DESKTOP_PORT:String(hostPort),HARNESS_DESKTOP_WIDGET_PORT:String(widgetPort),...(executable?{}:{HARNESS_DESKTOP_NODE_PATH:process.env.HARNESS_ACCOUNTS_VERIFY_NODE??process.execPath,HARNESS_DESKTOP_HOST_ROOT:resolve('.')})}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS',...(executable?['HARNESS_DESKTOP_NODE_PATH','HARNESS_DESKTOP_HOST_ROOT']:[])])delete env[key];
const requestedProvider=process.argv[3];
if(requestedProvider!==undefined&&!isConnectionProviderId(requestedProvider))throw Error('Choose an admitted provider ID for a focused probe.');
const providers=SUBSCRIPTION_CONNECTIONS.filter(row=>isConnectionProviderId(row.id)&&(!requestedProvider||row.id===requestedProvider));
const checks:{provider:string;accountId:string;passed:boolean}[]=[];
const errors:string[]=[];
const cleanupErrors:string[]=[];
const commands:unknown[]=[];
type BackendDiagnostic={pid:number;stderr:string;exitCode?:number|null;signal?:string|null};
let backendDiagnostics:BackendDiagnostic[]=[];
let app:ElectronApplication|undefined,passed=false;
const receipt=()=>({createdAt:new Date().toISOString(),executable:executable??'source desktop shell',sourceBackendNode:executable?undefined:env.HARNESS_DESKTOP_NODE_PATH,passed,scope:'Actual desktop bridge, HTTP commands and SQLite persistence for account Add/Rename/Use/Remove/Restore across the requested providers and full native restart.',requestedProviders:providers.map(provider=>provider.id),auth:false,inference:false,liveAccountAcceptance:false,checks,pageErrors:errors,cleanupErrors,commands,backendDiagnostics,ports:{hostPort,widgetPort}});
const saveReceipt=()=>writeFile(join(directory,'verification.json'),JSON.stringify(receipt(),null,2));
await saveReceipt();
const snapshot=(page:Page)=>page.evaluate(async()=>{const response=await fetch('/api/snapshot',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Snapshot failed: '+response.status);return response.json();}) as Promise<Snapshot>;
async function assertBackendAlive(){const diagnostics=await app!.evaluate(()=>(globalThis as any).__accountBackendDiagnostics??[]) as BackendDiagnostic[];backendDiagnostics.push(...diagnostics);expect(diagnostics).toHaveLength(1);expect(diagnostics[0].exitCode).toBeUndefined();}
async function launch(){
 app=await _electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[resolve('dist/desktop-app/main.mjs')]}),env,timeout:60000});
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 // Inspect only this fresh Electron owner's fixed backend child, retaining bounded
 // stderr/exit evidence so a dead sidecar cannot be misclassified as a UI timeout.
 await app.evaluate(()=>{
  const diagnostics:unknown[]=[];(globalThis as any).__accountBackendDiagnostics=diagnostics;
  const handles=(process as any)._getActiveHandles() as any[];
  for(const child of handles){
   if(!Number.isSafeInteger(child.pid)||!Array.isArray(child.spawnargs)||!child.spawnargs.some((arg:unknown)=>typeof arg==='string'&&arg.replaceAll('\\','/').endsWith('/apps/server/main.ts')))continue;
   const entry:{pid:number;stderr:string;exitCode?:number|null;signal?:string|null}={pid:child.pid,stderr:''};diagnostics.push(entry);
   child.stderr?.on('data',(bytes:Buffer)=>{entry.stderr=(entry.stderr+String(bytes)).slice(-24000);});
   child.once('exit',(code:number|null,signal:string|null)=>{entry.exitCode=code;entry.signal=signal;});
  }
 });
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/commands'){const command=request.postDataJSON();if(command?.type?.startsWith('account.'))commands.push({request:command});}});
 page.on('response',response=>{if(new URL(response.url()).pathname==='/api/commands')void response.json().then(value=>commands.push({response:value,status:response.status()})).catch(()=>{});});
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:45000});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Providers',exact:true}).click();
 return page;
}
async function stop(){
 if(app){
  const current=app;let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([current.close(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned desktop close exceeded 20 seconds')),20000);})]);app=undefined;}
  catch(error){await terminateProcessTree(current.process());app=undefined;throw error;}
  finally{clearTimeout(timer);}
 }
 await expect.poll(async()=>{try{await fetch(`http://127.0.0.1:${hostPort}/health`,{signal:AbortSignal.timeout(500)});return false;}catch{return true;}},{timeout:20000}).toBe(true);
}
try{
 let page=await launch();
 for(const provider of providers){
  const row=page.locator(`.connection-row[data-provider="${provider.id}"]`),first=`Verification A ${provider.id}`,second=`Verification B ${provider.id}`,renamed=`Verification renamed ${provider.id}`;
  for(const label of [first,second]){await row.getByRole('button',{name:'Add account',exact:true}).click();await row.getByRole('textbox',{name:'Account label',exact:true}).fill(label);await row.getByRole('button',{name:'Save account',exact:true}).click();await expect(row.getByRole('radio',{name:label,exact:true})).toBeVisible();}
  await row.getByRole('radio',{name:second,exact:true}).check();await row.getByRole('button',{name:'Use account',exact:true}).click();await expect(row).toContainText('Default for new tasks: '+second);
  await row.getByRole('button',{name:'Rename '+second,exact:true}).click();await row.getByRole('textbox',{name:'Account label',exact:true}).fill(renamed);await expect(row.getByRole('textbox',{name:'Account label',exact:true})).toHaveValue(renamed);await row.getByRole('button',{name:'Save account',exact:true}).click();await expect(row).toContainText('Default for new tasks: '+renamed);
  await row.getByRole('button',{name:'Remove '+renamed,exact:true}).click();await expect(row.getByRole('radio',{name:renamed,exact:true})).toBeDisabled();await expect(row).toContainText('Default for new tasks: Legacy connection');
  await row.getByRole('button',{name:'Restore '+renamed,exact:true}).click();await expect(row.getByRole('radio',{name:renamed,exact:true})).toBeEnabled();
  await row.getByRole('radio',{name:first,exact:true}).check();await row.getByRole('button',{name:'Use account',exact:true}).click();await expect(row).toContainText('Default for new tasks: '+first);
  const current=await snapshot(page),saved=current.accounts?.find(account=>account.providerId===provider.id&&account.label===first);
  expect(saved?.enabled).toBe(true);expect(current.settings.selectedAccounts?.[provider.id as keyof NonNullable<Snapshot['settings']['selectedAccounts']>]).toBe(saved!.id);
  checks.push({provider:provider.id,accountId:saved!.id,passed:true});
  await saveReceipt();
 }
 await assertBackendAlive();await page.screenshot({path:join(directory,'accounts-before-restart.png')});
 await stop();page=await launch();
 const restored=await snapshot(page);expect(restored.accounts).toHaveLength(providers.length*2);
 for(const check of checks){expect(restored.settings.selectedAccounts?.[check.provider as keyof NonNullable<Snapshot['settings']['selectedAccounts']>]).toBe(check.accountId);const row=page.locator(`.connection-row[data-provider="${check.provider}"]`);await expect(row.getByRole('radio',{name:`Verification A ${check.provider}`,exact:true})).toBeChecked();await expect(row.getByRole('radio',{name:`Verification renamed ${check.provider}`,exact:true})).toBeEnabled();}
 await assertBackendAlive();expect(errors).toEqual([]);await page.screenshot({path:join(directory,'accounts-after-restart.png')});
 await stop();passed=true;
}catch(error){errors.push(error instanceof Error?error.message:String(error));backendDiagnostics=await app?.evaluate(()=>(globalThis as any).__accountBackendDiagnostics??[]).catch(()=>[]);const page=app?.windows().find(page=>!page.isClosed());if(page){await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});await writeFile(join(directory,'failure-snapshot.json'),JSON.stringify(await snapshot(page).catch(()=>null),null,2));await writeFile(join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;
}finally{
 let cleanupFailure:unknown;
 try{await stop();}catch(error){cleanupFailure=error;cleanupErrors.push(error instanceof Error?error.message:String(error));passed=false;}
 await saveReceipt();
 console.log(JSON.stringify({directory,passed,providers:checks.length}));
 if(cleanupFailure)throw cleanupFailure;
}
