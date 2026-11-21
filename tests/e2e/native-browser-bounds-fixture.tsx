import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {DesktopBrowserDock,DesktopBrowserSlot} from '../../apps/web/src/DesktopBrowser';
import {nativeBrowserBounds,nativeBrowserPreviewBounds} from '../../apps/desktop/browser-bounds';
import type {DesktopBounds,DesktopBrowserBoundsResult,DesktopBrowserCommand,DesktopBridge,DesktopContext,DesktopState} from '../../packages/desktop-contract';
import {ActionMenu} from '../../packages/ui-shell/ActionMenu';
import {Select} from '../../packages/ui-shell/Select';

declare global {interface Window {geometryCalls:{bounds:DesktopBounds;native:DesktopBounds;preset?:unknown;result?:DesktopBrowserBoundsResult}[];geometryZoom:number;previewZoom:number;previewOwner:[number,number];previewDelayMs:number;previewFail:boolean;geometryBrowser:(id:string)=>void}}
window.geometryCalls=[];window.geometryZoom=1;window.previewZoom=1;window.previewOwner=[2400,1600];window.previewDelayMs=0;window.previewFail=false;
let browserId='owned-browser',stateListener:((state:DesktopState)=>void)|undefined;
const contextFor=(id:string)=>{const context={windowId:'geometry-fixture',surface:{kind:'main'},windows:[],dockedBrowser:{browserId:id,state:{url:'about:blank',title:'Browser',canGoBack:false,canGoForward:false,loading:false}}} as DesktopContext;return context;};
window.geometryBrowser=id=>{browserId=id;stateListener?.(contextFor(id) as unknown as DesktopState);};
const bridge={browser:async(command:DesktopBrowserCommand)=>{
 if(command.type==='bounds'){
  if(command.widthPreset!==undefined){
   if(window.previewDelayMs)await new Promise(resolve=>setTimeout(resolve,window.previewDelayMs));
   if(window.previewFail)throw Error('synthetic preview failure');
   const zoom=window.geometryZoom,preview=nativeBrowserPreviewBounds(command.bounds,[Math.round(window.previewOwner[0]*zoom),Math.round(window.previewOwner[1]*zoom)],zoom,window.previewZoom,command.widthPreset);
   const result:DesktopBrowserBoundsResult={kind:'bounds',requested:command.widthPreset,effective:preview.effective,bounds:{x:preview.x/zoom,y:preview.y/zoom,width:preview.width/zoom,height:preview.height/zoom},actualWidth:preview.actualWidth,availableWidth:preview.availableWidth,availability:preview.availability,hidden:preview.hidden,...(preview.fallback?{fallback:preview.fallback}:{})};
   window.geometryCalls.push({bounds:command.bounds,native:{x:preview.x,y:preview.y,width:preview.width,height:preview.height},preset:command.widthPreset,result});return result;
  }
  window.geometryCalls.push({bounds:command.bounds,native:nativeBrowserBounds(command.bounds,[800*window.geometryZoom,600*window.geometryZoom],window.geometryZoom)});
 }},onState:(listener:(state:DesktopState)=>void)=>{stateListener=listener;return()=>{stateListener=undefined;};},onCloseRequested:()=>()=>{}} as unknown as DesktopBridge;
function Controls(){
 const [open,setOpen]=useState(false),[value,setValue]=useState('current');
 return <div style={{position:'fixed',left:850,top:20}}><ActionMenu label="Browser tools" open={open} onOpenChange={setOpen} items={[{id:'refresh',label:'Refresh view',onSelect:()=>{}}]}/><Select aria-label="Browser view" value={value} onValueChange={setValue} options={[{value:'current',label:'Current view'},{value:'other',label:'Other view'}]}/></div>;
}
const presetMode=new URLSearchParams(window.location.search).has('presets');
createRoot(document.getElementById('root')!).render(<DesktopProvider bridge={bridge} context={contextFor(browserId)}>{presetMode?<DesktopBrowserDock/>:<><Controls/><DesktopBrowserSlot/></>}</DesktopProvider>);
