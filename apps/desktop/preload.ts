import {contextBridge,ipcRenderer} from 'electron';
import {DESKTOP_CHANNELS as channels,desktopId,parseDesktopSurface,type DesktopBridge,type DesktopState,type QuickAskOpen,type QuickAskRegistration} from '../../packages/desktop-contract/index.ts';
const quickAskContext=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const c=value as Record<string,unknown>;return Object.keys(c).length===5&&typeof c.currentThreadSendable==='boolean'&&[c.currentThreadId,c.currentThreadTitle,c.currentProjectId,c.currentProjectName].every(field=>field===null||typeof field==='string'&&field.length<=200);};
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
 setQuickAskConfig:config=>{if(!config||typeof config!=='object'||Array.isArray(config))return Promise.reject(Error('Invalid quick-ask config.'));const c=config as unknown as Record<string,unknown>;if(Object.keys(c).length!==2||typeof c.enabled!=='boolean'||typeof c.shortcut!=='string'||!c.shortcut.length||c.shortcut.length>80)return Promise.reject(Error('Invalid quick-ask config.'));return ipcRenderer.invoke(channels.quickAskConfig,{enabled:c.enabled,shortcut:c.shortcut});},
 setQuickAskContext:context=>{if(!quickAskContext(context))return Promise.reject(Error('Invalid quick-ask context.'));return ipcRenderer.invoke(channels.quickAskContext,context);},
 onQuickAskRegistration:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(typeof value==='string'&&['off','ready','in-use','invalid'].includes(value))listener(value as QuickAskRegistration);};ipcRenderer.on(channels.quickAskRegistration,receive);return()=>ipcRenderer.removeListener(channels.quickAskRegistration,receive);},
 quickAskHide:()=>ipcRenderer.invoke(channels.quickAskHide),
 quickAskResize:height=>{if(!Number.isSafeInteger(height)||height<72||height>280)return Promise.reject(Error('Invalid quick-ask height.'));return ipcRenderer.invoke(channels.quickAskResize,height);},
 quickAskSent:result=>{if(!result||typeof result!=='object'||Array.isArray(result))return Promise.reject(Error('Invalid quick-ask result.'));const r=result as Record<string,unknown>;if(Object.keys(r).length!==2||!desktopId(r.threadId)||!['new','current'].includes(String(r.target)))return Promise.reject(Error('Invalid quick-ask result.'));return ipcRenderer.invoke(channels.quickAskSent,{threadId:r.threadId,target:r.target});},
 onQuickAskOpen:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))return;const open=value as Record<string,unknown>;if(Object.keys(open).length===6&&['new','current'].includes(String(open.target))&&quickAskContext({currentThreadId:open.currentThreadId,currentThreadTitle:open.currentThreadTitle,currentThreadSendable:open.currentThreadSendable,currentProjectId:open.currentProjectId,currentProjectName:open.currentProjectName}))listener(value as QuickAskOpen);};ipcRenderer.on(channels.quickAskOpen,receive);return()=>ipcRenderer.removeListener(channels.quickAskOpen,receive);},
};
contextBridge.exposeInMainWorld('harnessDesktop',Object.freeze(bridge));

}
