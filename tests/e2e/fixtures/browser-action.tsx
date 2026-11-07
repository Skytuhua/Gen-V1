import {createRoot} from 'react-dom/client';
import {DesktopProvider} from '../../../apps/web/src/desktop-context';
import {DesktopBrowserDock,DesktopBrowserSurface,DesktopBrowserToolbar} from '../../../apps/web/src/DesktopBrowser';
import type {DesktopBridge,DesktopBrowserCommand,DesktopBrowserState,DesktopContext,DesktopState} from '../../../packages/desktop-contract';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/desktop.css';

type Action={command:DesktopBrowserCommand;resolve:()=>void;reject:(cause:unknown)=>void;settled:boolean};
const mode=new URLSearchParams(location.search).get('mode')??'docked';
const initial:DesktopBrowserState={url:'https://reading.example/one',title:'Synthetic reading page',canGoBack:false,canGoForward:false,loading:false};
let state:DesktopContext={windowId:'synthetic-browser-owner',surface:mode==='detached'?{kind:'browser',browserId:'synthetic-browser'}:{kind:'main'},windows:[],...(mode==='detached'?{browser:initial}:{dockedBrowser:{browserId:'synthetic-browser',state:initial}})};
const listeners=new Set<(state:DesktopState)=>void>(),actions:Action[]=[];
const fixture={
 actions,subscribed:false,
 page(patch:Partial<DesktopBrowserState>){
  state=mode==='detached'?{...state,browser:{...state.browser!,...patch}}:{...state,dockedBrowser:{...state.dockedBrowser!,state:{...state.dockedBrowser!.state,...patch}}};
  listeners.forEach(listener=>listener(state));
 },
 finish(index:number,result:'success'|'error'|'value',message='Synthetic bridge rejection'){
  const action=actions[index];if(!action||action.settled)throw Error('No pending synthetic action at this index');
  action.settled=true;if(result==='success')action.resolve();else action.reject(result==='error'?new Error(message):message);
 },
 get state(){return state;},
};
declare global {interface Window {browserActionFixture:typeof fixture}}
window.browserActionFixture=fixture;
// This local bridge never invokes IPC, a native host, or network navigation.
const bridge={
 browser:(command:DesktopBrowserCommand)=>command.type==='bounds'?Promise.resolve():new Promise<void>((resolve,reject)=>actions.push({command,resolve,reject,settled:false})),
 onState:(listener:(state:DesktopState)=>void)=>{listeners.add(listener);fixture.subscribed=true;return()=>{listeners.delete(listener);};},
 onCloseRequested:()=>()=>{},
} as unknown as DesktopBridge;
const content=mode==='detached'?<DesktopBrowserSurface/>:<DesktopBrowserDock/>;
createRoot(document.getElementById('root')!).render(<><p>Synthetic Browser fixture. No native content or live navigation.</p>{mode==='no-host'?<><DesktopBrowserToolbar/><DesktopBrowserDock/></>:<DesktopProvider bridge={bridge} context={state}><div style={{display:'flex',height:320}}>{content}</div></DesktopProvider>}</>);
