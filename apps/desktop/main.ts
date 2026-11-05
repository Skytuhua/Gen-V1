import {app,BrowserWindow,WebContentsView,ipcMain,session,screen,dialog,Menu,Tray,nativeImage,powerMonitor,type IpcMainInvokeEvent,type Session} from 'electron';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createDesktopUpdater,type DesktopUpdater,type DesktopUpdateDriver,type UpdateStatus} from './updater.ts';
import {checkInstalledCompatibility} from '../../packages/plugins/installation.ts';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESKTOP_CHANNELS as channels,desktopId,desktopSurfaceKey,parseDesktopSurface,parseDesktopLayout,parseDesktopWindowControl,type DesktopLayout,type DesktopLayoutEntry,type DesktopSurface,type DesktopWindowInfo,type DesktopContext,type DesktopState,type DesktopBrowserState} from '../../packages/desktop-contract/index.ts';
import {allowRemoteBrowserUrl,clampDesktopBounds,pluginDesktopChannelAllowed,pluginDesktopRequiresGrant,nativeTitlebarOptions,nativeTitlebarTheme,requireExistingDetachedSurface,desktopSurfaceAllowed,isTrustedDesktopSender,parseBrowserCommand,remoteBrowserUrl,surfaceSize,trustedDesktopUrl,trustedDesktopSubframe,type DesktopBounds} from './window-policy.ts';
import {createBrowserProxy,type BrowserProxy} from './browser-proxy.ts';
import {nodeSidecarArguments,waitForBackendReady} from './backend-policy.ts';
import {releaseOwnedBrowsers,detachOwnedBrowser} from './browser-lifecycle.ts';
import {launchDesktopSignIn,parseDesktopSignInTarget} from './auth-launcher.ts';
import {captureDesktopPlacement,createNormalBounds,parseDesktopPlacement,placeOnDesktopDisplay,restoreDesktopPlacement,retainDesktopPlacement,type DesktopDisplay,type DesktopPlacement} from './display-layout.ts';
import type {ConnectionProviderId} from '../../packages/contracts/connections.ts';
import {createAccountLoginFlows} from './account-login.ts';
import {workspaceEvents} from './workspace-events.ts';
import {applyNativeLayout} from './layout-transaction.ts';
import {createPersistenceQueue,reconcileSavedWindows} from './persistence.ts';
const persistence=createPersistenceQueue();

