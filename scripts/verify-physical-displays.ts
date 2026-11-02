import {_electron,expect,type ElectronApplication,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createConnection,createServer} from 'node:net';
import {join,resolve,dirname} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import type {DesktopSurface} from '../packages/desktop-contract/index.ts';

// Verification only: the packaged executable, an exclusive profile, and actual
// Electron screen geometry. Never emulate screens or change OS display settings.
const root=resolve('.');
const executable=resolve(process.argv[2]??join(root,'dist/desktop-release-0.3.0/win-unpacked/Generative Harness.exe'));
const evidenceRoot=resolve(process.argv[3]??join(root,'docs/evidence/t3-centered-workspace-20261031/physical-displays'));
const packageManifest=JSON.parse(await readFile(join(dirname(executable),'resources/host/package.json'),'utf8'));
if(packageManifest.name!=='generative-harness'||typeof packageManifest.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(packageManifest.version))throw Error('Select an existing Generative Harness package with versioned host metadata.');
const packageVersion=packageManifest.version as string;
await mkdir(evidenceRoot,{recursive:true});
const directory=join(evidenceRoot,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:false});
const dataDirectory=join(directory,'isolated-data');
const stateFile=join(dataDirectory,'desktop-profile/desktop-windows.json');
const ports=await freePorts();
const env=Object.fromEntries(Object.entries({...process.env,
 HARNESS_DESKTOP_TEST_DATA_DIR:dataDirectory,
 HARNESS_DESKTOP_PORT:String(ports.host),HARNESS_DESKTOP_WIDGET_PORT:String(ports.widget)
}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','HARNESS_DESKTOP_NODE_PATH','HARNESS_DESKTOP_HOST_ROOT'])delete env[key];

type Bounds={x:number;y:number;width:number;height:number};
type ActualDisplay={id:string;bounds:Bounds;workArea:Bounds;scaleFactor:number;primary:boolean;internal:boolean};
type NativeWindow={id:number;bounds:Bounds;normalBounds:Bounds;displayId:string;visible:boolean;minimized:boolean;focused:boolean};
type Check={name:string;status:'passed'|'failed'|'unverified';details?:unknown};
type OpenSurface={kind:string;page:Page;nativeId:number;chosenDisplayId?:string};
const checks:Check[]=[];
let app:ElectronApplication|undefined,ownedProcess:ChildProcess|undefined;
let displays:ActualDisplay[]=[],startupLog='',errorText:string|undefined;
let closedProcessCount=0,startedProcessCount=0;
const snapshots:unknown[]=[];
const startedAt=new Date().toISOString();
const applicationArchive=join(dirname(executable),'resources/app.asar');
const executableMetadata={path:executable,sha256:await sha256(executable),bytes:(await stat(executable)).size,
 applicationArchive:{path:applicationArchive,sha256:await sha256(applicationArchive),bytes:(await stat(applicationArchive)).size}};

async function freePorts(){
 const servers:ReturnType<typeof createServer>[]=[];
 try{
  const values:number[]=[];
  for(let index=0;index<2;index++){
   const server=createServer();servers.push(server);
   await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
   values.push((server.address() as {port:number}).port);
  }
  return {host:values[0],widget:values[1]};
 }finally{await Promise.all(servers.map(server=>new Promise<void>(accept=>server.close(()=>accept()))));}
}
async function sha256(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function inside(bounds:Bounds,area:Bounds){return bounds.x>=area.x&&bounds.y>=area.y&&bounds.x+bounds.width<=area.x+area.width&&bounds.y+bounds.height<=area.y+area.height;}
async function portListening(port:number){return new Promise<boolean>(accept=>{const socket=createConnection({host:'127.0.0.1',port});let settled=false;const finish=(value:boolean)=>{if(settled)return;settled=true;socket.destroy();accept(value);};socket.setTimeout(750);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});}
async function native(page:Page):Promise<NativeWindow>{return app!.evaluate(({BrowserWindow,screen},url)=>{
 const value=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url);
 if(!value)throw Error('Owned native window is missing');
 return {id:value.id,bounds:value.getBounds(),normalBounds:value.getNormalBounds(),displayId:String(screen.getDisplayMatching(value.getBounds()).id),visible:value.isVisible(),minimized:value.isMinimized(),focused:value.isFocused()};
},page.url());}
async function focus(page:Page){const id=(await native(page)).id;await app!.evaluate(({BrowserWindow},id)=>{const value=BrowserWindow.fromId(id)!;if(value.isMinimized())value.restore();value.show();value.focus();},id);await expect.poll(async()=>(await native(page)).focused,{timeout:8000}).toBe(true);}
async function settledOn(surface:OpenSurface,target:ActualDisplay){
 await expect.poll(async()=>{const value=await native(surface.page);return value.displayId===target.id&&inside(value.bounds,target.workArea);},{timeout:10000}).toBe(true);
 const value=await native(surface.page);snapshots.push({surface:surface.kind,targetDisplayId:target.id,...value});return value;
}
async function menuMove(surface:OpenSurface,target:ActualDisplay){
 await focus(surface.page);
 const index=displays.findIndex(display=>display.id===target.id);
 await app!.evaluate(({Menu,BrowserWindow},index)=>{
  const windowMenu=Menu.getApplicationMenu()?.items.find(item=>item.label==='Window')?.submenu;
  const item=windowMenu?.items.find(item=>item.label==='Move to Display')?.submenu?.items[index];
  if(!item||!item.enabled)throw Error('Actual display menu item is unavailable');
  item.click(item,BrowserWindow.getFocusedWindow()??undefined,{triggeredByAccelerator:false});
 },index);
 const value=await settledOn(surface,target);surface.chosenDisplayId=target.id;
 checks.push({name:surface.kind+' native Move to Display menu targets actual display '+target.id,status:'passed',details:value});
}
async function shortcut(surface:OpenSurface,direction:'Right'|'Left'){
 await focus(surface.page);
 const before=await native(surface.page),index=displays.findIndex(display=>display.id===before.displayId);
 const target=displays[(index+(direction==='Right'?1:-1)+displays.length)%displays.length];
 await surface.page.keyboard.press('Control+Alt+Arrow'+direction);
 const value=await settledOn(surface,target);surface.chosenDisplayId=target.id;
 checks.push({name:surface.kind+' Ctrl+Alt+'+direction+' targets adjacent actual display',status:'passed',details:{input:'Playwright keyboard through the owned Electron renderer',targetDisplayId:target.id,...value}});
}
async function launch(){
 app=await _electron.launch({executablePath:executable,args:[],env,timeout:45000});
 ownedProcess=app.process();startedProcessCount++;
 ownedProcess.stderr?.on('data',bytes=>{startupLog=(startupLog+String(bytes)).slice(-16000);});
 // First operation on the launched app is actual hardware enumeration.
 const inventory=await app.evaluate(({app,screen})=>{
  const primary=screen.getPrimaryDisplay();
  return {userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),packaged:app.isPackaged,
   displays:screen.getAllDisplays().map(display=>({id:String(display.id),bounds:display.bounds,workArea:display.workArea,scaleFactor:display.scaleFactor,primary:display.id===primary.id,internal:display.internal}))};
 });
 await writeFile(join(directory,startedProcessCount===1?'actual-displays.json':'restart-actual-displays.json'),JSON.stringify(inventory,null,2));
 expect(inventory.packaged).toBe(true);
 expect(resolve(inventory.userData)).toBe(resolve(dataDirectory,'desktop-profile'));
 expect(resolve(inventory.sessionData)).toBe(resolve(dataDirectory,'desktop-profile/session'));
 if(startedProcessCount===1){displays=inventory.displays;expect(displays.length).toBeGreaterThan(0);}
 else expect(inventory.displays).toEqual(displays);
 const page=await app.firstWindow();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:30000});
 return page;
}
async function closeOwned(){
 if(!app)return;
 const closing=app,child=ownedProcess;
 await closing.close();
 app=undefined;
 await expect.poll(()=>child?.exitCode!==null||Boolean(child?.signalCode),{timeout:15000}).toBe(true);
 closedProcessCount++;
 await expect.poll(async()=>!(await portListening(ports.host))&&!(await portListening(ports.widget)),{timeout:15000}).toBe(true);
}
async function detach(main:Page,surface:DesktopSurface):Promise<OpenSurface>{
 const info=await main.evaluate(surface=>window.harnessDesktop!.detach(surface),surface);
 await expect.poll(()=>app!.windows().some(page=>page.url().includes(info.id)),{timeout:20000}).toBe(true);
 const page=app!.windows().find(page=>page.url().includes(info.id))!;
 await page.waitForLoadState('domcontentloaded');
 return {kind:surface.kind,page,nativeId:(await native(page)).id};
}
async function check(name:string,action:()=>Promise<void>){try{await action();}catch(error){checks.push({name,status:'failed',details:String(error instanceof Error?error.stack:error)});}}

