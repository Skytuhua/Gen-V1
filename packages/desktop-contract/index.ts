export type DesktopWorkspaceTab = 'launcher' | 'files' | 'diff' | 'output' | 'usage' | 'artifact';
export type DesktopSurface =
  | {kind:'main'}
  | {kind:'navigation';threadId?:string}
  | {kind:'workspace';threadId?:string;tab?:DesktopWorkspaceTab;artifactId?:string}
  | {kind:'plan'|'usage'|'thread';threadId:string}
  | {kind:'artifact';threadId:string;artifactId:string}
  | {kind:'agent';threadId:string;agentId:string}
  | {kind:'browser';browserId:string};
export interface DesktopBrowserState {url:string;title:string;canGoBack:boolean;canGoForward:boolean;loading:boolean;error?:string}
export interface DesktopWindowInfo {id:string;surface:DesktopSurface;ready:boolean;minimized:boolean}
export interface DesktopState {windows:DesktopWindowInfo[];browser?:DesktopBrowserState;dockedBrowser?:{browserId:string;state:DesktopBrowserState};focusSurface?:DesktopSurface;backendError?:string;closeCancelled?:boolean}
export interface DesktopContext extends DesktopState {windowId:string;surface:DesktopSurface}
export interface DesktopWorkspaceChange {connected:boolean;sequence:number}
export type DesktopBrowserCommand = {type:'navigate';url:string}|{type:'back'|'forward'|'reload'|'stop'}|{type:'bounds';bounds:{x:number;y:number;width:number;height:number}};
export interface DesktopBridge {
  getContext():Promise<DesktopContext>;
  ready():Promise<DesktopContext>;
  detach(surface:DesktopSurface):Promise<DesktopWindowInfo>;
  reattach():Promise<void>;
  minimize():Promise<void>;
  signIn(provider?:string,accountId?:string):Promise<void>;
  resetBounds():Promise<void>;
  focus(windowId:string):Promise<void>;
  list():Promise<DesktopWindowInfo[]>;
  browser(command:DesktopBrowserCommand):Promise<void>;
  onState(listener:(state:DesktopState)=>void):()=>void;
  onCloseRequested(handler:()=>Promise<boolean>):()=>void;
  onWorkspaceChanged?(listener:(change:DesktopWorkspaceChange)=>void):()=>void;
}
export const DESKTOP_CHANNELS={context:'harness-desktop:context',ready:'harness-desktop:ready',detach:'harness-desktop:detach',reattach:'harness-desktop:reattach',minimize:'harness-desktop:minimize',signIn:'harness-desktop:sign-in',reset:'harness-desktop:reset',focus:'harness-desktop:focus',list:'harness-desktop:list',browser:'harness-desktop:browser',state:'harness-desktop:state',closeRequest:'harness-desktop:close-request',closeAnswer:'harness-desktop:close-answer',workspaceChanged:'harness-desktop:workspace-changed'} as const;
const kinds=new Set(['main','navigation','workspace','plan','usage','thread','artifact','agent','browser']);
const tabs=new Set(['launcher','files','diff','output','usage','artifact']);
export function desktopId(value:unknown):value is string{return typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9_.:-]+$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);}
export function parseDesktopSurface(value:unknown):DesktopSurface {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('Invalid desktop surface');
  const record=value as Record<string,unknown>,kind=record.kind;
  if(typeof kind!=='string'||!kinds.has(kind))throw Error('Unknown desktop surface');
  const allowed=new Set(['kind']);
  if(['navigation','workspace','plan','usage','thread','artifact','agent'].includes(kind))allowed.add('threadId');
  if(kind==='workspace'){allowed.add('tab');allowed.add('artifactId');}
  if(kind==='artifact')allowed.add('artifactId');if(kind==='agent')allowed.add('agentId');if(kind==='browser')allowed.add('browserId');
  if(Object.keys(record).some(key=>!allowed.has(key)))throw Error('Unknown desktop surface property');
  for(const key of ['threadId','artifactId','agentId','browserId'])if(Object.hasOwn(record,key)&&!desktopId(record[key]))throw Error('Invalid desktop surface identity');
  if(['plan','usage','thread','artifact','agent'].includes(kind)&&!desktopId(record.threadId))throw Error('A task identity is required');
  if(kind==='artifact'&&!desktopId(record.artifactId)||kind==='agent'&&!desktopId(record.agentId)||kind==='browser'&&!desktopId(record.browserId))throw Error('A surface identity is required');
  if(record.tab!==undefined&&(typeof record.tab!=='string'||!tabs.has(record.tab)))throw Error('Unknown workspace tab');
  if(kind==='workspace'&&record.tab==='artifact'&&(!desktopId(record.artifactId)||!desktopId(record.threadId)))throw Error('An artifact workspace needs task and artifact identities');
  return {...record} as DesktopSurface;
}
export function desktopSurfaceKey(surface:DesktopSurface):string {
  const parsed=parseDesktopSurface(surface);
  if(parsed.kind==='workspace'&&parsed.tab==='artifact')return desktopSurfaceKey({kind:'artifact',threadId:parsed.threadId!,artifactId:parsed.artifactId!});
  return [parsed.kind,'threadId'in parsed?parsed.threadId:'','artifactId'in parsed?parsed.artifactId:'','agentId'in parsed?parsed.agentId:'','browserId'in parsed?parsed.browserId:'','tab'in parsed?parsed.tab:''].join('|');
}
declare global {interface Window {harnessDesktop?:DesktopBridge}}
