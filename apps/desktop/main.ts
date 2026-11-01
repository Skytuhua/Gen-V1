import {app,BrowserWindow,WebContentsView,ipcMain,session,screen,dialog,Menu,type IpcMainInvokeEvent,type Session} from 'electron';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESKTOP_CHANNELS as channels,desktopId,desktopSurfaceKey,parseDesktopSurface,type DesktopSurface,type DesktopWindowInfo,type DesktopContext,type DesktopState,type DesktopBrowserState} from '../../packages/desktop-contract/index.ts';
import {allowRemoteBrowserUrl,clampDesktopBounds,isTrustedDesktopSender,needsEditorHandoff,parseBrowserCommand,remoteBrowserUrl,surfaceSize,type DesktopBounds} from './window-policy.ts';
import {createBrowserProxy,type BrowserProxy} from './browser-proxy.ts';
import {nodeSidecarArguments} from './backend-policy.ts';
import {releaseOwnedBrowsers} from './browser-lifecycle.ts';
import {launchDesktopSignIn,type DesktopSignInHandle} from './auth-launcher.ts';
import {captureDesktopPlacement,parseDesktopPlacement,placeOnDesktopDisplay,restoreDesktopPlacement,retainDesktopPlacement,type DesktopDisplay,type DesktopPlacement} from './display-layout.ts';
import {isConnectionProviderId,type ConnectionProviderId} from '../../packages/contracts/connections.ts';
import {workspaceEvents} from './workspace-events.ts';