interface BrowserRecord {id:string;view:WebContentsView;state:DesktopBrowserState;owner?:WindowRecord;generation:number;networkReady:Promise<void>}
interface WindowRecord {id:string;surface:DesktopSurface;window:BrowserWindow;url:string;ready:boolean;settled:boolean;visible:boolean;normalBounds:ReturnType<typeof createNormalBounds>;placement?:DesktopPlacement;appliedBounds?:DesktopBounds;monitorRescued?:boolean;recoveries?:number;resolveReady:(value:DesktopWindowInfo)=>void;rejectReady:(error:Error)=>void;readyPromise:Promise<DesktopWindowInfo>;readyTimer:ReturnType<typeof setTimeout>;browser?:BrowserRecord;dockedBrowser?:BrowserRecord;closePromise?:Promise<boolean>;closeRequest?:{id:string;resolve:(allow:boolean)=>void;timer:ReturnType<typeof setTimeout>}}
interface SavedWindow {surface:DesktopSurface;bounds:DesktopBounds;placement?:DesktopPlacement;open:boolean;visible?:boolean;alwaysOnTop?:boolean;dockedBrowserId?:string}
const windows=new Map<string,WindowRecord>(),browsers=new Map<string,BrowserRecord>();
const testData=process.env.HARNESS_DESKTOP_TEST_DATA_DIR;
app.setName('Gen V1');
const profileRoot=testData?resolve(testData,'desktop-profile'):join(app.getPath('appData'),'GenerativeHarnessDesktop');mkdirSync(profileRoot,{recursive:true});mkdirSync(join(profileRoot,'session'),{recursive:true});app.setPath('userData',profileRoot);app.setPath('sessionData',join(profileRoot,'session'));
app.commandLine.appendSwitch('disable-quic');app.commandLine.appendSwitch('disable-features','WebTransport,DirectSockets');
const stateFile=join(app.getPath('userData'),'desktop-windows.json');
let saved:SavedWindow[]=[],saveTimer:ReturnType<typeof setTimeout>|undefined,backend:ChildProcess|undefined,backendOrigin='',backendError:string|undefined,launchToken='',quitting=false,quitPending=false,closing=false,restarting=false;
let updater:DesktopUpdater|undefined,osSessionEnding=false,restartForUpdate=false;
let updateStatus:UpdateStatus={state:'unavailable',message:'Install Gen to receive automatic updates.'};
let startup:BrowserWindow|undefined,startupTimer:ReturnType<typeof setTimeout>|undefined;
let proxyPromise:Promise<BrowserProxy>|undefined;
let handoffQueue:Promise<unknown>=Promise.resolve();
let workspaceRelay:ReturnType<typeof workspaceEvents>|undefined;
let tray:Tray|undefined,hostLayout:DesktopLayout|undefined,layoutError:string|undefined,restoringLayout=true;
function handoff<T>(action:()=>Promise<T>):Promise<T>{const next=handoffQueue.catch(()=>{}).then(action);handoffQueue=next;return next;}
const root=resolve(process.env.HARNESS_DESKTOP_HOST_ROOT??(app.isPackaged?join(process.resourcesPath,'host'):join(dirname(fileURLToPath(import.meta.url)),'../..')));
const nodePath=resolve(process.env.HARNESS_DESKTOP_NODE_PATH??join(process.resourcesPath,'node','node.exe'));
const backendDataDir=resolve(testData?join(testData,'host'):process.env.HARNESS_DATA_DIR??join(process.env.LOCALAPPDATA??app.getPath('home'),'GenerativeHarness'));
const signInFlows=createAccountLoginFlows((provider,accountId,signal)=>launchDesktopSignIn({nodePath,hostRoot:root,dataDir:backendDataDir,provider,...(accountId?{accountId}:{}),signal}));
async function beginSignIn(provider:ConnectionProviderId='openai',accountId?:string){
 if(quitting||quitPending)throw Error('The application is closing.');
 return signInFlows.start(provider,accountId??null);
}
const preload=join(dirname(fileURLToPath(import.meta.url)),'preload.cjs');
const backendPort=Number(process.env.HARNESS_DESKTOP_PORT??4317),widgetPort=Number(process.env.HARNESS_DESKTOP_WIDGET_PORT??4318);
function workAreas(){return screen.getAllDisplays().map(display=>display.workArea);}
function displays():DesktopDisplay[]{const primary=screen.getPrimaryDisplay(),all=screen.getAllDisplays();return (all.length?all:[primary]).map(display=>({id:String(display.id),workArea:display.workArea,label:display.label,scaleFactor:display.scaleFactor,primary:display.id===primary.id}));}
function info(record:WindowRecord):DesktopWindowInfo{return {id:record.id,surface:record.surface,ready:record.ready,minimized:record.window.isMinimized(),visible:record.visible,alwaysOnTop:record.window.isAlwaysOnTop(),bounds:record.window.getNormalBounds(),displayId:record.placement?.displayId};}
function captureLayout():DesktopLayout{return {version:1,windows:[...windows.values()].filter(record=>!record.window.isDestroyed()).map(record=>({surface:record.surface,bounds:record.normalBounds.read(),visible:record.visible,alwaysOnTop:record.window.isAlwaysOnTop(),...(record.dockedBrowser?{dockedBrowserId:record.dockedBrowser.id}:{}),...(record.placement?{displayId:record.placement.displayId,placement:record.placement}:{})}))};}
function snapshot(record:WindowRecord):DesktopState{return {windows:[...windows.values()].map(info),...(record.browser?{browser:record.browser.state}:{}),...(record.dockedBrowser?{dockedBrowser:{browserId:record.dockedBrowser.id,state:record.dockedBrowser.state}}:{}),...(backendError?{backendError}:{}),...(layoutError?{layoutError}:{}),update:updateStatus,nativeTitleBar:process.platform==='win32'};}
function broadcast(focusSurface?:DesktopSurface){for(const record of windows.values())if(!record.window.isDestroyed())record.window.webContents.send(channels.state,{...snapshot(record),...(record.surface.kind==='main'&&focusSurface?{focusSurface}:{})});}
function cancelClose(record:WindowRecord){if(!record.window.isDestroyed())record.window.webContents.send(channels.state,{...snapshot(record),closeCancelled:true});}
function context(record:WindowRecord):DesktopContext{return {...snapshot(record),windowId:record.id,surface:record.surface};}
function authorize(event:IpcMainInvokeEvent):WindowRecord {
 const record=[...windows.values()].find(entry=>entry.window.webContents.id===event.sender.id);
 if(!record||record.window.isDestroyed()||!isTrustedDesktopSender({id:record.window.webContents.id,url:record.url},{id:event.sender.id,url:event.senderFrame?.url??'',mainFrame:event.senderFrame===event.sender.mainFrame})||event.sender.getURL()!==record.url)throw Error('Desktop request denied');
 return record;
}
function persist(){
 if(quitPending||quitting)return;
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void persistence.enqueue(async()=>{await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile,JSON.stringify({version:1,windows:saved.slice(-24)}),{encoding:'utf8',mode:0o600});if(!restoringLayout&&!layoutError){await backendRequest('harness.layout.save',{layout:captureLayout()});}}).catch(error=>{layoutError='Workspace layout could not be saved: '+String(error instanceof Error?error.message:error).slice(0,300);broadcast();});},180);
}
function remember(record:WindowRecord,open=true){if(record.window.isDestroyed())return;
 const normal=!record.window.isMaximized()&&!record.window.isMinimized()&&!record.window.isFullScreen();
 // Windows/macOS provide manual intent events. Other platforms retain their
 // normal-state geometry fallback; passive Windows frame reports never persist.
 record.normalBounds.observe(record.window.getNormalBounds(),{manual:process.platform!=='win32'&&process.platform!=='darwin',normal});
 const key=desktopSurfaceKey(record.surface),bounds=record.normalBounds.read(),all=displays();
 // Windows can move a native window before Electron emits display-removed.
 // Preserve its destination until our rescue has established a new baseline.
 const awaitingRescue=record.placement&&!all.some(display=>display.id===record.placement!.displayId)&&!record.monitorRescued;
 if(!awaitingRescue)record.placement=retainDesktopPlacement(bounds,record.placement,record.appliedBounds,all);
 if(record.placement&&all.some(display=>display.id===record.placement!.displayId))record.monitorRescued=false;
 const value={surface:record.surface,bounds,placement:record.placement,open,visible:record.visible,alwaysOnTop:record.window.isAlwaysOnTop(),...(record.dockedBrowser?{dockedBrowserId:record.dockedBrowser.id}:{})};saved=[...saved.filter(entry=>desktopSurfaceKey(entry.surface)!==key),value];if(saved.length>24){const live=new Set([...windows.values()].map(item=>desktopSurfaceKey(item.surface)));saved=[...saved.filter(entry=>live.has(desktopSurfaceKey(entry.surface))),...saved.filter(entry=>!live.has(desktopSurfaceKey(entry.surface)))].slice(0,24);}persist();}
