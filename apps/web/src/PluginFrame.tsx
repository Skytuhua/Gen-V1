import {useEffect,useRef,useState} from 'react';
import {pluginSurfaceSchema,type PluginManifest,type PluginSurface} from '../../../packages/plugins/contracts';
import {parsePluginFrameRequest,pluginFrameReply,pluginFrameSource,pluginWindowOperation} from '../../../packages/plugins/frame-protocol';
import {authenticated,csrfToken,read} from './api';
import {DesktopWindowActions,useDesktop,useDesktopCloseGuard} from './desktop-context';
import './plugins.css';
import {desktopSurfaceKey} from '../../../packages/desktop-contract';

type PluginFrameProps={plugin:PluginManifest;theme:'light'|'dark';active?:boolean;surface?:PluginSurface;onReady?:()=>void};
export function PluginFrame(props:PluginFrameProps){return <PluginFrameBody key={props.surface?desktopSurfaceKey(props.surface):props.plugin.id} {...props}/>;}
function PluginFrameBody({plugin,theme,active=true,surface,onReady}:PluginFrameProps) {
  const desktop=useDesktop();
  const desktopCurrent=useRef(desktop),readyCurrent=useRef(onReady);desktopCurrent.current=desktop;readyCurrent.current=onReady;
  const frame=useRef<HTMLIFrameElement>(null),[session]=useState(()=>crypto.randomUUID()),[initialTheme]=useState(theme),[error,setError]=useState('');
  const pending=useRef(new Map<string,AbortController>()),flushes=useRef(new Map<string,{resolve:()=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>());
  const pendingData=useRef(new Set<string>());
  const focused=useRef<{target:PluginSurface;id:string}|null>(null),focusSurface=desktop?.state.focusSurface;
  if(!surface&&focusSurface?.kind==='plugin'&&focusSurface.pluginId===plugin.id){if(focused.current?.target!==focusSurface)focused.current={target:focusSurface,id:crypto.randomUUID()};}else focused.current=null;
  const sendFocusedSurface=()=>{const focus=focused.current;if(focus)frame.current?.contentWindow?.postMessage({type:'gen.plugin.focus-surface',session,id:focus.id,surface:focus.target},'*');};
  const flush=async()=>{
    if(!frame.current?.contentWindow)throw Error('The plug-in could not confirm saved state.');
    await new Promise<void>((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{flushes.current.delete(id);reject(Error('The plug-in could not confirm saved state. Keep this window open.'));},20000);flushes.current.set(id,{resolve,reject:()=>reject(Error('The plug-in has unsaved work.')),timer});frame.current!.contentWindow!.postMessage({type:'gen.plugin.flush',session,id},'*');});
    if(pendingData.current.size)throw Error('Wait for the plug-in request to finish before closing.');
  };
  useDesktopCloseGuard(`plugin:${plugin.id}`,flush);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'gen.plugin.theme',session,theme},'*');},[theme,session]);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'gen.plugin.state-changed',session},'*');},[desktop?.state.windows,session]);
  useEffect(()=>{sendFocusedSurface();},[focusSurface,plugin.id,session]);
  useEffect(()=>{
    let alive=true;
    const changed=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!=='null')return;
      const value=event.data;
      if(value?.type==='gen.plugin.ready'&&value.pluginId===plugin.id&&value.session===session){readyCurrent.current?.();sendFocusedSurface();return;}
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
      void execute().then(result=>{if(alive)frame.current?.contentWindow?.postMessage(pluginFrameReply(request.id,result),'*');}).catch(cause=>{if(alive){setError('A plug-in request could not complete. Your saved work is retained.');frame.current?.contentWindow?.postMessage(pluginFrameReply(request.id,null,cause),'*');}}).finally(()=>{pending.current.delete(request.id);pendingData.current.delete(request.id);});
    };
    addEventListener('message',changed);
    return()=>{alive=false;removeEventListener('message',changed);for(const controller of pending.current.values())controller.abort();for(const item of flushes.current.values()){clearTimeout(item.timer);item.reject();}flushes.current.clear();};
  },[plugin.id,session]);
  return <section className="plugin-workspace" aria-label={plugin.name} hidden={!active}>{!surface&&<header className="workspace-header plugin-native-header"><strong>{plugin.name}</strong><DesktopWindowActions/></header>}{error&&<p className="notice" role="alert">{error}<button className="quiet" onClick={()=>frame.current?.contentWindow?.postMessage({type:'gen.plugin.retry-saves',session},'*')}>Retry saving drafts</button><button className="quiet" onClick={()=>setError('')}>Dismiss</button></p>}<iframe ref={frame} title={plugin.name} src={pluginFrameSource(plugin.id,session,initialTheme,surface)} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={()=>frame.current?.contentWindow?.postMessage({type:'gen.plugin.theme',session,theme},'*')}/></section>;
}
export function usePluginCatalog(){const [catalog,setCatalog]=useState<{plugins:PluginManifest[];theme?:string;error?:string}>({plugins:[]});useEffect(()=>{let active=true;void authenticated(()=>fetch('/api/plugins',{credentials:'same-origin',cache:'no-store'})).then(read<{plugins:PluginManifest[];theme?:string;error?:string}>).then(value=>{if(active&&Array.isArray(value.plugins))setCatalog(value);}).catch(()=>{});return()=>{active=false;};},[]);return catalog;}
export function useInstalledPlugins(){return usePluginCatalog().plugins;}
