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
const QUICK_ASK_MODIFIERS:Record<string,string>={ctrl:'CommandOrControl',alt:'Alt',shift:'Shift',meta:'Super'};
const QUICK_ASK_KEYS:Record<string,string>={space:'Space',comma:',',period:'.',slash:'/',arrowup:'Up',arrowdown:'Down',arrowleft:'Left',arrowright:'Right','+':'Plus',minus:'-',equal:'='};
/** Maps a canonical preference chord (e.g. 'Alt+Space', 'Ctrl+Shift+K') to an Electron accelerator, or null when R04 forbids it. */
export function toElectronAccelerator(chord:string):string|null {
 const binding=chord.toLowerCase().trim(),plus=binding==='+'||binding.endsWith('++');
 const parts=(plus?binding.slice(0,-1):binding).split('+').map(part=>part.trim()).filter(Boolean);
 const modifiers=parts.slice(0,-1),key=plus?'+':parts.at(-1)??'';
 if(!key||modifiers.some(modifier=>!(modifier in QUICK_ASK_MODIFIERS)))return null;
 let keyName=QUICK_ASK_KEYS[key];
 if(!keyName){if(/^[a-z]$/.test(key)||/^\d$/.test(key)||/^f([1-9]|1\d|2[0-4])$/.test(key))keyName=key.toUpperCase();else return null;}
 const isFunction=/^F(\d+)$/.test(keyName);
 if(!isFunction&&!modifiers.some(modifier=>modifier==='ctrl'||modifier==='alt'||modifier==='meta'))return null;
 return [...modifiers.map(modifier=>QUICK_ASK_MODIFIERS[modifier]),keyName].join('+');
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
 /** Show+focus a main window after a quick-ask send selects its thread. */
 focusMain:()=>void;
}
export function createQuickAskHost(deps:QuickAskHostDeps) {
 let view:QuickAskWindow|undefined,accelerator='',context:QuickAskContext={currentThreadId:null,currentThreadTitle:null,currentThreadSendable:false,currentProjectId:null,currentProjectName:null},registration:QuickAskRegistration='off';
 const setRegistration=(next:QuickAskRegistration)=>{if(registration===next)return;registration=next;deps.sendToMain(channels.quickAskRegistration,next);};
 const alive=()=>Boolean(view&&!view.window.isDestroyed());
 const hide=()=>{if(!alive())return;view!.window.hide();setRegistration('ready');};
 const applyConfig=(config:QuickAskConfig)=>{
  if(accelerator){deps.unregister(accelerator);accelerator='';}
  if(!config.enabled){setRegistration('off');hide();return registration;}
  const resolved=toElectronAccelerator(config.shortcut);
  if(!resolved){setRegistration('invalid');hide();return registration;}
  accelerator=resolved;
  setRegistration(deps.register(accelerator,()=>void trigger())?'ready':'in-use');
  return registration;
 };
 const trigger=async()=>{
  if(alive()&&view!.window.isVisible()){hide();return;}
  if(!alive())view=await deps.createWindow();
  const area=deps.cursorArea(),width=Math.min(640,Math.max(72,area.width-32)),height=QUICK_ASK_HEIGHT.min;
  view!.window.setBounds({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+area.height*.22),width,height});
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
  sent:(result:{threadId:string;target:'new'|'current'})=>{deps.sendToMain(channels.quickAskSent,result);deps.focusMain();hide();},
  visible:()=>alive()&&view!.window.isVisible(),
  registration:()=>registration,
  destroy:()=>{if(accelerator){deps.unregister(accelerator);accelerator='';}if(alive())view!.window.destroy();view=undefined;},
 };
}
