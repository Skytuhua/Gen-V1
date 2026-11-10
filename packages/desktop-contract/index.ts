import {pluginSurfaceSchema,type PluginSurface} from '../plugins/contracts.ts';
export type DesktopWorkspaceTab = 'launcher' | 'files' | 'diff' | 'output' | 'usage' | 'notes' | 'artifact' | 'context' | 'terminal' | 'pull-request' | 'linked-pull-requests';
export type DesktopPluginSurface=PluginSurface;
export type DesktopSurface =
  | {kind:'main'}
  | DesktopPluginSurface
  | {kind:'navigation';threadId?:string}
  | {kind:'workspace';threadId?:string;tab?:DesktopWorkspaceTab;artifactId?:string;panelId?:string}
  | {kind:'plan'|'usage'|'thread';threadId:string}
  | {kind:'artifact';threadId:string;artifactId:string}
  | {kind:'agent';threadId:string;agentId:string}
  | {kind:'browser';browserId:string};
export interface DesktopBrowserState {url:string;title:string;canGoBack:boolean;canGoForward:boolean;loading:boolean;error?:string}
export interface DesktopBounds {x:number;y:number;width:number;height:number}
export interface DesktopLayoutEntry {surface:DesktopSurface;bounds:DesktopBounds;visible:boolean;alwaysOnTop:boolean;dockedBrowserId?:string;displayId?:string;placement?:{displayId:string;workArea:DesktopBounds;bounds:DesktopBounds}}
export interface DesktopLayout {version:1;windows:DesktopLayoutEntry[]}
export type DesktopWindowControl={windowId:string;type:'visibility';visible:boolean}|{windowId:string;type:'always-on-top';enabled:boolean};
export interface DesktopWindowInfo {id:string;surface:DesktopSurface;ready:boolean;minimized:boolean;visible?:boolean;alwaysOnTop?:boolean;bounds?:DesktopBounds;displayId?:string}
export interface DesktopUpdateStatus {state:'unavailable'|'idle'|'checking'|'current'|'downloading'|'ready'|'deferred'|'failed'|'installing';message:string;version?:string;percent?:number}
export interface DesktopState {windows:DesktopWindowInfo[];browser?:DesktopBrowserState;dockedBrowser?:{browserId:string;state:DesktopBrowserState};focusSurface?:DesktopSurface;backendError?:string;layoutError?:string;closeCancelled?:boolean;update?:DesktopUpdateStatus;nativeTitleBar?:boolean}
export interface DesktopContext extends DesktopState {windowId:string;surface:DesktopSurface}
export interface DesktopWorkspaceChange {connected:boolean;sequence:number}
export type DesktopBrowserCommand = {type:'navigate';url:string}|{type:'back'|'forward'|'reload'|'stop'}|{type:'bounds';bounds:{x:number;y:number;width:number;height:number}};
export interface DesktopBridge {
  setTheme?(theme:'light'|'dark'):Promise<void>;
  update?(action:'check'|'restart'):Promise<DesktopUpdateStatus>;
  getContext():Promise<DesktopContext>;
  ready():Promise<DesktopContext>;
  detach(surface:DesktopSurface):Promise<DesktopWindowInfo>;
  reattach():Promise<void>;
  minimize():Promise<void>;
  signIn(provider?:string,accountId?:string):Promise<void | import('../contracts/authentication.ts').AccountLoginFlow>;
  signInStatus?(flowId:string):Promise<import('../contracts/authentication.ts').AccountLoginFlow|null>;
  cancelSignIn?(flowId:string):Promise<import('../contracts/authentication.ts').AccountLoginFlow>;
  resetBounds():Promise<void>;
  focus(windowId:string):Promise<void>;
  list():Promise<DesktopWindowInfo[]>;
  control?(command:DesktopWindowControl):Promise<void>;
  captureLayout?():Promise<DesktopLayout>;
  applyLayout?(layout:DesktopLayout):Promise<void>;
  browser(command:DesktopBrowserCommand):Promise<void>;
  onState(listener:(state:DesktopState)=>void):()=>void;
  onCloseRequested(handler:()=>Promise<boolean>):()=>void;
  onWorkspaceChanged?(listener:(change:DesktopWorkspaceChange)=>void):()=>void;
}
export const DESKTOP_CHANNELS={theme:'harness-desktop:theme',update:'harness-desktop:update',context:'harness-desktop:context',ready:'harness-desktop:ready',detach:'harness-desktop:detach',reattach:'harness-desktop:reattach',minimize:'harness-desktop:minimize',signIn:'harness-desktop:sign-in',signInStatus:'harness-desktop:sign-in-status',cancelSignIn:'harness-desktop:cancel-sign-in',reset:'harness-desktop:reset',focus:'harness-desktop:focus',list:'harness-desktop:list',browser:'harness-desktop:browser',state:'harness-desktop:state',closeRequest:'harness-desktop:close-request',closeAnswer:'harness-desktop:close-answer',workspaceChanged:'harness-desktop:workspace-changed',control:'harness-desktop:control',captureLayout:'harness-desktop:capture-layout',applyLayout:'harness-desktop:apply-layout'} as const;
const kinds=new Set(['main','navigation','workspace','plan','usage','thread','artifact','agent','browser','plugin']);
const tabs=new Set(['launcher','files','diff','output','usage','notes','artifact','context','terminal','pull-request','linked-pull-requests']);
export function desktopId(value:unknown):value is string{return typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9_.:-]+$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);}
export function parseDesktopSurface(value:unknown):DesktopSurface {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('Invalid desktop surface');
  const record=value as Record<string,unknown>,kind=record.kind;
  if(typeof kind!=='string'||!kinds.has(kind))throw Error('Unknown desktop surface');
  const allowed=new Set(['kind']);
  if(['navigation','workspace','plan','usage','thread','artifact','agent'].includes(kind))allowed.add('threadId');
  if(kind==='workspace'){allowed.add('tab');allowed.add('artifactId');allowed.add('panelId');}
  if(kind==='artifact')allowed.add('artifactId');if(kind==='agent')allowed.add('agentId');if(kind==='browser')allowed.add('browserId');
  if(kind==='plugin')for(const key of ['pluginId','scopeId','surfaceId','resourceId'])allowed.add(key);
  if(Object.keys(record).some(key=>!allowed.has(key)))throw Error('Unknown desktop surface property');
  for(const key of ['threadId','artifactId','agentId','browserId','panelId'])if(Object.hasOwn(record,key)&&!desktopId(record[key]))throw Error('Invalid desktop surface identity');
  if(['plan','usage','thread','artifact','agent'].includes(kind)&&!desktopId(record.threadId))throw Error('A task identity is required');
  if(kind==='artifact'&&!desktopId(record.artifactId)||kind==='agent'&&!desktopId(record.agentId)||kind==='browser'&&!desktopId(record.browserId))throw Error('A surface identity is required');
  if(record.tab!==undefined&&(typeof record.tab!=='string'||!tabs.has(record.tab)))throw Error('Unknown workspace tab');
  if(kind==='workspace'&&record.tab==='artifact'&&(!desktopId(record.artifactId)||!desktopId(record.threadId)))throw Error('An artifact workspace needs task and artifact identities');
  if(kind==='plugin')return pluginSurfaceSchema.parse(record);
  return {...record} as DesktopSurface;
}
export function desktopSurfaceKey(surface:DesktopSurface):string {
  const parsed=parseDesktopSurface(surface);
  if(parsed.kind==='plugin')return [parsed.kind,parsed.pluginId,parsed.scopeId,parsed.surfaceId,parsed.resourceId??''].join('|');
  if(parsed.kind==='workspace'&&parsed.tab==='artifact')return desktopSurfaceKey({kind:'artifact',threadId:parsed.threadId!,artifactId:parsed.artifactId!});
  return [parsed.kind,'threadId'in parsed?parsed.threadId:'','artifactId'in parsed?parsed.artifactId:'','agentId'in parsed?parsed.agentId:'','browserId'in parsed?parsed.browserId:'','tab'in parsed?parsed.tab:'',...('panelId'in parsed?[parsed.panelId]:[])].join('|');
}