async function loadSaved(){try{const bytes=await readFile(stateFile,'utf8');if(bytes.length>128*1024)return;const raw=JSON.parse(bytes);if(raw.version!==1||!Array.isArray(raw.windows)||raw.windows.length>24)return;for(const entry of raw.windows){try{const surface=parseDesktopSurface(entry.surface);if(!desktopSurfaceAllowed(surface))continue;if(entry.bounds&&typeof entry.bounds==='object')saved.push({surface,bounds:clampDesktopBounds(entry.bounds,workAreas(),surfaceSize(surface)),placement:parseDesktopPlacement(entry.placement),open:entry.open===true,visible:entry.visible!==false,alwaysOnTop:entry.alwaysOnTop===true,...(surface.kind==='main'&&desktopId(entry.dockedBrowserId)?{dockedBrowserId:entry.dockedBrowserId}:{})});}catch{}}}catch{}}
function applyPlacement(record:WindowRecord,bounds:DesktopBounds,preferred=record.placement){if(record.window.isDestroyed())return;record.placement=preferred;record.appliedBounds=bounds;record.normalBounds.apply(bounds);record.window.setBounds(bounds);remember(record);}
function resetWindowPosition(record:WindowRecord){const all=displays(),current=captureDesktopPlacement(record.window.getBounds(),all),target=all.find(display=>display.id===current.displayId)!;const bounds=placeOnDesktopDisplay(surfaceSize(record.surface),target);applyPlacement(record,bounds,captureDesktopPlacement(bounds,all));}
function focusedRecord(){const focused=BrowserWindow.getFocusedWindow();return [...windows.values()].find(record=>record.window===focused);}
function moveWindowToDisplay(record:WindowRecord,id:string){const all=displays(),target=all.find(display=>display.id===id);if(!target)return;const bounds=placeOnDesktopDisplay(record.normalBounds.read(),target);applyPlacement(record,bounds,captureDesktopPlacement(bounds,all));}
function moveToAdjacentDisplay(offset:number){const record=focusedRecord(),all=displays();if(!record||all.length<2)return;const current=captureDesktopPlacement(record.window.getBounds(),all),index=all.findIndex(display=>display.id===current.displayId);moveWindowToDisplay(record,all[(index+offset+all.length)%all.length].id);}
function installApplicationMenu(){const all=displays();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Restore chat',click:()=>{void mainWindow();}},{type:'separator'},{label:'Quit Gen V1',accelerator:'Control+Shift+Q',click:()=>app.quit()}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{label:'Move to Display',submenu:all.map((display,index)=>({label:(display.label||'Display '+(index+1))+(display.primary?' (Primary)':''),click:()=>{const record=focusedRecord();if(record)moveWindowToDisplay(record,display.id);}}))},{label:'Move to Next Display',accelerator:'Control+Alt+Right',enabled:all.length>1,click:()=>moveToAdjacentDisplay(1)},{label:'Move to Previous Display',accelerator:'Control+Alt+Left',enabled:all.length>1,click:()=>moveToAdjacentDisplay(-1)},{label:'Reset window position',click:()=>{const record=focusedRecord();if(record)resetWindowPosition(record);}}]}]));}
function displayTitle(surface:DesktopSurface){return surface.kind==='plugin'?'Plug-in view':({main:'Gen V1',plan:'Task plan',usage:'Live usage',thread:'Chat',artifact:'Task artifact',agent:'Subagent',navigation:'Projects and threads',workspace:'Workspace',browser:'Browser'})[surface.kind];}
function browserState(record:BrowserRecord){const contents=record.view.webContents;if(contents.isDestroyed())return;record.state={...record.state,url:(contents.getURL()||'about:blank').slice(0,4096),title:(contents.getTitle()||'Browser').slice(0,500),canGoBack:contents.navigationHistory.canGoBack(),canGoForward:contents.navigationHistory.canGoForward(),loading:contents.isLoading()};broadcast();}
const configuredBrowserSessions=new WeakMap<Session,Promise<void>>();
function secureBrowserSession(value:Session){
 const existing=configuredBrowserSessions.get(value);if(existing)return existing;
 value.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));value.setPermissionCheckHandler(()=>false);value.on('will-download',event=>event.preventDefault());
 value.webRequest.onBeforeRequest((details,callback)=>{
  if(details.url==='about:blank'||details.url.startsWith('data:')||details.url.startsWith('blob:')){callback({cancel:false});return;}
  void allowRemoteBrowserUrl(details.url).then(allow=>callback({cancel:!allow}),()=>callback({cancel:true}));
 });
 const ready=(async()=>{const proxy=await (proxyPromise??=createBrowserProxy());await value.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:'+proxy.port+';https=127.0.0.1:'+proxy.port,proxyBypassRules:'<-loopback>'});await value.closeAllConnections();})();configuredBrowserSessions.set(value,ready);return ready;
}
function browserRecord(id:string):BrowserRecord {
 const existing=browsers.get(id);if(existing)return existing;
 if(browsers.size>=12)throw Error('Close a browser before opening another');
 const browserSession=session.fromPartition('persist:harness-browser'),networkReady=secureBrowserSession(browserSession);
 const view=new WebContentsView({webPreferences:{session:browserSession,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
 view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
 const record:BrowserRecord={id,view,state:{url:'about:blank',title:'Browser',canGoBack:false,canGoForward:false,loading:false},generation:0,networkReady};void networkReady.catch(error=>{record.state.error='The isolated browser connection could not start: '+String(error instanceof Error?error.message:error).slice(0,200);broadcast();});browsers.set(id,record);
 view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-attach-webview',event=>event.preventDefault());
 view.webContents.on('will-navigate',(event,url)=>{try{remoteBrowserUrl(url);}catch{event.preventDefault();record.state.error='Local, private-network and non-HTTP pages are blocked.';broadcast();}});
 view.webContents.on('will-redirect',(event,url)=>{try{remoteBrowserUrl(url);}catch{event.preventDefault();}});
 view.webContents.on('did-navigate',()=>browserState(record));view.webContents.on('did-navigate-in-page',()=>browserState(record));view.webContents.on('did-start-loading',()=>browserState(record));view.webContents.on('did-stop-loading',()=>browserState(record));view.webContents.on('page-title-updated',()=>browserState(record));
 view.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){record.state.error=description.slice(0,300);browserState(record);}});
 view.webContents.on('render-process-gone',()=>{record.state.error='The browser page stopped. Reload it to continue.';record.state.loading=false;broadcast();});
 void view.webContents.loadURL('about:blank');return record;
}
function moveBrowser(browser:BrowserRecord,owner:WindowRecord,docked:boolean){
 const previous=browser.owner;
 if(previous&&!previous.window.isDestroyed())detachOwnedBrowser(previous,browser,value=>previous.window.contentView.removeChildView(value.view));
 browser.owner=owner;if(docked)owner.dockedBrowser=browser;else owner.browser=browser;
 owner.window.contentView.addChildView(browser.view);const [width,height]=owner.window.getContentSize();browser.view.setBounds(docked?{x:Math.max(0,width-520),y:100,width:Math.min(520,width),height:Math.max(0,height-100)}:{x:0,y:96,width,height:Math.max(0,height-96)});broadcast();
}
function loseBrowserOwner(record:WindowRecord){releaseOwnedBrowsers(record,browsers,browser=>{browser.generation++;if(!record.window.isDestroyed())record.window.contentView.removeChildView(browser.view);if(!browser.view.webContents.isDestroyed())browser.view.webContents.close({waitForBeforeUnload:false});});}
async function openSurface(raw:unknown,sourceBounds?:DesktopBounds,recoverSaved=false):Promise<DesktopWindowInfo>{
 if(quitting||quitPending)throw Error('The application is closing.');
 const surface=parseDesktopSurface(raw);if(!desktopSurfaceAllowed(surface))throw Error('This surface belongs to a different workspace authority.');
 if(surface.kind!=='main'&&(!recoverSaved||!saved.some(entry=>entry.open&&desktopSurfaceKey(entry.surface)===desktopSurfaceKey(surface))))requireExistingDetachedSurface(surface,[...windows.values()].map(record=>record.surface));
 if(surface.kind==='plugin'&&(await backendRequest('harness.plugin.validate',{surface})).allowed!==true)throw Error('The plug-in host did not authorize this window.');
 const key=desktopSurfaceKey(surface),existing=[...windows.values()].find(record=>desktopSurfaceKey(record.surface)===key);
 if(existing){existing.visible=true;if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();remember(existing);broadcast();return existing.readyPromise;}
 if(surface.kind!=='main'&&!recoverSaved)throw Error('Opening detached views is currently unavailable.');
 if(windows.size>=24)throw Error('Close a window before opening another');
 if(surface.kind==='browser'&&!browsers.has(surface.browserId)&&browsers.size>=12)throw Error('Close a browser before opening another');
 const size=surfaceSize(surface),previous=saved.find(entry=>desktopSurfaceKey(entry.surface)===key),all=displays(),placement=previous?.placement??(previous?captureDesktopPlacement(previous.bounds,all):undefined),bounds=restoreDesktopPlacement(placement,all,size,sourceBounds),id=randomUUID(),url=trustedUrl(id);
 const native=new BrowserWindow({...bounds,...nativeTitlebarOptions(process.platform),minWidth:Math.min(320,bounds.width),minHeight:Math.min(160,bounds.height),show:false,alwaysOnTop:previous?.alwaysOnTop===true,title:displayTitle(surface),backgroundColor:'#0f0f0f',autoHideMenuBar:true,webPreferences:{preload,partition:'persist:harness',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
 native.on('query-session-end',()=>{osSessionEnding=true;});native.on('session-end',()=>{osSessionEnding=true;});
 let resolveReady!:(value:DesktopWindowInfo)=>void,rejectReady!:(error:Error)=>void;
 const readyPromise=new Promise<DesktopWindowInfo>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});void readyPromise.catch(()=>{});
 const record:WindowRecord={id,surface,window:native,url,ready:false,settled:false,visible:previous?.visible!==false,normalBounds:createNormalBounds(bounds),placement:placement??captureDesktopPlacement(bounds,all),appliedBounds:bounds,monitorRescued:!!placement&&!all.some(display=>display.id===placement.displayId),resolveReady,rejectReady,readyPromise,readyTimer:setTimeout(()=>{if(record.ready)return;record.settled=true;record.rejectReady(Error('The detached window did not become ready. Your original view remains available.'));loseBrowserOwner(record);native.destroy();},20000)};
 windows.set(id,record);broadcast();
 native.webContents.setWindowOpenHandler(()=>({action:'deny'}));native.webContents.on('will-attach-webview',event=>event.preventDefault());
 native.webContents.on('will-navigate',(event,next)=>{if(next!==url)event.preventDefault();});native.webContents.on('will-redirect',(event,next)=>{if(next!==url)event.preventDefault();});
 native.webContents.on('will-frame-navigate',event=>{if(!event.isMainFrame&&!trustedDesktopSubframe(event.url,backendOrigin,`http://localhost:${widgetPort}`))event.preventDefault();});
 native.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));native.webContents.session.setPermissionCheckHandler(()=>false);
 native.on('close',event=>{if(!quitting){event.preventDefault();void requestClose(record).then(allow=>{if(allow)destroyWindow(record);else cancelClose(record);}).catch(()=>cancelClose(record));}});
 native.on('closed',()=>{clearTimeout(record.readyTimer);if(!record.settled){record.settled=true;record.rejectReady(Error('The detached window closed before it was ready'));}windows.delete(id);if(record.closeRequest){clearTimeout(record.closeRequest.timer);record.closeRequest.resolve(false);}broadcast();});
 const resized=()=>{remember(record);if(record.browser){const [width,height]=native.getContentSize();record.browser.view.setBounds({x:0,y:96,width,height:Math.max(0,height-96)});}};
 const manuallyPlaced=(_event:unknown,next:DesktopBounds)=>{
  if(!record.ready||native.isMaximized()||native.isMinimized()||native.isFullScreen())return;
  record.normalBounds.observe(next,{manual:true,normal:true});record.placement=captureDesktopPlacement(record.normalBounds.read(),displays());record.appliedBounds=record.normalBounds.read();record.monitorRescued=false;remember(record);
 };
 native.on('will-move',manuallyPlaced);native.on('will-resize',manuallyPlaced);
 native.on('move',resized);native.on('resize',resized);native.on('minimize',()=>broadcast());native.on('restore',()=>broadcast());
 native.webContents.on('render-process-gone',()=>{
  if(record.closeRequest){clearTimeout(record.closeRequest.timer);record.closeRequest.resolve(false);record.closeRequest=undefined;}
  const wasReady=record.ready;record.ready=false;clearTimeout(record.readyTimer);
  if(quitting||!wasReady||(record.recoveries??0)>=2){record.settled=true;record.rejectReady(Error('The detached view failed to load'));loseBrowserOwner(record);native.destroy();return;}
  record.recoveries=(record.recoveries??0)+1;record.settled=false;
  record.readyPromise=new Promise((accept,reject)=>{record.resolveReady=accept;record.rejectReady=reject;});void record.readyPromise.catch(()=>{});
  record.readyTimer=setTimeout(()=>{if(record.ready||native.isDestroyed())return;record.settled=true;record.rejectReady(Error('The detached view could not recover. Your saved draft is retained.'));destroyWindow(record);},20000);
  broadcast();
  setTimeout(()=>{if(native.isDestroyed()||quitting)return;void (async()=>{if(surface.kind==='plugin'&&(await backendRequest('harness.plugin.validate',{surface})).allowed!==true)throw Error('The plug-in host did not authorize this window.');if(!native.isDestroyed()&&!quitting)await native.loadURL(url);})().catch(error=>{if(native.isDestroyed())return;record.settled=true;record.rejectReady(error);destroyWindow(record);});},150);
 });
 native.webContents.once('did-fail-load',(_event,code,description)=>{if(code!==-3&&!record.ready){record.settled=true;record.rejectReady(Error(description));loseBrowserOwner(record);native.destroy();}});
 await native.loadURL(url).catch(error=>{if(!record.settled){record.settled=true;record.rejectReady(error);}if(!native.isDestroyed())native.destroy();});
 return readyPromise;
}
function trustedUrl(id:string){return trustedDesktopUrl(backendOrigin,id);}
function requestClose(record:WindowRecord):Promise<boolean>{
 if(record.window.isDestroyed())return Promise.resolve(true);if(record.closePromise)return record.closePromise;
 const requestId=randomUUID();record.closePromise=new Promise<boolean>(resolve=>{const finish=(allow:boolean)=>{record.closeRequest=undefined;record.closePromise=undefined;resolve(allow);};record.closeRequest={id:requestId,resolve:finish,timer:setTimeout(()=>finish(false),15000)};record.window.webContents.send(channels.closeRequest,requestId);});return record.closePromise;
}
function destroyWindow(record:WindowRecord){if(record.window.isDestroyed())return;remember(record,quitting);loseBrowserOwner(record);record.window.destroy();}
async function mainWindow(){const existing=[...windows.values()].find(record=>record.surface.kind==='main');if(existing){existing.visible=true;if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();remember(existing);broadcast();await existing.readyPromise;return existing;}const result=await openSurface({kind:'main'});return windows.get(result.id)!;}
function backendRequest(type:'harness.stopAll'|'harness.layout.save'|'harness.plugin.validate'|'harness.update.readiness'|'harness.update.prepare',extra:Record<string,unknown>={}):Promise<Record<string,unknown>>{
 const child=backend,token=launchToken,requestId=randomUUID(),reply=type==='harness.stopAll'?'harness.stoppedAll':type==='harness.layout.save'?'harness.layout.saved':type==='harness.plugin.validate'?'harness.plugin.validated':type+'.result';
 if(!child?.connected||child.exitCode!==null||child.signalCode)return Promise.reject(Error('The local backend is unavailable. Restore the workspace and retry.'));
 return new Promise((resolve,reject)=>{const finish=(error?:Error,value?:Record<string,unknown>)=>{clearTimeout(timer);child.removeListener('message',receive);child.removeListener('exit',exited);child.removeListener('disconnect',exited);if(error)reject(error);else resolve(value!);};const receive=(raw:unknown)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))return;const value=raw as Record<string,unknown>;if(value.type===reply&&value.token===token&&value.requestId===requestId){if(value.error)finish(Error(String(value.error).slice(0,500)));else finish(undefined,value);}};const exited=()=>finish(Error('The local backend disconnected before acknowledging the action.'));const timer=setTimeout(()=>finish(Error('The local backend did not acknowledge the action. Restore the workspace and retry.')),15000);child.on('message',receive);child.once('exit',exited);child.once('disconnect',exited);try{child.send({type,token,requestId,...extra},error=>{if(error)finish(error);});}catch(error){finish(error instanceof Error?error:Error(String(error)));}});
}
function installTray(){
 const pixels=Buffer.alloc(16*16*4);for(let y=3;y<13;y++)for(let x=2;x<14;x++)if(x===2||x===13||y===3||y===11||y===12&&x===4){const offset=(y*16+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=210;pixels[offset+3]=255;}
 tray=new Tray(nativeImage.createFromBitmap(pixels,{width:16,height:16,scaleFactor:1}));tray.setToolTip('Gen V1 — tasks keep running when windows are hidden');
 const report=(cause:unknown)=>{layoutError=String(cause instanceof Error?cause.message:cause).slice(0,500);broadcast();if(!testData)void dialog.showMessageBox({type:'error',title:'Gen V1',message:layoutError,buttons:['Close']});};
 tray.on('double-click',()=>void mainWindow().catch(report));tray.setContextMenu(Menu.buildFromTemplate([{label:'Restore Workspace',click:()=>{void (async()=>{await mainWindow();for(const record of windows.values()){record.visible=true;if(record.window.isMinimized())record.window.restore();record.window.show();remember(record);}broadcast();})().catch(report);}},{label:'Stop running tasks',enabled:true,click:()=>{void backendRequest('harness.stopAll').then(value=>{if(Array.isArray(value.errors)&&value.errors.length)throw Error(value.errors.map(String).join('\n'));}).catch(report);}},{type:'separator'},{label:'Quit Gen V1',click:()=>app.quit()}]));
}
async function applyLayout(raw:DesktopLayout){
 const next=parseDesktopLayout(raw);if(next.windows.some(entry=>!desktopSurfaceAllowed(entry.surface)))throw Error('A profile cannot transfer another workspace authority.');const current=captureLayout();for(const entry of next.windows)if(entry.surface.kind!=='main')requireExistingDetachedSurface(entry.surface,current.windows.map(value=>value.surface));if(current.windows.some(entry=>entry.surface.kind!=='main'&&!next.windows.some(value=>desktopSurfaceKey(value.surface)===desktopSurfaceKey(entry.surface))))throw Error('Keep existing child windows open while detached layouts are unavailable.');const before=structuredClone(saved),wasRestoring=restoringLayout;restoringLayout=true;
 const find=(entry:DesktopLayoutEntry)=>[...windows.values()].find(record=>desktopSurfaceKey(record.surface)===desktopSurfaceKey(entry.surface));
 try{await applyNativeLayout(next,{current:()=>captureLayout().windows,prepare:async entry=>{const record=find(entry);if(record&&!await requestClose(record))throw Error('Save the window edits before applying this profile. Your current layout is unchanged.');},open:async entry=>{if(entry.surface.kind!=='main')requireExistingDetachedSurface(entry.surface,[...windows.values()].map(record=>record.surface));const record=find(entry);if(!record||record.window.isDestroyed())throw Error('The existing window is no longer available.');},apply:async entry=>{const record=find(entry);if(!record)throw Error('A profile window is no longer available.');const placement=entry.placement??captureDesktopPlacement(entry.bounds,displays());applyPlacement(record,restoreDesktopPlacement(placement,displays(),surfaceSize(entry.surface)),placement);record.window.setAlwaysOnTop(entry.alwaysOnTop);if(record.dockedBrowser&&record.dockedBrowser.id!==entry.dockedBrowserId)detachOwnedBrowser(record,record.dockedBrowser,value=>record.window.contentView.removeChildView(value.view));if(entry.surface.kind==='browser')moveBrowser(browserRecord(entry.surface.browserId),record,false);if(entry.dockedBrowserId)moveBrowser(browserRecord(entry.dockedBrowserId),record,true);record.visible=entry.visible;if(entry.visible){if(record.window.isMinimized())record.window.restore();record.window.show();}else record.window.hide();remember(record);},close:async entry=>{const record=find(entry);if(record)destroyWindow(record);},resume:()=>{for(const record of windows.values())cancelClose(record);}});for(const browser of browsers.values())if(!browser.owner){browser.generation++;browsers.delete(browser.id);if(!browser.view.webContents.isDestroyed())browser.view.webContents.close({waitForBeforeUnload:false});}layoutError=undefined;}catch(error){saved=before;throw error;}finally{restoringLayout=wasRestoring;persist();broadcast();}
}
function registerIpc(){
 const handle=(channel:string,action:(record:WindowRecord,value:unknown)=>unknown)=>ipcMain.handle(channel,async(event,value)=>{const record=authorize(event);if(record.surface.kind==='plugin'&&pluginDesktopRequiresGrant(channel)&&(await backendRequest('harness.plugin.validate',{surface:record.surface})).allowed!==true)throw Error('The plug-in window authority is unavailable.');if(record.surface.kind==='plugin'&&!pluginDesktopChannelAllowed(channel))throw Error('This action is unavailable in a plug-in window.');return action(record,value);});
 handle(channels.context,record=>context(record));
 handle(channels.theme,(record,value)=>{const theme=nativeTitlebarTheme(value);if(process.platform==='win32')record.window.setTitleBarOverlay(theme);});
 handle(channels.update,async(_record,value)=>{if(value!=='check'&&value!=='restart')throw Error('Invalid update action.');if(value==='check')return updater?await updater.check():updateStatus;if(updateStatus.state!=='ready'&&updateStatus.state!=='deferred')return updateStatus;if(osSessionEnding||signInFlows.isBusy()||(await backendRequest('harness.update.readiness')).idle!==true){updateStatus={state:'deferred',message:'Finish the current work before restarting to update.'};broadcast();return updateStatus;}restartForUpdate=true;app.quit();return updateStatus;});
 handle(channels.ready,record=>{if(!record.ready){try{if(record.surface.kind==='browser')moveBrowser(browserRecord(record.surface.browserId),record,false);record.ready=true;record.settled=true;clearTimeout(record.readyTimer);if(record.visible)record.window.show();record.resolveReady(info(record));remember(record);broadcast();}catch(error){record.settled=true;clearTimeout(record.readyTimer);record.rejectReady(error instanceof Error?error:Error(String(error)));loseBrowserOwner(record);record.window.destroy();throw error;}}return context(record);});
 handle(channels.list,caller=>[...windows.values()].filter(record=>caller.surface.kind!=='plugin'||record.surface.kind==='plugin'&&record.surface.pluginId===caller.surface.pluginId&&record.surface.scopeId===caller.surface.scopeId).map(info));
 handle(channels.captureLayout,()=>captureLayout());
 handle(channels.applyLayout,(_record,value)=>handoff(()=>applyLayout(parseDesktopLayout(value))));
 handle(channels.control,(_caller,value)=>{const command=parseDesktopWindowControl(value),record=windows.get(command.windowId);if(!record)throw Error('Window is no longer open');if(_caller.surface.kind==='plugin'&&desktopSurfaceKey(_caller.surface)!==desktopSurfaceKey(record.surface))throw Error('This window belongs to another workspace.');if(command.type==='always-on-top')record.window.setAlwaysOnTop(command.enabled);else{if(!command.visible&&!tray)throw Error('The tray must be available before hiding a window.');record.visible=command.visible;if(command.visible){if(record.window.isMinimized())record.window.restore();record.window.show();}else record.window.hide();}remember(record);broadcast();});
 handle(channels.detach,(_caller,value)=>handoff(async()=>{
  const surface=parseDesktopSurface(value);
  if(surface.kind==='main')throw Error('The main workspace cannot be detached.');
  if(_caller.surface.kind==='plugin'&&desktopSurfaceKey(_caller.surface)!==desktopSurfaceKey(surface))throw Error('This surface belongs to a different workspace authority.');
  requireExistingDetachedSurface(surface,[...windows.values()].map(record=>record.surface));
  if(surface.kind==='plugin'&&(await backendRequest('harness.plugin.validate',{surface})).allowed!==true)throw Error('The plug-in window authority is unavailable.');
  const existing=[...windows.values()].find(record=>desktopSurfaceKey(record.surface)===desktopSurfaceKey(surface));
  if(!existing||existing.window.isDestroyed())throw Error('The existing window is no longer available.');
  existing.visible=true;if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();remember(existing);broadcast();return info(existing);
 }));
 handle(channels.reattach,record=>handoff(async()=>{
  if(record.surface.kind==='main')return;
  if(record.surface.kind==='plugin'&&(await backendRequest('harness.plugin.validate',{surface:record.surface})).allowed!==true)throw Error('The plug-in host did not authorize this window.');
  const main=await mainWindow();
  if(record.browser&&main.dockedBrowser&&main.dockedBrowser!==record.browser)throw Error('The main workspace already owns another browser. Both views remain open; return after that browser is no longer docked.');
  try{if(!await requestClose(record))throw Error('Save the window edits before attaching it');if(main.window.isDestroyed())throw Error('The main window closed before attachment. Your detached view is still available.');if(record.browser)moveBrowser(record.browser,main,true);const surface=record.surface;destroyWindow(record);broadcast(surface);}catch(error){cancelClose(record);throw error;}
 }));
 handle(channels.minimize,record=>record.window.minimize());
 handle(channels.signIn,(_record,value)=>{const target=parseDesktopSignInTarget(value);return beginSignIn(target.provider,target.accountId);});
 handle(channels.signInStatus,(_record,value)=>{if(!desktopId(value))throw Error('Invalid sign-in flow.');return signInFlows.status(value);});
 handle(channels.cancelSignIn,(_record,value)=>{if(!desktopId(value))throw Error('Invalid sign-in flow.');return signInFlows.cancel(value);});
 handle(channels.reset,record=>resetWindowPosition(record));
 handle(channels.focus,async(_record,value)=>{
  if(!desktopId(value))throw Error('Invalid window identity');const target=windows.get(value);if(!target)throw Error('Window is no longer open');
  if(_record.surface.kind==='plugin'&&desktopSurfaceKey(_record.surface)!==desktopSurfaceKey(target.surface))throw Error('This window belongs to another workspace.');
  if(target.surface.kind==='plugin'&&(await backendRequest('harness.plugin.validate',{surface:target.surface})).allowed!==true)throw Error('The plug-in window authority is unavailable.');
  if(windows.get(value)!==target||target.window.isDestroyed())throw Error('Window is no longer open');
  target.visible=true;if(target.window.isMinimized())target.window.restore();target.window.show();target.window.focus();remember(target);broadcast();
 });
 handle(channels.closeAnswer,(record,value)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid close acknowledgment');const answer=value as Record<string,unknown>,request=record.closeRequest;if(Object.keys(answer).length!==2||typeof answer.allow!=='boolean'||!request||answer.requestId!==request.id)throw Error('Stale close acknowledgment');clearTimeout(request.timer);request.resolve(answer.allow);});
 handle(channels.browser,async(record,raw)=>{
  const command=parseBrowserCommand(raw),browser=record.browser??record.dockedBrowser;if(!browser)throw Error('No browser is attached to this window');const contents=browser.view.webContents;
  if(command.type==='bounds'){if(!record.dockedBrowser)throw Error('Only the docked browser can set content bounds');const [width,height]=record.window.getContentSize(),bounds=command.bounds;if(bounds.x<0||bounds.y<0||bounds.width<0||bounds.height<0||bounds.x+bounds.width>width+1||bounds.y+bounds.height>height+1)throw Error('Browser bounds must fit the window');browser.view.setBounds({x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.floor(bounds.width),height:Math.floor(bounds.height)});return;}
  await browser.networkReady;const generation=++browser.generation;
  if(command.type==='navigate'){if(!await allowRemoteBrowserUrl(command.url))throw Error('Only public HTTP and HTTPS pages are allowed. Local and private-network requests are blocked.');if(generation!==browser.generation)return;browser.state.error=undefined;await contents.loadURL(remoteBrowserUrl(command.url).href).catch(error=>{if(generation===browser.generation){browser.state.error=error instanceof Error?error.message:'The page could not be loaded';browserState(browser);}});}
  else if(command.type==='back'&&contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();
  else if(command.type==='forward'&&contents.navigationHistory.canGoForward())contents.navigationHistory.goForward();
  else if(command.type==='reload'){browser.state.error=undefined;contents.reload();}
  else if(command.type==='stop')contents.stop();
 });
}
async function startBackend():Promise<void>{
 const token=randomBytes(32).toString('hex');launchToken=token;
 const env:NodeJS.ProcessEnv={...process.env,HARNESS_DATA_DIR:backendDataDir,HARNESS_PORT:String(backendPort),HARNESS_WIDGET_PORT:String(widgetPort),HARNESS_DESKTOP_LAUNCH_TOKEN:token,HARNESS_DEV:'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 env.HARNESS_PACKAGED=app.isPackaged?'1':'0';env.HARNESS_BUNDLED_GIT=join(root,'.harness-tool-bundles/git/cmd/git.exe');
 const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')??'PATH';env[pathKey]=dirname(env.HARNESS_BUNDLED_GIT)+';'+(env[pathKey]??'');
 const child=spawn(nodePath,nodeSidecarArguments(root),{cwd:root,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,serialization:'json'});backend=child;
 let stderr='';child.stderr?.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-8000);});child.stdout?.on('data',()=>{});
 const value=await waitForBackendReady(child,token,backendPort,()=>stderr);backendOrigin=value.origin as string;
 if(value.nativeLayout!==undefined)try{hostLayout=parseDesktopLayout(value.nativeLayout);}catch{layoutError='The saved host workspace layout is invalid. The local backup is retained.';}
 await workspaceRelay?.close();workspaceRelay=workspaceEvents(backendOrigin,change=>{for(const record of windows.values())if(!record.window.isDestroyed())record.window.webContents.send(channels.workspaceChanged,change);});
 backendError=undefined;broadcast();
 child.once('exit',()=>{if(closing||backend!==child)return;backendError='The local backend stopped. Reconnecting…';broadcast();if(restarting)return;restarting=true;setTimeout(()=>{void startBackend().catch(error=>{backendError='Backend restart failed: '+String(error instanceof Error?error.message:error).slice(0,500);broadcast();}).finally(()=>{restarting=false;});},700);});
}
async function stopBackend():Promise<boolean>{
 let clean=true;
 try{await workspaceRelay?.close();}catch{clean=false;}workspaceRelay=undefined;
 try{await signInFlows.close();}catch{clean=false;}
 closing=true;const child=backend;if(!child||child.exitCode!==null||child.signalCode)return false;
 let acknowledged=false;const token=launchToken;
 const message=(value:unknown)=>{if(value&&typeof value==='object'&&(value as Record<string,unknown>).type==='harness.stopped'&&(value as Record<string,unknown>).token===token)acknowledged=true;};
 child.on('message',message);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const stopped=new Promise<boolean>(resolve=>child.once('exit',code=>resolve(code===0)));
 try{
  try{child.send({type:'harness.shutdown',token});}catch{clean=false;}
  const graceful=await Promise.race([stopped,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),11000);})]);
  if(!graceful&&child.pid){if(process.platform==='win32'){await new Promise<void>(resolve=>{const kill=spawn(join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('error',()=>resolve());kill.once('exit',()=>resolve());});}else child.kill('SIGKILL');}
  return clean&&graceful&&acknowledged;
 }finally{clearTimeout(timer);child.removeListener('message',message);}
}
function startUpdater(){
 if(!app.isPackaged||testData||!existsSync(join(dirname(app.getPath('exe')),'Uninstall Gen V1.exe')))return;
 try{
  const require=createRequire(join(root,'package.json'));
  const driver=(require('electron-updater') as {autoUpdater:DesktopUpdateDriver}).autoUpdater;
  const semver=require('semver') as {valid:(value:string)=>string|null;prerelease:(value:string)=>unknown[]|null;gt:(left:string,right:string)=>boolean};
  const pluginRoot=resolve(process.env.HARNESS_PLUGIN_DIR??join(process.env.LOCALAPPDATA??app.getPath('home'),'GenV1','plugins'));
  updater=createDesktopUpdater({updater:driver,installed:true,currentVersion:app.getVersion(),isStableNewerVersion:(next,current)=>Boolean(semver.valid(next)&&!semver.prerelease(next)&&semver.gt(next,current)),compatibility:async version=>({allowed:(await checkInstalledCompatibility(pluginRoot,version)).compatible}),notify:status=>{updateStatus=status;broadcast();}});
  void updater.start();
 }catch{updateStatus={state:'failed',message:'Automatic updates could not start. Gen will keep the current version.'};broadcast();}
}
async function closeApplication(){
 let activeWorkAtClose=true,savedStateFlushed=false;
 try{activeWorkAtClose=signInFlows.isBusy()||(await backendRequest('harness.update.readiness')).idle!==true;}catch{}
 for(const record of windows.values())if(!await requestClose(record)){for(const entry of windows.values())cancelClose(entry);restartForUpdate=false;return;}
 await signInFlows.close();
 clearTimeout(saveTimer);try{await persistence.flush();}catch{layoutError='Workspace layout could not be saved.';}
 savedStateFlushed=!layoutError;
 try{await backendRequest('harness.layout.save',{layout:captureLayout()});}catch{savedStateFlushed=false;}
 if(!activeWorkAtClose&&savedStateFlushed&&updater){try{if((await backendRequest('harness.update.prepare')).idle!==true)activeWorkAtClose=true;}catch{activeWorkAtClose=true;}}
 quitting=true;for(const record of [...windows.values()])destroyWindow(record);clearTimeout(saveTimer);
 try{await persistence.enqueue(async()=>{await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile,JSON.stringify({version:1,windows:saved.slice(-24)}),{encoding:'utf8',mode:0o600});});}catch{savedStateFlushed=false;}
 const backendStoppedCleanly=await stopBackend();
 for(const browser of browsers.values())if(!browser.view.webContents.isDestroyed())browser.view.webContents.close({waitForBeforeUnload:false});
 try{await proxyPromise?.then(proxy=>proxy.close());}catch{savedStateFlushed=false;}tray?.destroy();
 const installing=await updater?.installAfterClose(()=>({activeWorkAtClose,osSessionEnding,savedStateFlushed,backendStoppedCleanly}),restartForUpdate);
 updater?.dispose();if(!installing){if(restartForUpdate&&!osSessionEnding)app.relaunch();app.exit(0);}
}

