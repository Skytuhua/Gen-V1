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
export function clampChatRect(rect:ChatRect,view:ChatViewport):ChatRect{
 const area=chatBounds(view),width=clamp(rect.width,Math.min(320,area.right-area.left),area.right-area.left),height=clamp(rect.height,Math.min(300,area.bottom-area.top),area.bottom-area.top);
 return {width,height,x:clamp(rect.x,area.left,area.right-width),y:clamp(rect.y,area.top,area.bottom-height)};
}
export function chatPanelRect(layout:ChatLayout,view:ChatViewport):ChatRect{
 const area=chatBounds(view),mode=layout.mode==='full'?'popup':layout.mode;
 const width=mode==='drawer'?clamp(view.width/3,360,520):350,height=mode==='drawer'?area.bottom-area.top:500;
 const saved=layout[mode],rect=clampChatRect(saved??{x:area.right-width,y:mode==='drawer'?area.top:area.bottom-height,width,height},view);
 return rect;
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
