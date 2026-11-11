import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {DesktopBrowserSlot} from '../../apps/web/src/DesktopBrowser';
import {nativeBrowserBounds} from '../../apps/desktop/browser-bounds';
import type {DesktopBridge,DesktopBounds,DesktopContext} from '../../packages/desktop-contract';
import {ActionMenu} from '../../packages/ui-shell/ActionMenu';
import {Select} from '../../packages/ui-shell/Select';

declare global {interface Window {geometryCalls:{bounds:DesktopBounds;native:DesktopBounds}[];geometryZoom:number}}
window.geometryCalls=[];window.geometryZoom=1;
const bridge={browser:async(command:{bounds:DesktopBounds})=>{window.geometryCalls.push({bounds:command.bounds,native:nativeBrowserBounds(command.bounds,[800*window.geometryZoom,600*window.geometryZoom],window.geometryZoom)});},onState:()=>()=>{},onCloseRequested:()=>()=>{}} as unknown as DesktopBridge;
const context={windowId:'geometry-fixture',surface:{kind:'main'},windows:[],dockedBrowser:{browserId:'owned-browser',state:{url:'about:blank',title:'Browser',canGoBack:false,canGoForward:false,loading:false}}} as DesktopContext;
function Controls(){
 const [open,setOpen]=useState(false),[value,setValue]=useState('current');
 return <div style={{position:'fixed',left:850,top:20}}><ActionMenu label="Browser tools" open={open} onOpenChange={setOpen} items={[{id:'refresh',label:'Refresh view',onSelect:()=>{}}]}/><Select aria-label="Browser view" value={value} onValueChange={setValue} options={[{value:'current',label:'Current view'},{value:'other',label:'Other view'}]}/></div>;
}
createRoot(document.getElementById('root')!).render(<DesktopProvider bridge={bridge} context={context}><Controls/><DesktopBrowserSlot/></DesktopProvider>);