if(!app.requestSingleInstanceLock()){app.exit(0);}else{
 app.on('second-instance',()=>{void mainWindow().catch(()=>{});});
 app.on('window-all-closed',()=>{if(!quitting)app.quit();});
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();if(quitPending)return;quitPending=true;void closeApplication().catch(()=>{for(const record of windows.values())cancelClose(record);}).finally(()=>{quitPending=false;if(!quitting)restartForUpdate=false;});});
 void app.whenReady().then(async()=>{
  if(!Number.isInteger(backendPort)||backendPort<1024||backendPort>65535||(!Number.isInteger(widgetPort)||widgetPort<1024||widgetPort>65535||backendPort===widgetPort))throw Error('Desktop backend ports are invalid');
  await loadSaved();registerIpc();
  powerMonitor.on('shutdown',()=>{osSessionEnding=true;});
  installApplicationMenu();installTray();
  startupTimer=setTimeout(()=>{if(quitting||quitPending)return;startup=new BrowserWindow({width:420,height:190,...nativeTitlebarOptions(process.platform),resizable:false,maximizable:false,minimizable:false,title:'Opening Gen V1',autoHideMenuBar:true,backgroundColor:'#0f0f0f',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});startup.webContents.setWindowOpenHandler(()=>({action:'deny'}));startup.webContents.on('will-navigate',event=>event.preventDefault());void startup.loadFile(join(dirname(fileURLToPath(import.meta.url)),'startup.html')).catch(()=>{});},1200);
  await startBackend();if(hostLayout)saved=reconcileSavedWindows(saved,hostLayout.windows.map(entry=>({...entry,open:true})));const initial=structuredClone(saved.filter(entry=>entry.open&&entry.surface.kind!=='main')),savedDocked=saved.find(entry=>entry.surface.kind==='main')?.dockedBrowserId;const main=await mainWindow();clearTimeout(startupTimer);startup?.destroy();startup=undefined;if(savedDocked)moveBrowser(browserRecord(savedDocked),main,true);
  const failures:string[]=[];for(const entry of initial)try{await openSurface(entry.surface,undefined,true);}catch(error){failures.push(displayTitle(entry.surface)+': '+String(error instanceof Error?error.message:error));}
  restoringLayout=false;if(failures.length){layoutError='Some saved windows could not restore. Their layout is retained: '+failures.join('; ').slice(0,800);broadcast();}else if(!layoutError)persist();
  startUpdater();
  const displaysChanged=()=>{const all=displays();for(const record of windows.values()){record.monitorRescued=!!record.placement&&!all.some(display=>display.id===record.placement!.displayId);applyPlacement(record,restoreDesktopPlacement(record.placement,all,surfaceSize(record.surface)));}installApplicationMenu();};screen.on('display-removed',displaysChanged);screen.on('display-added',displaysChanged);screen.on('display-metrics-changed',displaysChanged);
 }).catch(async error=>{clearTimeout(startupTimer);startup?.destroy();startup=undefined;const message=String(error instanceof Error?error.message:error).slice(0,1200);process.stderr.write('Gen V1 startup failed: '+message+'\n');quitting=true;await stopBackend();if(!testData)await dialog.showMessageBox({type:'error',title:'Gen V1 could not start',message,buttons:['Close']});app.exit(1);});
}
