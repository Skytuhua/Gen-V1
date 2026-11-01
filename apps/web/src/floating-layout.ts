export type FloatingAnchor = 'top-right' | 'bottom-right';
export interface FloatingLayout {x:number;y:number;width:number;height:number;collapsed:boolean}
export interface FloatingViewport {width:number;height:number;top?:number;bottom?:number;gutter?:number;pinned?:'left'|'right'}
export interface FloatingSize {width:number;height:number}
export const floatingLayoutKey=(id:string)=>`harness:floating:${id}:v1`;
const finite=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const between=(value:number,minimum:number,maximum:number)=>Math.max(minimum,Math.min(maximum,value));
export const FLOATING_COLLAPSED_HEIGHT=36;
export function clampFloatingLayout(layout:FloatingLayout,viewport:FloatingViewport,minSize:FloatingSize):FloatingLayout {
  const viewportWidth=Math.max(32,finite(viewport.width,1024)),viewportHeight=Math.max(64,finite(viewport.height,768));
  const gutter=between(finite(viewport.gutter,8),0,8);
  const top=between(finite(viewport.top,gutter),gutter,viewportHeight-FLOATING_COLLAPSED_HEIGHT-gutter),bottom=between(finite(viewport.bottom,viewportHeight-gutter),top+FLOATING_COLLAPSED_HEIGHT,viewportHeight-gutter);
  const maximumWidth=viewportWidth-gutter*2,maximumHeight=bottom-top;
  const width=between(finite(layout.width,minSize.width),Math.min(Math.max(120,minSize.width),maximumWidth),maximumWidth);
  const collapsed=layout.collapsed===true;
  // A compact slot limits the visible header, not the remembered expanded height.
  const height=collapsed?between(finite(layout.height,minSize.height),Math.max(80,minSize.height),4096):between(finite(layout.height,minSize.height),Math.min(Math.max(80,minSize.height),maximumHeight),maximumHeight);
  return {x:viewport.pinned==='left'?gutter:viewport.pinned==='right'?viewportWidth-width-gutter:between(finite(layout.x,viewportWidth-width-gutter),gutter,viewportWidth-width-gutter),y:between(finite(layout.y,top),top,bottom-(collapsed?FLOATING_COLLAPSED_HEIGHT:height)),width,height,collapsed};
}
export function readFloatingLayout(id:string,initial:FloatingLayout,viewport:FloatingViewport,minSize:FloatingSize):FloatingLayout {
  try {
    const raw=localStorage.getItem(floatingLayoutKey(id));
    if(!raw||raw.length>1024)return clampFloatingLayout(initial,viewport,minSize);
    const saved:unknown=JSON.parse(raw);
    if(!saved||typeof saved!=='object'||Array.isArray(saved))return clampFloatingLayout(initial,viewport,minSize);
    const value=saved as Partial<FloatingLayout>;
    return clampFloatingLayout({x:finite(value.x,initial.x),y:finite(value.y,initial.y),width:finite(value.width,initial.width),height:finite(value.height,initial.height),collapsed:typeof value.collapsed==='boolean'?value.collapsed:initial.collapsed},viewport,minSize);
  }catch{return clampFloatingLayout(initial,viewport,minSize);}
}
export function writeFloatingLayout(id:string,layout:FloatingLayout):void {
  try {localStorage.setItem(floatingLayoutKey(id),JSON.stringify(layout));}catch{/* The window remains usable if browser preference storage is unavailable. */}
}
