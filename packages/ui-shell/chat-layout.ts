export type ChatMode='full'|'drawer'|'popup';
export interface ChatRect {x:number;y:number;width:number;height:number}
export interface ChatViewport {width:number;height:number;top?:number}
export type ChatEdge='n'|'e'|'s'|'w'|'ne'|'nw'|'se'|'sw';
export interface ChatLayout {mode:ChatMode;detached:boolean;drawer?:ChatRect;popup?:ChatRect}
export const CHAT_LAYOUT_KEY='harness:chat-view:v1';
export const CHAT_TRANSITION_MS=360;
export const CHAT_EDGES:ChatEdge[]=['n','e','s','w','ne','nw','se','sw'];
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function chatBounds(view:ChatViewport){
 const margin=Math.min(20,view.width/8,view.height/8),top=Math.max(margin,view.top??0);
 return {left:margin,top,right:Math.max(margin,view.width-margin),bottom:Math.max(top,view.height-margin)};
}
// A rect at least as large as its clamp area would pin at the area's edge on
// every drag; live move drags may pass slack so an edge-filling float can still
// slide a little (like an OS window wider than the screen). Slack only opens
// left: the float's top header and its right-edge and bottom-right controls
// always stay inside the clip, so they remain reachable wherever the drag lands.
// Persisted, restored, resized and keyboard-moved rects keep the strict
// in-bounds clamp.
export function clampChatRect(rect:ChatRect,view:ChatViewport,slack=0):ChatRect{
 // Slack admits moves only toward edges whose controls stay inside the clip:
 // left for a width-filling float. A height-filling float gets no vertical slack
 // — either direction drops its header or its resize handle out of reach.
 const area=chatBounds(view),availW=area.right-area.left,availH=area.bottom-area.top,width=clamp(rect.width,Math.min(320,availW),availW),height=clamp(rect.height,Math.min(300,availH),availH),sx=width>=availW?slack:0;
 return {width,height,x:clamp(rect.x,Math.min(area.left,area.right-width)-sx,Math.max(area.left,area.right-width)),y:clamp(rect.y,Math.min(area.top,area.bottom-height),Math.max(area.top,area.bottom-height))};
}
export function chatPanelRect(layout:ChatLayout,view:ChatViewport):ChatRect{
 const area=chatBounds(view),mode=layout.mode==='full'?'popup':layout.mode;
 const width=mode==='drawer'?clamp(view.width/3,360,520):clamp(view.width/4,400,560),height=mode==='drawer'?area.bottom-area.top:Math.min(760,area.bottom-area.top-16);
 const saved=layout[mode],rect=clampChatRect(saved??{x:area.right-width,y:mode==='drawer'?area.top:area.bottom-height,width,height},view);
 return mode==='drawer'&&!layout.detached?{...rect,x:area.right-rect.width}:rect;
}
export function resizeChatRect(start:ChatRect,edge:ChatEdge,dx:number,dy:number,view:ChatViewport):ChatRect{
 const area=chatBounds(view),minWidth=Math.min(320,area.right-area.left),minHeight=Math.min(300,area.bottom-area.top);
 let {x,y,width,height}=start;
 if(edge.includes('e'))width=clamp(width+dx,minWidth,area.right-x);
 if(edge.includes('s'))height=clamp(height+dy,minHeight,area.bottom-y);
 if(edge.includes('w')){const right=x+width;x=clamp(x+dx,area.left,right-minWidth);width=right-x;}
 if(edge.includes('n')){const bottom=y+height;y=clamp(y+dy,area.top,bottom-minHeight);height=bottom-y;}
 return {x,y,width,height};
}
export function isChatDockTarget(x:number,y:number,view:ChatViewport){
 const area=chatBounds(view);return x>=area.right-56&&x<=view.width&&y>=area.top&&y<=area.bottom;
}
function validRect(value:unknown):value is ChatRect{
 return Boolean(value&&typeof value==='object'&&['x','y','width','height'].every(key=>typeof (value as Record<string,unknown>)[key]==='number'&&Number.isFinite((value as Record<string,number>)[key]))&&(value as ChatRect).width>0&&(value as ChatRect).height>0);
}
export function readChatLayout(storage?:Pick<Storage,'getItem'>):ChatLayout{
 const fallback:ChatLayout={mode:'full',detached:false};
 try{
  const raw=storage?.getItem(CHAT_LAYOUT_KEY);if(!raw||raw.length>2048)return fallback;
  const value=JSON.parse(raw) as Partial<ChatLayout>|null;
  if(!value||!['full','drawer','popup'].includes(value.mode??''))return fallback;
  return {mode:value.mode!,detached:value.mode==='popup'||value.mode==='drawer'&&value.detached===true,...(validRect(value.drawer)?{drawer:value.drawer}:{}),...(validRect(value.popup)?{popup:value.popup}:{})};
 }catch{return fallback;}
}
export function writeChatLayout(layout:ChatLayout,storage?:Pick<Storage,'setItem'>){
 try{storage?.setItem(CHAT_LAYOUT_KEY,JSON.stringify(layout));}catch{/* Local preferences are optional; the live conversation stays usable. */}
}
