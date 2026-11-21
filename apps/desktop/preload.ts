import {contextBridge,ipcRenderer} from 'electron';
import {DESKTOP_CHANNELS as channels,parseDesktopSurface,type DesktopBridge,type DesktopState} from '../../packages/desktop-contract/index.ts';
if(process.argv.includes('--gen-attention-popup')){
 contextBridge.exposeInMainWorld('harnessAttention',Object.freeze({
  action:(type:unknown,eventId:unknown)=>{if(!['open','dismiss','pause','resume'].includes(String(type))||typeof eventId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,999}$/.test(eventId))return;void ipcRenderer.invoke(channels.attentionPopupAction,{type,eventId}).catch(()=>{});},
  onCards:(listener:(value:unknown)=>void)=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>listener(value);ipcRenderer.on(channels.attentionPopupCards,receive);return()=>ipcRenderer.removeListener(channels.attentionPopupCards,receive);},
 }));
}else{
const closeHandlers=new Set<()=>Promise<boolean>>();
ipcRenderer.on(channels.closeRequest,(_event,requestId:unknown)=>{
 if(typeof requestId!=='string'||requestId.length>100)return;
 void Promise.all([...closeHandlers].map(handler=>Promise.resolve().then(handler).catch(()=>false))).then(results=>ipcRenderer.invoke(channels.closeAnswer,{requestId,allow:results.every(Boolean)})).catch(()=>{});
});
const bridge:DesktopBridge={
 exportProjectMemory:serializedExport=>ipcRenderer.invoke(channels.memoryExport,serializedExport),
 openAttention:eventId=>ipcRenderer.invoke(channels.attentionOpen,eventId),
 onAttentionOpen:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(value&&typeof value==='object'&&Object.keys(value).length===1&&typeof(value as {threadId?:unknown}).threadId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test((value as {threadId:string}).threadId))listener((value as {threadId:string}).threadId);};ipcRenderer.on(channels.attentionSelected,receive);return()=>ipcRenderer.removeListener(channels.attentionSelected,receive);},
 setTheme:theme=>ipcRenderer.invoke(channels.theme,theme),
 update:action=>ipcRenderer.invoke(channels.update,action),
 getContext:()=>ipcRenderer.invoke(channels.context),ready:()=>ipcRenderer.invoke(channels.ready),detach:surface=>ipcRenderer.invoke(channels.detach,parseDesktopSurface(surface)),reattach:()=>ipcRenderer.invoke(channels.reattach),minimize:()=>ipcRenderer.invoke(channels.minimize),resetBounds:()=>ipcRenderer.invoke(channels.reset),focus:id=>ipcRenderer.invoke(channels.focus,id),list:()=>ipcRenderer.invoke(channels.list),browser:command=>ipcRenderer.invoke(channels.browser,command),
 control:command=>ipcRenderer.invoke(channels.control,command),captureLayout:()=>ipcRenderer.invoke(channels.captureLayout),applyLayout:layout=>ipcRenderer.invoke(channels.applyLayout,layout),
 signIn:(provider,accountId)=>ipcRenderer.invoke(channels.signIn,...(accountId!==undefined?[{provider,accountId}]:[provider])),
 activeSignIn:()=>ipcRenderer.invoke(channels.activeSignIn),signInStatus:flowId=>ipcRenderer.invoke(channels.signInStatus,flowId),cancelSignIn:flowId=>ipcRenderer.invoke(channels.cancelSignIn,flowId),
 onState:listener=>{const receive=(_event:Electron.IpcRendererEvent,state:DesktopState)=>listener(state);ipcRenderer.on(channels.state,receive);return()=>ipcRenderer.removeListener(channels.state,receive);},
 onCloseRequested:handler=>{closeHandlers.add(handler);return()=>closeHandlers.delete(handler);},
 onWorkspaceChanged:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(!value||typeof value!=='object')return;const change=value as Record<string,unknown>;if(Object.keys(change).length===2&&typeof change.connected==='boolean'&&Number.isSafeInteger(change.sequence)&&Number(change.sequence)>=0)listener({connected:change.connected,sequence:Number(change.sequence)});};ipcRenderer.on(channels.workspaceChanged,receive);return()=>ipcRenderer.removeListener(channels.workspaceChanged,receive);},
 onOpenProjectRequest:listener=>{const seen=new Set<string>();const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))return;const envelope=value as Record<string,unknown>;if(Object.keys(envelope).length!==2||typeof envelope.requestId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(envelope.requestId)||typeof envelope.path!=='string'||envelope.path.length<1||envelope.path.length>4096)return;const requestId=envelope.requestId;if(seen.has(requestId))return;if(seen.size>=16)seen.delete(seen.values().next().value!);seen.add(requestId);const path=envelope.path;void Promise.resolve().then(()=>listener(path)).catch(()=>{}).finally(()=>{void ipcRenderer.invoke(channels.openProjectAck,{requestId}).catch(()=>{});});};ipcRenderer.on(channels.openProject,receive);void ipcRenderer.invoke(channels.openProjectReady,{}).catch(()=>{});return()=>{ipcRenderer.removeListener(channels.openProject,receive);void ipcRenderer.invoke(channels.openProjectNotReady,{}).catch(()=>{});};},
};
contextBridge.exposeInMainWorld('harnessDesktop',Object.freeze(bridge));

}