function strictRecord(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid desktop layout');return value as Record<string,unknown>;}
function parseBounds(value:unknown):DesktopBounds{const record=strictRecord(value,['x','y','width','height']);if(!['x','y','width','height'].every(key=>typeof record[key]==='number'&&Number.isFinite(record[key])&&Math.abs(record[key] as number)<=100000)||Number(record.width)<1||Number(record.height)<1)throw Error('Invalid desktop bounds');return {...record} as unknown as DesktopBounds;}
export function parseDesktopLayout(value:unknown):DesktopLayout {
 const record=strictRecord(value,['version','windows']);if(record.version!==1||!Array.isArray(record.windows)||record.windows.length<1||record.windows.length>24)throw Error('A workspace needs between 1 and 24 native windows');
 const keys=new Set<string>();let mains=0;
 const windows=record.windows.map(raw=>{const entry=strictRecord(raw,['surface','bounds','visible','alwaysOnTop','displayId','placement','dockedBrowserId']),surface=parseDesktopSurface(entry.surface),key=desktopSurfaceKey(surface);if(keys.has(key))throw Error('Duplicate native surface');keys.add(key);if(surface.kind==='main')mains++;if(entry.dockedBrowserId!==undefined&&(surface.kind!=='main'||!desktopId(entry.dockedBrowserId)))throw Error('Invalid docked browser custody');if(typeof entry.visible!=='boolean'||typeof entry.alwaysOnTop!=='boolean')throw Error('Invalid native window preferences');if(entry.displayId!==undefined&&(typeof entry.displayId!=='string'||entry.displayId.length<1||entry.displayId.length>80))throw Error('Invalid display identity');let placement:DesktopLayoutEntry['placement'];if(entry.placement!==undefined){const p=strictRecord(entry.placement,['displayId','workArea','bounds']);if(typeof p.displayId!=='string'||p.displayId.length<1||p.displayId.length>80)throw Error('Invalid display placement');placement={displayId:p.displayId,workArea:parseBounds(p.workArea),bounds:parseBounds(p.bounds)};}return {surface,bounds:parseBounds(entry.bounds),visible:entry.visible,alwaysOnTop:entry.alwaysOnTop,...(entry.dockedBrowserId!==undefined?{dockedBrowserId:entry.dockedBrowserId as string}:{}),...(entry.displayId!==undefined?{displayId:entry.displayId as string}:{}),...(placement?{placement}:{})};});
 if(mains!==1)throw Error('A workspace must retain its main window');const docked=windows.find(entry=>entry.surface.kind==='main')?.dockedBrowserId;if(docked&&windows.some(entry=>entry.surface.kind==='browser'&&entry.surface.browserId===docked))throw Error('Duplicate native browser custody');return {version:1,windows};
}
export function parseDesktopWindowControl(value:unknown):DesktopWindowControl {const record=strictRecord(value,['windowId','type','visible','enabled']);if(!desktopId(record.windowId))throw Error('Invalid window identity');if(record.type==='visibility'&&Object.keys(record).length===3&&typeof record.visible==='boolean')return {windowId:record.windowId,type:'visibility',visible:record.visible};if(record.type==='always-on-top'&&Object.keys(record).length===3&&typeof record.enabled==='boolean')return {windowId:record.windowId,type:'always-on-top',enabled:record.enabled};throw Error('Invalid window control');}
declare global {interface Window {harnessDesktop?:DesktopBridge}}