interface BrowserRecord {id:string;view:WebContentsView;state:DesktopBrowserState;owner?:WindowRecord;generation:number;networkReady:Promise<void>}
interface WindowRecord {id:string;surface:DesktopSurface;window:BrowserWindow;url:string;ready:boolean;settled:boolean;placement?:DesktopPlacement;appliedBounds?:DesktopBounds;monitorRescued?:boolean;recoveries?:number;resolveReady:(value:DesktopWindowInfo)=>void;rejectReady:(error:Error)=>void;readyPromise:Promise<DesktopWindowInfo>;readyTimer:ReturnType<typeof setTimeout>;browser?:BrowserRecord;dockedBrowser?:BrowserRecord;closePromise?:Promise<boolean>;closeRequest?:{id:string;resolve:(allow:boolean)=>void;timer:ReturnType<typeof setTimeout>}}
interface SavedWindow {surface:DesktopSurface;bounds:DesktopBounds;placement?:DesktopPlacement;open:boolean}
const windows=new Map<string,WindowRecord>(),browsers=new Map<string,BrowserRecord>();
const testData=process.env.HARNESS_DESKTOP_TEST_DATA_DIR;
app.setName('Generative Harness');
const profileRoot=testData?resolve(testData,'desktop-profile'):join(app.getPath('appData'),'GenerativeHarnessDesktop');mkdirSync(profileRoot,{recursive:true});mkdirSync(join(profileRoot,'session'),{recursive:true});app.setPath('userData',profileRoot);app.setPath('sessionData',join(profileRoot,'session'));
app.commandLine.appendSwitch('disable-quic');app.commandLine.appendSwitch('disable-features','WebTransport,DirectSockets');
const stateFile=join(app.getPath('userData'),'desktop-windows.json');
let saved:SavedWindow[]=[],saveTimer:ReturnType<typeof setTimeout>|undefined,backend:ChildProcess|undefined,backendOrigin='',backendError:string|undefined,launchToken='',quitting=false,quitPending=false,closing=false,restarting=false;
let proxyPromise:Promise<BrowserProxy>|undefined;
let handoffQueue:Promise<unknown>=Promise.resolve();
let workspaceRelay:ReturnType<typeof workspaceEvents>|undefined;
function handoff<T>(action:()=>Promise<T>):Promise<T>{const next=handoffQueue.catch(()=>{}).then(action);handoffQueue=next;return next;}
const root=resolve(process.env.HARNESS_DESKTOP_HOST_ROOT??(app.isPackaged?join(process.resourcesPath,'host'):join(dirname(fileURLToPath(import.meta.url)),'../..')));
const nodePath=resolve(process.env.HARNESS_DESKTOP_NODE_PATH??join(process.resourcesPath,'node','node.exe'));
const backendDataDir=resolve(testData?join(testData,'host'):process.env.HARNESS_DATA_DIR??join(process.env.LOCALAPPDATA??app.getPath('home'),'GenerativeHarness'));
let signInHandle:DesktopSignInHandle|undefined,signInStarting:Promise<void>|undefined,signInControl:AbortController|undefined,signInProvider:ConnectionProviderId|undefined;
async function beginSignIn(provider:ConnectionProviderId='openai'){
 if(quitting)throw Error('The application is closing.');
 if((signInStarting||signInHandle)&&signInProvider!==provider)throw Error('Finish or close the current provider sign-in before starting another.');
 if(signInStarting)return signInStarting;if(signInHandle)return;
 const control=new AbortController();signInControl=control;signInProvider=provider;
 signInStarting=(async()=>{const handle=await launchDesktopSignIn({nodePath,hostRoot:root,dataDir:backendDataDir,provider,signal:control.signal});signInHandle=handle;if(quitting)await handle.cancel();void handle.completion.catch(()=>{}).finally(()=>{if(signInHandle===handle)signInHandle=undefined;if(signInControl===control)signInControl=undefined;if(!signInHandle)signInProvider=undefined;});})().finally(()=>{signInStarting=undefined;if(!signInHandle)signInProvider=undefined;});
 return signInStarting;
}
const preload=join(dirname(fileURLToPath(import.meta.url)),'preload.cjs');
const backendPort=Number(process.env.HARNESS_DESKTOP_PORT??4317),widgetPort=Number(process.env.HARNESS_DESKTOP_WIDGET_PORT??4318);
function workAreas(){return screen.getAllDisplays().map(display=>display.workArea);}
function displays():DesktopDisplay[]{const primary=screen.getPrimaryDisplay(),all=screen.getAllDisplays();return (all.length?all:[primary]).map(display=>({id:String(display.id),workArea:display.workArea,label:display.label,scaleFactor:display.scaleFactor,primary:display.id===primary.id}));}
function info(record:WindowRecord):DesktopWindowInfo{return {id:record.id,surface:record.surface,ready:record.ready,minimized:record.window.isMinimized()};}
function snapshot(record:WindowRecord):DesktopState{return {windows:[...windows.values()].map(info),...(record.browser?{browser:record.browser.state}:{}),...(record.dockedBrowser?{dockedBrowser:{browserId:record.dockedBrowser.id,state:record.dockedBrowser.state}}:{}),...(backendError?{backendError}:{})};}
function broadcast(focusSurface?:DesktopSurface){for(const record of windows.values())if(!record.window.isDestroyed())record.window.webContents.send(channels.state,{...snapshot(record),...(record.surface.kind==='main'&&focusSurface?{focusSurface}:{})});}
function cancelClose(record:WindowRecord){if(!record.window.isDestroyed())record.window.webContents.send(channels.state,{...snapshot(record),closeCancelled:true});}
function context(record:WindowRecord):DesktopContext{return {...snapshot(record),windowId:record.id,surface:record.surface};}
function authorize(event:IpcMainInvokeEvent):WindowRecord {
 const record=[...windows.values()].find(entry=>entry.window.webContents.id===event.sender.id);
 if(!record||record.window.isDestroyed()||!isTrustedDesktopSender({id:record.window.webContents.id,url:record.url},{id:event.sender.id,url:event.senderFrame?.url??'',mainFrame:event.senderFrame===event.sender.mainFrame})||event.sender.getURL()!==record.url)throw Error('Desktop request denied');
 return record;
}
function persist(){
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void (async()=>{await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile,JSON.stringify({version:1,windows:saved.slice(-24)}),{encoding:'utf8',mode:0o600});})().catch(()=>{});},180);
}
function remember(record:WindowRecord,open=true){if(record.window.isDestroyed())return;const key=desktopSurfaceKey(record.surface),bounds=record.window.getNormalBounds(),all=displays();
 // Windows can move a native window before Electron emits display-removed.
 // Preserve its destination until our rescue has established a new baseline.
 const awaitingRescue=record.placement&&!all.some(display=>display.id===record.placement!.displayId)&&!record.monitorRescued;
 if(!awaitingRescue)record.placement=retainDesktopPlacement(bounds,record.placement,record.appliedBounds,all);
 if(record.placement&&all.some(display=>display.id===record.placement!.displayId))record.monitorRescued=false;
 const value={surface:record.surface,bounds,placement:record.placement,open};saved=[...saved.filter(entry=>desktopSurfaceKey(entry.surface)!==key),value].slice(-24);persist();}
