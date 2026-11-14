import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {DESKTOP_CHANNELS,desktopSurfaceKey,parseDesktopSurface,type DesktopSurface,type DesktopBrowserCommand} from '../../packages/desktop-contract/index.ts';
import {pluginFrameSource} from '../../packages/plugins/frame-protocol.ts';
import {pluginSurfaceSchema} from '../../packages/plugins/contracts.ts';
export interface DesktopBounds {x:number;y:number;width:number;height:number}
export function clampDesktopBounds(value:Partial<DesktopBounds>|undefined,areas:DesktopBounds[],size={width:1000,height:740}):DesktopBounds {
 const displays=areas.filter(area=>[area.x,area.y,area.width,area.height].every(Number.isFinite)&&area.width>0&&area.height>0);
 const fallback=displays[0]??{x:0,y:0,width:1280,height:800};
 const preferred=value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?displays.map(area=>({area,overlap:Math.max(0,Math.min(value.x!+(Number.isFinite(value.width)?Math.max(1,value.width!):size.width),area.x+area.width)-Math.max(value.x!,area.x))*Math.max(0,Math.min(value.y!+(Number.isFinite(value.height)?Math.max(1,value.height!):size.height),area.y+area.height)-Math.max(value.y!,area.y))})).sort((a,b)=>b.overlap-a.overlap).find(item=>item.overlap>0)?.area:undefined;
 const area=preferred??fallback,width=Math.min(area.width,Math.max(Math.min(320,area.width),Number.isFinite(value?.width)?value!.width!:size.width)),height=Math.min(area.height,Math.max(Math.min(160,area.height),Number.isFinite(value?.height)?value!.height!:size.height));
 const x=preferred?Math.max(area.x,Math.min(value!.x!,area.x+area.width-width)):area.x+Math.round((area.width-width)/2),y=preferred?Math.max(area.y,Math.min(value!.y!,area.y+area.height-height)):area.y+Math.round((area.height-height)/2);
 return {x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)};
}
export function trustedDesktopUrl(origin:string,id:string):string {return new URL('/?desktopWindow='+encodeURIComponent(id),origin).href;}
/** Only canonical plug-in frame URLs and the existing separate widget shell
 * can enter native subframes. The host route checks installed declarations;
 * main-frame/sender checks remain independent. */
export function trustedDesktopSubframe(raw:string,origin:string,widgetOrigin:string):boolean {
 try{
  const url=new URL(raw);if(url.username||url.password)return false;
  if(url.origin===widgetOrigin)return /^\/widget\/[^/]+\/[1-9]\d*$/.test(url.pathname);
  if(url.origin!==new URL(origin).origin)return false;
  const match=/^\/plugins\/([^/]+)\/frame$/.exec(url.pathname),session=url.searchParams.get('session'),theme=url.searchParams.get('theme');
  if(!match||!session||(theme!=='light'&&theme!=='dark'))return false;
  const surface=url.searchParams.has('scopeId')||url.searchParams.has('surfaceId')||url.searchParams.has('resourceId')?pluginSurfaceSchema.parse({kind:'plugin',pluginId:match[1],scopeId:url.searchParams.get('scopeId'),surfaceId:url.searchParams.get('surfaceId'),...(url.searchParams.has('resourceId')?{resourceId:url.searchParams.get('resourceId')}:{})}):undefined;
  const workspace=url.searchParams.has('workspace')||url.searchParams.has('view')?{id:url.searchParams.get('workspace')??'',title:'Workspace',entryView:url.searchParams.get('view')??''}:undefined;
  return raw===new URL(pluginFrameSource(match[1],session,theme,surface,workspace),origin).href;
 }catch{return false;}
}
const pluginChannels=new Set<string>([DESKTOP_CHANNELS.theme,DESKTOP_CHANNELS.context,DESKTOP_CHANNELS.ready,DESKTOP_CHANNELS.list,DESKTOP_CHANNELS.control,DESKTOP_CHANNELS.minimize,DESKTOP_CHANNELS.reset,DESKTOP_CHANNELS.focus,DESKTOP_CHANNELS.closeAnswer,DESKTOP_CHANNELS.detach,DESKTOP_CHANNELS.reattach]);
export function pluginDesktopChannelAllowed(channel:string){return pluginChannels.has(channel);}
export function pluginDesktopRequiresGrant(channel:string){return channel!==DESKTOP_CHANNELS.closeAnswer;}
export function nativeTitlebarTheme(value:unknown){if(value!=='light'&&value!=='dark')throw Error('Invalid window theme.');return {color:value==='light'?'#ffffff':'#0f0f0f',symbolColor:value==='light'?'#1f1f1f':'#eeeeee',height:42};}
export function nativeTitlebarOptions(platform:string){return platform==='win32'?{titleBarStyle:'hidden' as const,titleBarOverlay:nativeTitlebarTheme('dark')}:{ };}
export function desktopSurfaceAllowed(surface:DesktopSurface):boolean {parseDesktopSurface(surface);return true;}
/** Validates a detached-view request's surface identity before the window factory
 * admits it. The existing-window list is deliberately unused: the factory decides
 * create-vs-focus by surface key, so this policy only rejects malformed identities.
 * The parameter stays for the stable policy signature exercised by the tests. */
