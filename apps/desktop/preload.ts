import {contextBridge,ipcRenderer} from 'electron';
import {DESKTOP_CHANNELS as channels,parseDesktopSurface,type DesktopBridge,type DesktopState} from '../../packages/desktop-contract/index.ts';
const closeHandlers=new Set<()=>Promise<boolean>>();
ipcRenderer.on(channels.closeRequest,(_event,requestId:unknown)=>{
 if(typeof requestId!=='string'||requestId.length>100)return;
 void Promise.all([...closeHandlers].map(handler=>Promise.resolve().then(handler).catch(()=>false))).then(results=>ipcRenderer.invoke(channels.closeAnswer,{requestId,allow:results.every(Boolean)})).catch(()=>{});
});
const bridge:DesktopBridge={
 setTheme:theme=>ipcRenderer.invoke(channels.theme,theme),
 update:action=>ipcRenderer.invoke(channels.update,action),
 getContext:()=>ipcRenderer.invoke(channels.context),ready:()=>ipcRenderer.invoke(channels.ready),detach:surface=>ipcRenderer.invoke(channels.detach,parseDesktopSurface(surface)),reattach:()=>ipcRenderer.invoke(channels.reattach),minimize:()=>ipcRenderer.invoke(channels.minimize),resetBounds:()=>ipcRenderer.invoke(channels.reset),focus:id=>ipcRenderer.invoke(channels.focus,id),list:()=>ipcRenderer.invoke(channels.list),browser:command=>ipcRenderer.invoke(channels.browser,command),
 control:command=>ipcRenderer.invoke(channels.control,command),captureLayout:()=>ipcRenderer.invoke(channels.captureLayout),applyLayout:layout=>ipcRenderer.invoke(channels.applyLayout,layout),
 signIn:(provider,accountId)=>ipcRenderer.invoke(channels.signIn,...(accountId!==undefined?[{provider,accountId}]:[provider])),
 signInStatus:flowId=>ipcRenderer.invoke(channels.signInStatus,flowId),cancelSignIn:flowId=>ipcRenderer.invoke(channels.cancelSignIn,flowId),
 onState:listener=>{const receive=(_event:Electron.IpcRendererEvent,state:DesktopState)=>listener(state);ipcRenderer.on(channels.state,receive);return()=>ipcRenderer.removeListener(channels.state,receive);},
 onCloseRequested:handler=>{closeHandlers.add(handler);return()=>closeHandlers.delete(handler);},
 onWorkspaceChanged:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(!value||typeof value!=='object')return;const change=value as Record<string,unknown>;if(Object.keys(change).length===2&&typeof change.connected==='boolean'&&Number.isSafeInteger(change.sequence)&&Number(change.sequence)>=0)listener({connected:change.connected,sequence:Number(change.sequence)});};ipcRenderer.on(channels.workspaceChanged,receive);return()=>ipcRenderer.removeListener(channels.workspaceChanged,receive);},
};
contextBridge.exposeInMainWorld('harnessDesktop',Object.freeze(bridge));
