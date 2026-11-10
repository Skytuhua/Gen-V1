// Exercise the public isolated runtime and the real Personal Visuals renderer,
// with the separate tool root used by installed plug-in consumers.
export const pluginToolsDockEntry=`
import * as runtime from './apps/web/src/plugin-runtime';
globalThis.GenPluginUI=runtime;
void import('./plugins/personal-visuals/src/frontend').then(()=>{
 const mount=document.createElement('div');document.body.append(mount);
 function Tools(){const [open,setOpen]=runtime.React.useState(true);globalThis.setToolsOpen=setOpen;return runtime.React.createElement(runtime.FloatingWindow,{open,id:'plugin-tools-test',title:'Plugin tools',defaultSize:{width:300,height:180},focusOnOpen:false,onClose:()=>setOpen(false)},runtime.React.createElement('label',null,'Tool draft',runtime.React.createElement('input',{defaultValue:'Keep my draft'})));}
 runtime.ReactDOMClient.createRoot(mount).render(runtime.React.createElement(Tools));
});`;

export const pluginToolsParent=`<!doctype html><html><body style="margin:0"><script>
window.calls=[];window.saved=null;window.failReads=false;window.failWrites=false;
addEventListener('message',event=>{
 if(event.data?.type!=='gen.plugin.connect')return;
 const port=event.ports[0],session=event.data.session;window.bridge=port;
 port.onmessage=({data})=>{
  if(data.type!=='gen.plugin.request')return;
  window.calls.push(data);
  const value=data.operation==='state.read'?window.saved:data.operation==='visual.document.read'?{documentId:'main',revision:0,document:null,draft:null}:null;
  const ok=!(data.operation==='state.read'&&window.failReads||data.operation==='state.write'&&window.failWrites);
  if(ok&&data.operation==='state.write')window.saved=data.input.value;
  port.postMessage({type:'gen.plugin.reply',id:data.id,ok,value});
 };
 port.start();port.postMessage({type:'gen.plugin.connected',session});
});
</script><iframe title="Personal Visuals" sandbox="allow-scripts" style="display:block;width:100vw;height:100dvh;border:0" src="/plugin?session=dock-test&theme=dark"></iframe></body></html>`;
