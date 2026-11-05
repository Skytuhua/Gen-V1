import type {PanelPlacement,WorkspacePanelKind} from '../../../packages/contracts/workspace.ts';
import {desktopSurfaceKey,type DesktopSurface,type DesktopWindowInfo,type DesktopBridge} from '../../../packages/desktop-contract/index.ts';
export function panelDesktopSurface(panel:PanelPlacement):DesktopSurface {
 const b=panel.binding;if(b.authority.kind==='plugin')return {kind:'plugin',pluginId:b.authority.pluginId,scopeId:b.authority.scopeId,surfaceId:panel.kind,resourceId:b.resourceId??panel.id};
 if(panel.kind==='thread'&&b.threadId)return {kind:'thread',threadId:b.threadId};
 if(panel.kind==='agent'&&b.threadId&&b.agentId)return {kind:'agent',threadId:b.threadId,agentId:b.agentId};
 if(panel.kind==='artifact'&&b.threadId&&b.artifactId)return {kind:'artifact',threadId:b.threadId,artifactId:b.artifactId};
 if((panel.kind==='context'||panel.kind==='plan')&&b.threadId)return {kind:'plan',threadId:b.threadId};
 if(panel.kind==='usage'&&b.threadId)return {kind:'usage',threadId:b.threadId};
 if(panel.kind==='navigation')return {kind:'navigation',...(b.threadId?{threadId:b.threadId}:{})};
 if(panel.kind==='browser'&&b.browserId)return {kind:'browser',browserId:b.browserId};
 const tab=['files','diff','output','usage','notes','context','terminal','pull-request','linked-pull-requests'].includes(panel.kind)?panel.kind as 'files'|'diff'|'output'|'usage'|'notes'|'context'|'terminal'|'pull-request'|'linked-pull-requests':'launcher';
 return {kind:'workspace',panelId:panel.id,tab,...(b.threadId?{threadId:b.threadId}:{})};
}
export function desktopSurfaceKind(surface:DesktopSurface):WorkspacePanelKind {if(surface.kind==='plugin')return 'workspace';return surface.kind==='main'?'workspace':surface.kind==='workspace'&&surface.tab&&surface.tab!=='launcher'?surface.tab:surface.kind;}
/** Correlate placement with the existing native editor identity; origin panels never become extra editors. */
export function panelsForDesktopSurface(panels:PanelPlacement[],surface:DesktopSurface):PanelPlacement[]{
 const key=desktopSurfaceKey(surface);
 return panels.filter(panel=>(panel.binding.authority.kind==='plugin'?surface.kind==='plugin'&&desktopSurfaceKey(panelDesktopSurface(panel))===key:surface.kind==='workspace'&&surface.panelId===panel.id||desktopSurfaceKey(panelDesktopSurface(panel))===key));
}
export function panelNativeWindow(panel:PanelPlacement,windows:DesktopWindowInfo[]):DesktopWindowInfo|undefined{return windows.find(info=>panelsForDesktopSurface([panel],info.surface).length>0);}
/** Native custody survives a failed layout write. Never close or replay the
 * editor merely to make placement metadata look atomic. */
export async function detachPanelToNative(panel:PanelPlacement,detach:(surface:DesktopSurface)=>Promise<DesktopWindowInfo>,update:(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>Promise<void>):Promise<DesktopWindowInfo>{
 const native=await detach(panelDesktopSurface(panel));
 try{await update(panel,{placement:'native',binding:panel.binding});}
 catch{throw Error('The window opened, but its panel placement could not be saved. Focus the open window or retry Detach to save its placement.');}
 return native;
}
export async function setPanelVisibility(panel:PanelPlacement,visible:boolean,update:(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>Promise<void>,desktop?:{bridge:DesktopBridge;windows:DesktopWindowInfo[]}|null):Promise<void>{
 if(panel.placement!=='native'){await update(panel,{visible});return;}
 const native=desktop&&panelNativeWindow(panel,desktop.windows),control=desktop?.bridge.control;
 if(!native||!control)throw Error('The owning native window is unavailable. Restore or dock it before changing this panel.');
 const before=native.visible!==false;
 try{await control({type:'visibility',windowId:native.id,visible});await update(panel,{visible});}
 catch(cause){try{await control({type:'visibility',windowId:native.id,visible:before});}catch(rollback){throw Error(`${cause instanceof Error?cause.message:String(cause)} Native visibility rollback also failed: ${rollback instanceof Error?rollback.message:String(rollback)}`);}throw cause;}
}