async function loadSaved(){try{const bytes=await readFile(stateFile,'utf8');if(bytes.length>128*1024)return;const raw=JSON.parse(bytes);if(raw.version!==1||!Array.isArray(raw.windows)||raw.windows.length>24)return;for(const entry of raw.windows){try{const surface=parseDesktopSurface(entry.surface);if(entry.bounds&&typeof entry.bounds==='object')saved.push({surface,bounds:clampDesktopBounds(entry.bounds,workAreas(),surfaceSize(surface)),placement:parseDesktopPlacement(entry.placement),open:entry.open===true});}catch{}}}catch{}}
function applyPlacement(record:WindowRecord,bounds:DesktopBounds,preferred=record.placement){if(record.window.isDestroyed())return;record.placement=preferred;record.appliedBounds=bounds;record.window.setBounds(bounds);remember(record);}
function resetWindowPosition(record:WindowRecord){const all=displays(),current=captureDesktopPlacement(record.window.getBounds(),all),target=all.find(display=>display.id===current.displayId)!;const bounds=placeOnDesktopDisplay(surfaceSize(record.surface),target);applyPlacement(record,bounds,captureDesktopPlacement(bounds,all));}
function focusedRecord(){const focused=BrowserWindow.getFocusedWindow();return [...windows.values()].find(record=>record.window===focused);}
function moveWindowToDisplay(record:WindowRecord,id:string){const all=displays(),target=all.find(display=>display.id===id);if(!target)return;const bounds=placeOnDesktopDisplay(record.window.getNormalBounds(),target);applyPlacement(record,bounds,captureDesktopPlacement(bounds,all));}
function moveToAdjacentDisplay(offset:number){const record=focusedRecord(),all=displays();if(!record||all.length<2)return;const current=captureDesktopPlacement(record.window.getBounds(),all),index=all.findIndex(display=>display.id===current.displayId);moveWindowToDisplay(record,all[(index+offset+all.length)%all.length].id);}
function installApplicationMenu(){const all=displays();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{label:'Restore chat',click:()=>{void mainWindow();}},{type:'separator'},{label:'Quit Generative Harness',accelerator:'Control+Shift+Q',click:()=>app.quit()}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{label:'Move to Display',submenu:all.map((display,index)=>({label:(display.label||'Display '+(index+1))+(display.primary?' (Primary)':''),click:()=>{const record=focusedRecord();if(record)moveWindowToDisplay(record,display.id);}}))},{label:'Move to Next Display',accelerator:'Control+Alt+Right',enabled:all.length>1,click:()=>moveToAdjacentDisplay(1)},{label:'Move to Previous Display',accelerator:'Control+Alt+Left',enabled:all.length>1,click:()=>moveToAdjacentDisplay(-1)},{label:'Reset window position',click:()=>{const record=focusedRecord();if(record)resetWindowPosition(record);}}]}]));}
function displayTitle(surface:DesktopSurface){return ({main:'Generative Harness',plan:'Task plan',usage:'Live usage',thread:'Chat',artifact:'Task artifact',agent:'Subagent',navigation:'Projects and threads',workspace:'Workspace',browser:'Browser'})[surface.kind];}
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
 if(previous&&!previous.window.isDestroyed()){previous.window.contentView.removeChildView(browser.view);if(previous.browser===browser)previous.browser=undefined;if(previous.dockedBrowser===browser)previous.dockedBrowser=undefined;}
 browser.owner=owner;if(docked)owner.dockedBrowser=browser;else owner.browser=browser;
 owner.window.contentView.addChildView(browser.view);const [width,height]=owner.window.getContentSize();browser.view.setBounds(docked?{x:Math.max(0,width-520),y:100,width:Math.min(520,width),height:Math.max(0,height-100)}:{x:0,y:96,width,height:Math.max(0,height-96)});broadcast();
}
function loseBrowserOwner(record:WindowRecord){releaseOwnedBrowsers(record,browsers,browser=>{browser.generation++;if(!record.window.isDestroyed())record.window.contentView.removeChildView(browser.view);if(!browser.view.webContents.isDestroyed())browser.view.webContents.close({waitForBeforeUnload:false});});}
async function openSurface(raw:unknown,sourceBounds?:DesktopBounds):Promise<DesktopWindowInfo>{
 const surface=parseDesktopSurface(raw),key=desktopSurfaceKey(surface),existing=[...windows.values()].find(record=>desktopSurfaceKey(record.surface)===key);
 if(existing){if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();return existing.readyPromise;}
 if(windows.size>=24)throw Error('Close a window before opening another');
 if(surface.kind==='browser'&&!browsers.has(surface.browserId)&&browsers.size>=12)throw Error('Close a browser before opening another');
 const size=surfaceSize(surface),previous=saved.find(entry=>desktopSurfaceKey(entry.surface)===key),all=displays(),placement=previous?.placement??(previous?captureDesktopPlacement(previous.bounds,all):undefined),bounds=restoreDesktopPlacement(placement,all,size,sourceBounds),id=randomUUID(),url=trustedUrl(id);
 const native=new BrowserWindow({...bounds,minWidth:Math.min(320,bounds.width),minHeight:Math.min(160,bounds.height),show:false,title:displayTitle(surface),backgroundColor:'#f7f7f8',autoHideMenuBar:true,webPreferences:{preload,partition:'persist:harness',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
 let resolveReady!:(value:DesktopWindowInfo)=>void,rejectReady!:(error:Error)=>void;
 const readyPromise=new Promise<DesktopWindowInfo>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});void readyPromise.catch(()=>{});
 const record:WindowRecord={id,surface,window:native,url,ready:false,settled:false,placement:placement??captureDesktopPlacement(bounds,all),appliedBounds:bounds,monitorRescued:!!placement&&!all.some(display=>display.id===placement.displayId),resolveReady,rejectReady,readyPromise,readyTimer:setTimeout(()=>{if(record.ready)return;record.settled=true;record.rejectReady(Error('The detached window did not become ready. Your original view remains available.'));loseBrowserOwner(record);native.destroy();},20000)};
 windows.set(id,record);broadcast();
 native.webContents.setWindowOpenHandler(()=>({action:'deny'}));native.webContents.on('will-attach-webview',event=>event.preventDefault());
 native.webContents.on('will-navigate',(event,next)=>{if(next!==url)event.preventDefault();});native.webContents.on('will-redirect',(event,next)=>{if(next!==url)event.preventDefault();});
 native.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));native.webContents.session.setPermissionCheckHandler(()=>false);
 native.on('close',event=>{if(!quitting){event.preventDefault();void requestClose(record).then(allow=>{if(allow)destroyWindow(record);else cancelClose(record);}).catch(()=>cancelClose(record));}});
 native.on('closed',()=>{clearTimeout(record.readyTimer);if(!record.settled){record.settled=true;record.rejectReady(Error('The detached window closed before it was ready'));}windows.delete(id);if(record.closeRequest){clearTimeout(record.closeRequest.timer);record.closeRequest.resolve(false);}broadcast();});
 const resized=()=>{remember(record);if(record.browser){const [width,height]=native.getContentSize();record.browser.view.setBounds({x:0,y:96,width,height:Math.max(0,height-96)});}};
 native.on('move',resized);native.on('resize',resized);native.on('minimize',()=>broadcast());native.on('restore',()=>broadcast());
 native.webContents.on('render-process-gone',()=>{
  if(record.closeRequest){clearTimeout(record.closeRequest.timer);record.closeRequest.resolve(false);record.closeRequest=undefined;}
  const wasReady=record.ready;record.ready=false;clearTimeout(record.readyTimer);
  if(quitting||!wasReady||(record.recoveries??0)>=2){record.settled=true;record.rejectReady(Error('The detached view failed to load'));loseBrowserOwner(record);native.destroy();return;}
  record.recoveries=(record.recoveries??0)+1;record.settled=false;
  record.readyPromise=new Promise((accept,reject)=>{record.resolveReady=accept;record.rejectReady=reject;});void record.readyPromise.catch(()=>{});
  record.readyTimer=setTimeout(()=>{if(record.ready||native.isDestroyed())return;record.settled=true;record.rejectReady(Error('The detached view could not recover. Your saved draft is retained.'));destroyWindow(record);},20000);
  broadcast();
  setTimeout(()=>{if(native.isDestroyed()||quitting)return;void native.loadURL(url).catch(error=>{if(native.isDestroyed())return;record.settled=true;record.rejectReady(error);destroyWindow(record);});},150);
 });
 native.webContents.once('did-fail-load',(_event,code,description)=>{if(code!==-3&&!record.ready){record.settled=true;record.rejectReady(Error(description));loseBrowserOwner(record);native.destroy();}});
 await native.loadURL(url).catch(error=>{if(!record.settled){record.settled=true;record.rejectReady(error);}if(!native.isDestroyed())native.destroy();});
 return readyPromise;
}
function trustedUrl(id:string){return new URL('/?desktopWindow='+encodeURIComponent(id),backendOrigin).href;}
function requestClose(record:WindowRecord):Promise<boolean>{
 if(record.window.isDestroyed())return Promise.resolve(true);if(record.closePromise)return record.closePromise;
 const requestId=randomUUID();record.closePromise=new Promise<boolean>(resolve=>{const finish=(allow:boolean)=>{record.closeRequest=undefined;record.closePromise=undefined;resolve(allow);};record.closeRequest={id:requestId,resolve:finish,timer:setTimeout(()=>finish(false),15000)};record.window.webContents.send(channels.closeRequest,requestId);});return record.closePromise;
}
function destroyWindow(record:WindowRecord){if(record.window.isDestroyed())return;remember(record,quitting);loseBrowserOwner(record);record.window.destroy();}
async function mainWindow(){const existing=[...windows.values()].find(record=>record.surface.kind==='main');if(existing){if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();await existing.readyPromise;return existing;}const result=await openSurface({kind:'main'});return windows.get(result.id)!;}
function registerIpc(){
 const handle=(channel:string,action:(record:WindowRecord,value:unknown)=>unknown)=>ipcMain.handle(channel,(event,value)=>action(authorize(event),value));
 handle(channels.context,record=>context(record));
 handle(channels.ready,record=>{if(!record.ready){try{if(record.surface.kind==='browser')moveBrowser(browserRecord(record.surface.browserId),record,false);record.ready=true;record.settled=true;clearTimeout(record.readyTimer);record.window.show();record.resolveReady(info(record));broadcast();}catch(error){record.settled=true;clearTimeout(record.readyTimer);record.rejectReady(error instanceof Error?error:Error(String(error)));loseBrowserOwner(record);record.window.destroy();throw error;}}return context(record);});
 handle(channels.list,()=>[...windows.values()].map(info));
 handle(channels.detach,(_caller,value)=>handoff(async()=>{const surface=parseDesktopSurface(value);if(surface.kind==='main')throw Error('The main window cannot be detached');if([...windows.values()].some(record=>desktopSurfaceKey(record.surface)===desktopSurfaceKey(surface)))return openSurface(surface);const guarded:WindowRecord[]=[];try{for(const source of windows.values())if(source.ready&&needsEditorHandoff(surface,source.surface)){guarded.push(source);if(!await requestClose(source))throw Error('Save the matching task edits before detaching');}return await openSurface(surface,_caller.window.getBounds());}finally{for(const source of guarded)cancelClose(source);}}));
 handle(channels.reattach,record=>handoff(async()=>{
  if(record.surface.kind==='main')return;
  const main=await mainWindow();
  if(record.browser&&main.dockedBrowser&&main.dockedBrowser!==record.browser)await openSurface({kind:'browser',browserId:main.dockedBrowser.id});
  try{if(!await requestClose(record))throw Error('Save the window edits before attaching it');if(main.window.isDestroyed())throw Error('The main window closed before attachment. Your detached view is still available.');if(record.browser)moveBrowser(record.browser,main,true);const surface=record.surface;destroyWindow(record);broadcast(surface);}catch(error){cancelClose(record);throw error;}
 }));
 handle(channels.minimize,record=>record.window.minimize());
 handle(channels.signIn,(_record,value)=>{if(value!==undefined&&!isConnectionProviderId(value))throw Error('Unsupported subscription provider. Sign-in accepts no executable arguments.');return beginSignIn(value??'openai');});
 handle(channels.reset,record=>resetWindowPosition(record));
 handle(channels.focus,(_record,value)=>{if(!desktopId(value))throw Error('Invalid window identity');const target=windows.get(value);if(!target)throw Error('Window is no longer open');if(target.window.isMinimized())target.window.restore();target.window.show();target.window.focus();});
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
 const child=spawn(nodePath,nodeSidecarArguments(root),{cwd:root,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,serialization:'json'});backend=child;
 let stderr='';child.stderr?.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-8000);});child.stdout?.on('data',()=>{});
 await new Promise<void>((resolveReady,reject)=>{
  let done=false;const timer=setTimeout(()=>finish(Error('The local backend did not become ready')),25000);
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);child.removeListener('message',message);child.removeListener('error',failed);child.removeListener('exit',exited);if(error)reject(error);else resolveReady();};
  const failed=(error:Error)=>finish(error),exited=(code:number|null)=>finish(Error('The local backend stopped during startup ('+code+'). '+stderr.slice(-500)));
  const message=(raw:unknown)=>{if(!raw||typeof raw!=='object')return;const value=raw as Record<string,unknown>;if(value.token!==token)return;if(value.type==='harness.error')finish(Error(typeof value.message==='string'?value.message:'The local backend failed'));if(value.type==='harness.ready'&&value.origin==='http://127.0.0.1:'+backendPort&&value.pid===child.pid){backendOrigin=value.origin as string;finish();}};
  child.on('message',message);child.once('error',failed);child.once('exit',exited);
 });
 await workspaceRelay?.close();workspaceRelay=workspaceEvents(backendOrigin,change=>{for(const record of windows.values())if(!record.window.isDestroyed())record.window.webContents.send(channels.workspaceChanged,change);});
 backendError=undefined;broadcast();
 child.once('exit',()=>{if(closing||backend!==child)return;backendError='The local backend stopped. Reconnecting…';broadcast();if(restarting)return;restarting=true;setTimeout(()=>{void startBackend().catch(error=>{backendError='Backend restart failed: '+String(error instanceof Error?error.message:error).slice(0,500);broadcast();}).finally(()=>{restarting=false;});},700);});
}
async function stopBackend(){
 await workspaceRelay?.close();workspaceRelay=undefined;
 signInControl?.abort();await signInStarting?.catch(()=>{});await signInHandle?.cancel();
 closing=true;const child=backend;if(!child||child.exitCode!==null||child.signalCode)return;
 const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 try{child.send({type:'harness.shutdown',token:launchToken});}catch{}
 const graceful=await Promise.race([stopped.then(()=>true),new Promise<false>(resolve=>setTimeout(()=>resolve(false),11000))]);
 if(!graceful&&child.pid){if(process.platform==='win32'){await new Promise<void>(resolve=>{const kill=spawn(join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('error',()=>resolve());kill.once('exit',()=>resolve());});}else child.kill('SIGKILL');}
}
if(!app.requestSingleInstanceLock()){app.exit(0);}else{
 app.on('second-instance',()=>{void mainWindow().catch(()=>{});});
 app.on('window-all-closed',()=>{if(!quitting)app.quit();});
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();if(quitPending)return;quitPending=true;void (async()=>{for(const record of windows.values())if(!await requestClose(record)){for(const entry of windows.values())cancelClose(entry);return;}quitting=true;for(const record of [...windows.values()])destroyWindow(record);clearTimeout(saveTimer);await (async()=>{await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile,JSON.stringify({version:1,windows:saved.slice(-24)}),{encoding:'utf8',mode:0o600});})().catch(()=>{});await stopBackend();for(const browser of browsers.values())if(!browser.view.webContents.isDestroyed())browser.view.webContents.close({waitForBeforeUnload:false});await proxyPromise?.then(proxy=>proxy.close()).catch(()=>{});app.exit(0);})().catch(()=>{for(const record of windows.values())cancelClose(record);}).finally(()=>{quitPending=false;});});
 void app.whenReady().then(async()=>{
  if(!Number.isInteger(backendPort)||backendPort<1024||backendPort>65535||!Number.isInteger(widgetPort)||widgetPort<1024||widgetPort>65535||backendPort===widgetPort)throw Error('Desktop backend ports are invalid');
  await loadSaved();registerIpc();
  installApplicationMenu();
  await startBackend();await mainWindow();
  for(const entry of saved.filter(entry=>entry.open&&entry.surface.kind!=='main').slice(0,12))void openSurface(entry.surface).catch(()=>{});
  const displaysChanged=()=>{const all=displays();for(const record of windows.values()){record.monitorRescued=!!record.placement&&!all.some(display=>display.id===record.placement!.displayId);applyPlacement(record,restoreDesktopPlacement(record.placement,all,surfaceSize(record.surface)));}installApplicationMenu();};screen.on('display-removed',displaysChanged);screen.on('display-added',displaysChanged);screen.on('display-metrics-changed',displaysChanged);
 }).catch(async error=>{const message=String(error instanceof Error?error.message:error).slice(0,1200);process.stderr.write('Generative Harness startup failed: '+message+'\n');quitting=true;await stopBackend();if(!testData)await dialog.showMessageBox({type:'error',title:'Generative Harness could not start',message,buttons:['Close']});app.exit(1);});
}
