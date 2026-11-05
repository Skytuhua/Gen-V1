import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {pluginSurfaceSchema,type PluginManifest,type PluginSurface,type PluginWorkspaceContribution} from '../../../packages/plugins/contracts';
import {parsePluginFrameRequest,pluginFrameReply,pluginFrameSource,pluginWindowOperation} from '../../../packages/plugins/frame-protocol';
import {authenticated,csrfToken,read} from './api';
import {DesktopWindowActions,useDesktop,useDesktopCloseGuard} from './desktop-context';
import './plugins.css';
import {desktopSurfaceKey} from '../../../packages/desktop-contract';

type PluginFrameProps={plugin:PluginManifest;theme:'light'|'dark';active?:boolean;surface?:PluginSurface;workspace?:PluginWorkspaceContribution;projectColors?:Record<string,string>;onReady?:()=>void};
export function PluginFrame(props:PluginFrameProps){const [generation,reload]=useState(0);return <PluginFrameBody key={`${props.surface?desktopSurfaceKey(props.surface):props.plugin.id}:${props.workspace?.id??'conversation'}:${generation}`} {...props} reload={()=>reload(value=>value+1)}/>;}
function PluginFrameBody({plugin,theme,active=true,surface,workspace,projectColors={},onReady,reload}:PluginFrameProps&{reload:()=>void}) {
  const desktop=useDesktop();
  const desktopCurrent=useRef(desktop),readyCurrent=useRef(onReady);desktopCurrent.current=desktop;readyCurrent.current=onReady;
  const presentationCurrent=useRef({active,projectColors});presentationCurrent.current={active,projectColors};
  const frame=useRef<HTMLIFrameElement>(null),[session]=useState(()=>crypto.randomUUID()),[initialTheme]=useState(theme),[error,setError]=useState('');
  const pending=useRef(new Map<string,AbortController>()),flushes=useRef(new Map<string,{resolve:()=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>());
  const pendingData=useRef(new Set<string>());
  // A WindowProxy and opaque origin survive navigation. A transferred port is
  // owned by one document, so no reply or saved-state acknowledgement can move
  // to its replacement, even before the replacement's load event.
  const bridge=useRef<MessagePort|null>(null),loaded=useRef(false),bootstrapped=useRef(false),revoked=useRef(false);
  const sendPresentation=()=>{const presentation=presentationCurrent.current,colors:Record<string,string>={};for(const[key,value]of Object.entries(presentation.projectColors)){try{const identity:unknown=JSON.parse(key);if(Array.isArray(identity)&&identity.length===4&&identity[0]==='plugin'&&identity[1]===plugin.id)colors[key]=value;}catch{/* A plug-in receives only its own opaque color preferences. */}}bridge.current?.postMessage({type:'gen.plugin.visibility',session,active:presentation.active&&document.visibilityState!=='hidden'});bridge.current?.postMessage({type:'gen.plugin.appearance',session,projectColors:colors});};
  const revoke=()=>{revoked.current=true;bridge.current?.close();bridge.current=null;for(const controller of pending.current.values())controller.abort();pending.current.clear();pendingData.current.clear();for(const item of flushes.current.values()){clearTimeout(item.timer);item.reject();}flushes.current.clear();};
  const unavailable=()=>{revoke();setError('This plug-in view changed unexpectedly. Reload the plug-in to reconnect. Saved work is retained.');};
  const focused=useRef<{target:PluginSurface;id:string}|null>(null),focusSurface=desktop?.state.focusSurface;
  if(!surface&&focusSurface?.kind==='plugin'&&focusSurface.pluginId===plugin.id){if(focused.current?.target!==focusSurface)focused.current={target:focusSurface,id:crypto.randomUUID()};}else focused.current=null;
  const sendFocusedSurface=()=>{const focus=focused.current;if(focus)bridge.current?.postMessage({type:'gen.plugin.focus-surface',session,id:focus.id,surface:focus.target});};
  const flush=async()=>{
    if(!bridge.current||revoked.current)throw Error('The plug-in could not confirm saved state.');
    await new Promise<void>((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{flushes.current.delete(id);reject(Error('The plug-in could not confirm saved state. Keep this window open.'));},20000);flushes.current.set(id,{resolve,reject:()=>reject(Error('The plug-in has unsaved work.')),timer});bridge.current!.postMessage({type:'gen.plugin.flush',session,id});});
    if(pendingData.current.size)throw Error('Wait for the plug-in request to finish before closing.');
  };
  useDesktopCloseGuard(`plugin:${plugin.id}:${workspace?.id??'conversation'}`,flush);
  useEffect(()=>{bridge.current?.postMessage({type:'gen.plugin.theme',session,theme});},[theme,session]);
  useEffect(()=>{sendPresentation();const changed=()=>sendPresentation();document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[active,projectColors,session]);
  useEffect(()=>{bridge.current?.postMessage({type:'gen.plugin.state-changed',session});},[desktop?.state.windows,session]);
  useEffect(()=>{sendFocusedSurface();},[focusSurface,plugin.id,session]);
  useLayoutEffect(()=>{
    let alive=true;
    // React may replay an initial effect before the child can execute. That
    // replay must not disable the first connection; a document that has ever
    // connected or loaded can only recover through a fresh parent remount.
    if(!loaded.current&&!bootstrapped.current)revoked.current=false;
    const changed=(event:MessageEvent,port:MessagePort)=>{
      if(!alive||revoked.current||bridge.current!==port)return;
      const value=event.data;
      if(value?.type==='gen.plugin.disconnected'&&value.session===session){unavailable();return;}
      if(value?.type==='gen.plugin.ready'&&value.pluginId===plugin.id&&value.session===session){readyCurrent.current?.();sendFocusedSurface();sendPresentation();return;}
      if(value?.type==='gen.plugin.saves-retried'&&value.session===session){setError(value.ok===true?'':'Draft saving is still unavailable. Keep this view open.');return;}
      if(value?.type==='gen.plugin.flushed'&&value.session===session){const item=flushes.current.get(value.id);if(item){flushes.current.delete(value.id);clearTimeout(item.timer);if(value.ok===true)item.resolve();else item.reject();}return;}
      if(value?.type==='gen.plugin.abort'&&value.session===session&&value.pluginId===plugin.id){pending.current.get(value.id)?.abort();return;}
      const request=parsePluginFrameRequest(value,plugin.id,session);if(!request||pending.current.has(request.id)||pending.current.size>=64)return;
      const controller=new AbortController();pending.current.set(request.id,controller);
      if(!pluginWindowOperation(request.operation))pendingData.current.add(request.id);
      const execute=async()=>{
        const desktop=desktopCurrent.current;
        if(request.operation==='window.capabilities')return {available:false,reason:'Opening detached views is currently unavailable.'};
        if(request.operation==='window.list')return desktop?.state.windows.filter(item=>item.surface.kind==='plugin'&&item.surface.pluginId===plugin.id)??[];
        if(request.operation==='window.detach'){
          const target=pluginSurfaceSchema.parse(request.input);if(target.pluginId!==plugin.id||!desktop)throw Error('This plug-in window is unavailable.');
          return desktop.detachSurface(target);
        }
        if(request.operation==='window.reattach'){
          if(!desktop||desktop.context.surface.kind!=='plugin'||desktop.context.surface.pluginId!==plugin.id)throw Error('Only the owning plug-in window can return.');
          await desktop.bridge.reattach();return null;
        }
        return authenticated(()=>fetch(`/api/plugins/${plugin.id}/rpc`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({operation:request.operation,input:request.input})})).then(read<unknown>);
      };
      void execute().then(result=>{if(alive&&!controller.signal.aborted&&bridge.current===port)port.postMessage(pluginFrameReply(request.id,result));}).catch(cause=>{if(alive&&!controller.signal.aborted&&bridge.current===port){setError('A plug-in request could not complete. Your saved work is retained.');port.postMessage(pluginFrameReply(request.id,null,cause));}}).finally(()=>{pending.current.delete(request.id);pendingData.current.delete(request.id);});
    };
    const connect=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!=='null')return;
      const value=event.data;
      // The trusted bootstrap transfers its document's port before its initial
      // load. Never send a port/session through a surviving WindowProxy, nor
      // accept a second bootstrap, a post-load bootstrap or legacy global RPC.
      if(value?.type!=='gen.plugin.connect'||value.pluginId!==plugin.id||value.session!==session||event.ports.length!==1)return;
      const port=event.ports[0];
      if(bootstrapped.current||loaded.current||revoked.current){port.close();return;}
      bootstrapped.current=true;bridge.current=port;port.onmessage=event=>changed(event,port);port.onmessageerror=unavailable;port.start();
      port.postMessage({type:'gen.plugin.connected',session});
      sendPresentation();
    };
    addEventListener('message',connect);
    return()=>{alive=false;removeEventListener('message',connect);revoke();};
  },[plugin.id,session]);
  return <section className="plugin-workspace" aria-label={workspace?.title??plugin.name} hidden={!active}>{!surface&&!workspace&&<header className="workspace-header plugin-native-header"><strong>{plugin.name}</strong><DesktopWindowActions/></header>}{error&&<p className="notice" role="alert">{error}{revoked.current?<button className="quiet" onClick={reload}>Reload plug-in</button>:<><button className="quiet" onClick={()=>bridge.current?.postMessage({type:'gen.plugin.retry-saves',session})}>Retry saving drafts</button><button className="quiet" onClick={()=>setError('')}>Dismiss</button></>}</p>}<iframe ref={frame} title={workspace?.title??plugin.name} src={pluginFrameSource(plugin.id,session,initialTheme,surface,workspace)} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={()=>{if(loaded.current||!bridge.current||revoked.current){unavailable();return;}loaded.current=true;bridge.current.postMessage({type:'gen.plugin.theme',session,theme});}}/></section>;
}
export function usePluginCatalog(enabled=true){const [catalog,setCatalog]=useState<{plugins:PluginManifest[];theme?:string;error?:string}>({plugins:[]});useEffect(()=>{if(!enabled)return;let active=true;void authenticated(()=>fetch('/api/plugins',{credentials:'same-origin',cache:'no-store'})).then(read<{plugins:PluginManifest[];theme?:string;error?:string}>).then(value=>{if(active&&Array.isArray(value.plugins))setCatalog(value);}).catch(()=>{});return()=>{active=false;};},[enabled]);return catalog;}
export function useInstalledPlugins(){return usePluginCatalog().plugins;}