export function requireExistingDetachedSurface(surface:DesktopSurface,_existing:DesktopSurface[]):void {
 parseDesktopSurface(surface);
}
export function isTrustedDesktopSender(expected:{id:number;url:string},sender:{id:number;url:string;mainFrame:boolean}):boolean{return sender.mainFrame&&sender.id===expected.id&&sender.url===expected.url;}
export function parseBrowserCommand(raw:unknown):DesktopBrowserCommand {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('Invalid browser command');
 const value=raw as Record<string,unknown>;
 if(value.type==='open'&&Object.keys(value).length===1)return {type:'open'};
 if(value.type==='navigate'&&Object.keys(value).length===2&&typeof value.url==='string'&&value.url.length<=4096)return {type:'navigate',url:value.url};
 if(value.type==='bounds'&&Object.keys(value).length===2&&value.bounds&&typeof value.bounds==='object'&&!Array.isArray(value.bounds)){const bounds=value.bounds as Record<string,unknown>;if(Object.keys(bounds).length===4&&['x','y','width','height'].every(key=>typeof bounds[key]==='number'&&Number.isFinite(bounds[key])&&Math.abs(bounds[key] as number)<=20000))return {type:'bounds',bounds:bounds as unknown as DesktopBounds};}
 if(['back','forward','reload','stop','close'].includes(String(value.type))&&Object.keys(value).length===1)return {type:value.type as 'back'|'forward'|'reload'|'stop'|'close'};
 throw Error('Invalid browser command');
}
export function publicAddress(address:string):boolean {
 const value=address.toLowerCase().replace(/^\[|\]$/g,'');
 if(isIP(value)===4){const parts=value.split('.').map(Number);return !(parts[0]===0||parts[0]===10||parts[0]===127||parts[0]>=224||parts[0]===169&&parts[1]===254||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&(parts[1]===168||parts[1]===0&&(parts[2]===0||parts[2]===2)||parts[1]===88&&parts[2]===99)||parts[0]===100&&parts[1]>=64&&parts[1]<=127||parts[0]===198&&(parts[1]===18||parts[1]===19||parts[1]===51&&parts[2]===100)||parts[0]===203&&parts[1]===0&&parts[2]===113);}
 if(isIP(value)===6){if(value.startsWith('::ffff:'))return publicAddress(value.slice(7));const blocks=value.split(':');return /^[23]/.test(value)&&!value.startsWith('2002:')&&!value.startsWith('3fff:')&&!(blocks[0]==='2001'&&[0,2,0x10,0x20,0xdb8].includes(parseInt(blocks[1],16)));}
 return false;
}
export function remoteBrowserUrl(raw:string):URL {
 if(raw.length>4096||/[\u0000-\u0020\\]/.test(raw))throw Error('Enter a public HTTP or HTTPS address');
 let url:URL;try{url=new URL(raw);}catch{throw Error('Enter a complete HTTP or HTTPS address');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname||url.hostname.endsWith('.')||url.hostname.toLowerCase()==='localhost'||url.hostname.toLowerCase().endsWith('.localhost')||url.hostname.toLowerCase().endsWith('.local')||!url.hostname.includes('.')&&!isIP(url.hostname.replace(/^\[|\]$/g,'')))throw Error('Only public HTTP or HTTPS pages are available in the browser');
 if(url.port&&Number(url.port)!==(url.protocol==='https:'?443:80))throw Error('The browser supports public HTTP port80 and HTTPS port443');
 const host=url.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!publicAddress(host))throw Error('Local and private-network browser requests are blocked');return url;
}
export async function allowRemoteBrowserUrl(raw:string,resolver:(hostname:string)=>Promise<{address:string}[]>=hostname=>lookup(hostname,{all:true,verbatim:true})):Promise<boolean>{
 try{const url=remoteBrowserUrl(raw),host=url.hostname.replace(/^\[|\]$/g,'');if(isIP(host))return publicAddress(host);let timer:ReturnType<typeof setTimeout>|undefined;try{const addresses=await Promise.race([resolver(host),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Lookup timed out')),2500);})]);return addresses.length>0&&addresses.length<=32&&addresses.every(item=>publicAddress(item.address));}finally{clearTimeout(timer);}}catch{return false;}
}
export function surfaceSize(surface:DesktopSurface){parseDesktopSurface(surface);return surface.kind==='main'||surface.kind==='thread'?{width:1440,height:960}:surface.kind==='browser'?{width:1160,height:860}:['plan','usage','navigation','agent','plugin'].includes(surface.kind)?{width:430,height:720}:{width:1000,height:800};}
export function needsEditorHandoff(target:DesktopSurface,source:DesktopSurface):boolean {
 if(target.kind==='plugin')return source.kind==='main'||source.kind==='plugin'&&desktopSurfaceKey(target)===desktopSurfaceKey(source);
 const editable=target.kind==='thread'||target.kind==='artifact'||target.kind==='workspace'&&target.tab==='artifact';if(!editable)return false;
 if(source.kind==='main')return true;
 return 'threadId'in target&&'threadId'in source&&target.threadId===source.threadId&&(source.kind==='thread'||source.kind==='artifact'||source.kind==='workspace');
}