try{
 const mainPage=await launch();
 checks.push({name:'Packaged app uses an exclusive profile and actual Electron display inventory',status:'passed',details:{actualDisplayCount:displays.length,ports}});
 const main:OpenSurface={kind:'main',page:mainPage,nativeId:(await native(mainPage)).id};
 const navigation=await detach(mainPage,{kind:'navigation'});
 const workspace=await detach(mainPage,{kind:'workspace',tab:'files'});
 const surfaces=[main,navigation,workspace];
 const menu=await app!.evaluate(({Menu})=>{
  const items=Menu.getApplicationMenu()?.items.find(item=>item.label==='Window')?.submenu?.items??[];
  return items.filter(item=>['Move to Display','Move to Next Display','Move to Previous Display'].includes(item.label)).map(item=>({label:item.label,enabled:item.enabled,accelerator:item.accelerator,displayItems:item.submenu?.items.map(child=>({enabled:child.enabled}))}));
 });
 await writeFile(join(directory,'native-menu.json'),JSON.stringify(menu,null,2));
 expect(menu.find(item=>item.label==='Move to Display')?.displayItems?.length).toBe(displays.length);
 for(const surface of surfaces){
  for(const target of displays)await check(surface.kind+' native display menu',()=>menuMove(surface,target));
  if(displays.length>=2){
   await check(surface.kind+' next-display shortcut',()=>shortcut(surface,'Right'));
   await check(surface.kind+' previous-display shortcut',()=>shortcut(surface,'Left'));
  }
 }
 if(displays.length===1){
  expect(menu.find(item=>item.label==='Move to Next Display')?.enabled).toBe(false);
  expect(menu.find(item=>item.label==='Move to Previous Display')?.enabled).toBe(false);
  checks.push({name:'Multiple physical displays, negative-coordinate transitions and mixed-DPI transitions',status:'unverified',details:'Electron reports one actual display. No emulated geometry substitutes for missing hardware.'});
 }
 // Leave independently chosen destinations open for cold-restart persistence.
 await menuMove(main,displays[displays.length-1]);
 await menuMove(navigation,displays[0]);
 await menuMove(workspace,displays[displays.length-1]);
 await check('Main minimizes independently from detached navigation and workspace',async()=>{
  await mainPage.evaluate(()=>window.harnessDesktop!.minimize());
  await expect.poll(async()=>(await native(mainPage)).minimized).toBe(true);
  for(const surface of [navigation,workspace]){const value=await native(surface.page);expect(value.minimized).toBe(false);expect(value.visible).toBe(true);}
  await focus(mainPage);checks.push({name:'Main minimizes independently from detached navigation and workspace',status:'passed'});
 });
 await mainPage.screenshot({path:join(directory,'main-actual-display.png')});
 await navigation.page.screenshot({path:join(directory,'navigation-actual-display.png')});
 await workspace.page.screenshot({path:join(directory,'workspace-actual-display.png')});
 const selected=surfaces.map(surface=>({kind:surface.kind,displayId:surface.chosenDisplayId!}));
 await expect.poll(async()=>{try{const state=JSON.parse(await readFile(stateFile,'utf8')) as {windows:{surface:{kind:string};placement?:{displayId:string};open:boolean}[]};return selected.every(value=>state.windows.some(window=>window.surface.kind===value.kind&&window.open&&window.placement?.displayId===value.displayId));}catch{return false;}},{timeout:10000}).toBe(true);
 await writeFile(join(directory,'saved-before-restart.json'),await readFile(stateFile));
 await closeOwned();
 checks.push({name:'Closing the owned app stops its process and both owned backend ports',status:'passed'});
 const restarted=await launch();
 await expect.poll(()=>app!.windows().length,{timeout:20000}).toBe(3);
 const restored:OpenSurface[]=[];
 for(const page of app!.windows()){
  await page.waitForLoadState('domcontentloaded');
  const context=await page.evaluate(()=>window.harnessDesktop!.getContext());
  restored.push({kind:context.surface.kind,page,nativeId:(await native(page)).id});
 }
 for(const destination of selected){
  const surface=restored.find(surface=>surface.kind===destination.kind)!;
  const target=displays.find(display=>display.id===destination.displayId)!;
  const value=await settledOn(surface,target);
  checks.push({name:destination.kind+' cold restart restores chosen actual monitor',status:'passed',details:{chosenDisplayId:target.id,...value}});
 }
 await restarted.screenshot({path:join(directory,'main-restored.png')});
 for(const surface of restored.filter(surface=>surface.kind!=='main')){
  await surface.page.evaluate(()=>window.harnessDesktop!.reattach()).catch(error=>{if(!surface.page.isClosed())throw error;});
  await expect.poll(()=>surface.page.isClosed(),{timeout:15000}).toBe(true);
  checks.push({name:surface.kind+' reattaches after native display persistence',status:'passed'});
 }
 expect(app!.windows().length).toBe(1);
 await closeOwned();
 checks.push({name:'Final owned app, detached windows, and backend ports are closed',status:'passed'});
}catch(error){
 errorText=String(error instanceof Error?error.stack:error);
 checks.push({name:'Physical-display verification run',status:'failed',details:errorText});
 if(app)for(const [index,page] of app.windows().entries())await page.screenshot({path:join(directory,'failure-window-'+index+'.png'),timeout:5000}).catch(()=>{});
}finally{
 if(app){try{await closeOwned();}catch(error){checks.push({name:'Owned app cleanup',status:'failed',details:String(error)});if(ownedProcess?.exitCode===null&&!ownedProcess.signalCode)ownedProcess.kill();}}
 const stillListening={host:await portListening(ports.host),widget:await portListening(ports.widget)};
 const passed=!checks.some(check=>check.status==='failed')&&!stillListening.host&&!stillListening.widget;
 const negative=displays.some(display=>display.bounds.x<0||display.bounds.y<0||display.workArea.x<0||display.workArea.y<0);
 const mixedDpi=new Set(displays.map(display=>display.scaleFactor)).size>1;
 const receipt={startedAt,finishedAt:new Date().toISOString(),passed,verificationOnly:true,fixture:false,inference:false,providerAcceptance:false,
  packageVersion,packageScope:'Existing '+packageVersion+' package at the recorded executable/archive hashes. Actual display/window behavior only; no provider authentication or inference.',
  executable:executableMetadata,directory,dataDirectory,ports,actualDisplayCount:displays.length,displays,
  hardwareCoverage:{multipleDisplays:displays.length>=2,negativeCoordinatesAvailable:negative,mixedDpiAvailable:mixedDpi,
   negativeCoordinateTransitions:negative&&displays.length>=2&&passed?'passed':'unverified',mixedDpiTransitions:mixedDpi&&passed?'passed':'unverified',
   hotplug:'unverified; no monitor connections or OS display settings changed'},
  cleanup:{startedProcessCount,closedProcessCount,ownedExecutableExited:Boolean(ownedProcess&&(ownedProcess.exitCode!==null||ownedProcess.signalCode)),ownedPortsStillListening:stillListening},checks,snapshots,...(errorText?{error:errorText}:{})};
 await writeFile(join(directory,'startup.log'),startupLog);
 await writeFile(join(directory,'verification.json'),JSON.stringify(receipt,null,2));
 const report=[`Actual Electron displays: ${displays.length}. Verification ${passed?'passed':'failed'} for the recorded scope.`,
  ...displays.map(display=>`- Display ${display.id}${display.primary?' (primary)':''}: DIP bounds ${JSON.stringify(display.bounds)}, work area ${JSON.stringify(display.workArea)}, scale factor ${display.scaleFactor}.`),
  '',`Checks: ${checks.filter(check=>check.status==='passed').length} passed, ${checks.filter(check=>check.status==='failed').length} failed, ${checks.filter(check=>check.status==='unverified').length} unverified.`,
  displays.length>=2?'Actual attached displays were used for native menu and Ctrl+Alt shortcut placement, persistence and window independence.':'Only one actual display was available. Multi-display transitions, negative-coordinate transitions and mixed-DPI transitions remain unverified.',
  'Physical hotplug remains unverified. No OS display settings were changed.',
  'Existing packaged '+packageVersion+' display behavior only; no provider authentication, inference, or auth/runtime acceptance is claimed.',
  `Cleanup: ${closedProcessCount}/${startedProcessCount} owned app processes closed gracefully; owned ports still listening ${JSON.stringify(stillListening)}.`,
  `Executable SHA-256: ${executableMetadata.sha256}.`].join('\n');
 await writeFile(join(directory,'report.md'),report+'\n');
 console.log(JSON.stringify({directory,passed,actualDisplayCount:displays.length,checks:checks.map(({name,status})=>({name,status})),cleanup:receipt.cleanup}));
 if(!passed)process.exitCode=1;
}
