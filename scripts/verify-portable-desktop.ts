import {chromium,expect,type Browser} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {verificationPorts,assertWrapperRunning,assertWrapperArguments} from './portable-verification.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';

const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')) as {version:string};
const executable=resolve(process.argv[2]??`dist/desktop-release-${version}/Gen-V1-${version}-win-x64.exe`);
const directory=resolve('.harness-desktop-portable/run-'+Date.now());await mkdir(directory,{recursive:true});
const [hostPort,widgetPort,debugPort]=await verificationPorts(),nonce=randomUUID(),origin='http://127.0.0.1:'+hostPort,debugOrigin='http://127.0.0.1:'+debugPort;
const env=Object.fromEntries(Object.entries({...process.env,HARNESS_DESKTOP_TEST_DATA_DIR:directory,HARNESS_DESKTOP_PORT:String(hostPort),HARNESS_DESKTOP_WIDGET_PORT:String(widgetPort)}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','HARNESS_DESKTOP_NODE_PATH','HARNESS_DESKTOP_HOST_ROOT'])delete env[key];
// Launch the portable wrapper itself, not an unpacked executable or development runtime.
const child=spawn(executable,['--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{env,windowsHide:false,stdio:'ignore'});
let launchError:Error|undefined;child.once('error',error=>{launchError=error;});
let browser:Browser|undefined,verifiedOwner=false,passed=false;const startedAt=Date.now();let startupMs:number|undefined;
const expectedConnections=SUBSCRIPTION_CONNECTIONS.filter(connection=>connection.status==='available').map(({id,label})=>({id,label}));
try{
 await expect.poll(async()=>{if(launchError)throw launchError;assertWrapperRunning(child);try{const result=await fetch(debugOrigin+'/json/version',{signal:AbortSignal.timeout(1000)});return result.ok;}catch{return false;}},{timeout:240000,intervals:[250,500,1000]}).toBe(true);
 startupMs=Date.now()-startedAt;
 browser=await chromium.connectOverCDP(debugOrigin);
 const session=await browser.newBrowserCDPSession();
 try{const {arguments:args}=await session.send('Browser.getBrowserCommandLine');assertWrapperArguments(args,nonce);verifiedOwner=true;}finally{await session.detach();}
 await expect.poll(()=>browser!.contexts().flatMap(context=>context.pages()).some(page=>page.url().startsWith(origin+'/')),{timeout:30000}).toBe(true);
 const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith(origin+'/'))!;
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:30000});
 expect(await page.evaluate(async()=>({surface:(await window.harnessDesktop!.getContext()).surface.kind,node:typeof (window as unknown as {process?:unknown}).process}))).toEqual({surface:'main',node:'undefined'});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Providers',exact:true}).click();
 for(const connection of expectedConnections)await expect(page.locator(`.connection-row[data-provider="${connection.id}"]`).getByRole('button',{name:`Connect ${connection.label}`,exact:true})).toBeEnabled();
 await page.screenshot({path:join(directory,'portable-settings.png')});
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await page.screenshot({path:join(directory,'portable-main.png')});
 await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});
 await expect.poll(async()=>{try{return (await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:20000}).toBe(false);
 passed=true;
}finally{
 if(verifiedOwner)await browser?.close().catch(()=>{});
 if(child.exitCode===null&&!child.signalCode){await new Promise<void>(accept=>{const timeout=setTimeout(()=>{if(child.exitCode!==null||child.signalCode){accept();return;}const cleanup=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});cleanup.once('exit',()=>accept());cleanup.once('error',()=>accept());},10000);child.once('exit',()=>{clearTimeout(timeout);accept();});});}
 await writeFile(join(directory,'verification.json'),JSON.stringify({executable,passed,startupMs,inference:false,verifiedOwner,connections:expectedConnections,ports:{hostPort,widgetPort,debugPort},checks:['Portable wrapper extracts and launches its own bundled backend; browser command line matches this launch nonce','Main renderer is sandboxed and has the authoritative native bridge','Fresh profile exposes every available subscription connection without opening login','Closing the last native window shuts down the owned backend']},null,2));
 console.log(JSON.stringify({directory,passed}));
}
