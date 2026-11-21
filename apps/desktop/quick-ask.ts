import type {BrowserWindow,Rectangle} from 'electron';
import {DESKTOP_CHANNELS as channels,type QuickAskConfig,type QuickAskContext,type QuickAskOpen,type QuickAskRegistration} from '../../packages/desktop-contract/index.ts';

export function quickAskContextValid(value:unknown):value is QuickAskContext {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const c=value as Record<string,unknown>;
 return Object.keys(c).length===5&&typeof c.currentThreadSendable==='boolean'
  &&[c.currentThreadId,c.currentThreadTitle,c.currentProjectId,c.currentProjectName].every(field=>field===null||typeof field==='string'&&field.length<=200);
}
export function quickAskConfigValid(value:unknown):value is QuickAskConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const c=value as Record<string,unknown>;
 return Object.keys(c).length===2&&typeof c.enabled==='boolean'&&typeof c.shortcut==='string'&&c.shortcut.length>=1&&c.shortcut.length<=80;
}
export const QUICK_ASK_HEIGHT={min:72,max:280} as const;
export function clampQuickAskHeight(value:unknown):number {
 if(!Number.isSafeInteger(value)||(value as number)<QUICK_ASK_HEIGHT.min||(value as number)>QUICK_ASK_HEIGHT.max)throw Error('Invalid quick-ask height.');
 return value as number;
}
/** 'current' only when the main window is focused and its thread can take the message. */
export function quickAskOpenTarget(context:QuickAskContext,focused:boolean):QuickAskOpen['target'] {
 return focused&&context.currentThreadSendable&&context.currentThreadId?'current':'new';
}

export interface QuickAskWindow {window:BrowserWindow;webContents:BrowserWindow['webContents']}
export interface QuickAskHostDeps {
 createWindow:()=>Promise<QuickAskWindow>;
 register:(accelerator:string,action:()=>void)=>boolean;
 unregister:(accelerator:string)=>void;
 /** Work area of the display under the cursor, for top-center placement. */
 cursorArea:()=>Rectangle;
 /** Push a channel payload to the quick-ask renderer (its own webContents). */
 sendToWindow:(channel:string,value:unknown)=>void;
 /** Push a channel payload to each live main-window renderer. */
 sendToMain:(channel:string,value:unknown)=>void;
 /** True when a main window currently holds OS focus. */
 mainFocused:()=>boolean;
}
export function createQuickAskHost(deps:QuickAskHostDeps) {
 let view:QuickAskWindow|undefined,accelerator='',context:QuickAskContext={currentThreadId:null,currentThreadTitle:null,currentThreadSendable:false,currentProjectId:null,currentProjectName:null},registration:QuickAskRegistration='off';
 const setRegistration=(next:QuickAskRegistration)=>{if(registration===next)return;registration=next;deps.sendToMain(channels.quickAskRegistration,next);};
 const alive=()=>Boolean(view&&!view.window.isDestroyed());
 const hide=()=>{if(!alive())return;view!.window.hide();setRegistration('ready');};
 const applyConfig=(config:QuickAskConfig)=>{
  if(accelerator){deps.unregister(accelerator);accelerator='';}
  if(!config.enabled){setRegistration('off');hide();return registration;}
  accelerator=config.shortcut;
  setRegistration(deps.register(accelerator,()=>void trigger())?'ready':'in-use');
  return registration;
 };
 const trigger=async()=>{
  if(alive()&&view!.window.isVisible()){hide();return;}
  if(!alive())view=await deps.createWindow();
  const area=deps.cursorArea(),width=640,height=QUICK_ASK_HEIGHT.min;
  view!.window.setBounds({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+Math.min(120,area.height*.12)),width,height});
  view!.window.show();view!.window.focus();
  setRegistration('in-use');
  deps.sendToWindow(channels.quickAskOpen,{...context,target:quickAskOpenTarget(context,deps.mainFocused())} satisfies QuickAskOpen);
 };
 return {
  applyConfig,
  setContext:(next:QuickAskContext)=>{context=next;},
  trigger,
  hide,
  resize:(height:number)=>{if(!alive())return;const bounds=view!.window.getBounds();view!.window.setBounds({...bounds,height:clampQuickAskHeight(height)});},
  sent:(result:{threadId:string;target:'new'|'current'})=>{deps.sendToMain(channels.quickAskSent,result);hide();},
  visible:()=>alive()&&view!.window.isVisible(),
  registration:()=>registration,
  destroy:()=>{if(accelerator){deps.unregister(accelerator);accelerator='';}if(alive())view!.window.destroy();view=undefined;},
 };
}
