export interface ChatRect {x:number;y:number;width:number;height:number}
export interface ChatViewport {width:number;height:number;top?:number}
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function chatBounds(view:ChatViewport){
 const margin=Math.min(20,view.width/8,view.height/8),top=Math.max(margin,view.top??0);
 return {left:margin,top,right:Math.max(margin,view.width-margin),bottom:Math.max(top,view.height-margin)};
}
export function clampChatRect(rect:ChatRect,view:ChatViewport):ChatRect{
 const area=chatBounds(view),width=clamp(rect.width,Math.min(320,area.right-area.left),area.right-area.left),height=clamp(rect.height,Math.min(300,area.bottom-area.top),area.bottom-area.top);
 return {width,height,x:clamp(rect.x,area.left,area.right-width),y:clamp(rect.y,area.top,area.bottom-height)};
}
