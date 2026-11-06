import {createRoot} from 'react-dom/client';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {DesktopBrowserSlot} from '../../apps/web/src/DesktopBrowser';
import {nativeBrowserBounds} from '../../apps/desktop/browser-bounds';
import type {DesktopBridge,DesktopBounds,DesktopContext} from '../../packages/desktop-contract';

declare global {interface Window {geometryCalls:{bounds:DesktopBounds;native:DesktopBounds}[];geometryZoom:number}}
window.geometryCalls=[];window.geometryZoom=1;
const bridge={browser:async(command:{bounds:DesktopBounds})=>{window.geometryCalls.push({bounds:command.bounds,native:nativeBrowserBounds(command.bounds,[800*window.geometryZoom,600*window.geometryZoom],window.geometryZoom)});},onState:()=>()=>{},onCloseRequested:()=>()=>{}} as unknown as DesktopBridge;
const context={windowId:'geometry-fixture',surface:{kind:'main'},windows:[],dockedBrowser:{browserId:'owned-browser',state:{url:'about:blank',title:'Browser',canGoBack:false,canGoForward:false,loading:false}}} as DesktopContext;
createRoot(document.getElementById('root')!).render(<DesktopProvider bridge={bridge} context={context}><DesktopBrowserSlot/></DesktopProvider>);
