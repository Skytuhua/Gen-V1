import {clampDesktopBounds,type DesktopBounds} from './window-policy.ts';

/** Electron screen and BrowserWindow geometry are both device-independent pixels. */
export interface DesktopDisplay {id:string;workArea:DesktopBounds;label?:string;primary?:boolean;scaleFactor?:number}
export interface DesktopPlacement {displayId:string;workArea:DesktopBounds;bounds:DesktopBounds}

function validBounds(raw:unknown):raw is DesktopBounds {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const value=raw as Record<string,unknown>;
 return ['x','y','width','height'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key] as number)<=100000)&&Number(value.width)>0&&Number(value.height)>0;
}
export function parseDesktopPlacement(raw:unknown):DesktopPlacement|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const value=raw as Record<string,unknown>;
 if(typeof value.displayId!=='string'||value.displayId.length<1||value.displayId.length>80||!validBounds(value.bounds)||!validBounds(value.workArea))return;
 return {displayId:value.displayId,bounds:{...value.bounds},workArea:{...value.workArea}};
}
function primary(displays:DesktopDisplay[]):DesktopDisplay {return displays.find(display=>display.primary)??displays[0]??{id:'fallback',workArea:{x:0,y:0,width:1280,height:800}};}
function displayForBounds(bounds:DesktopBounds,displays:DesktopDisplay[]):DesktopDisplay {
 let winner=primary(displays),most=0;
 for(const display of displays){const area=display.workArea,overlap=Math.max(0,Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x))*Math.max(0,Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y));if(overlap>most){most=overlap;winner=display;}}
 return winner;
}
export function captureDesktopPlacement(bounds:DesktopBounds,displays:DesktopDisplay[]):DesktopPlacement {
 const display=displayForBounds(bounds,displays);
 return {displayId:display.id,bounds:{...bounds},workArea:{...display.workArea}};
}
export function placeOnDesktopDisplay(bounds:Pick<DesktopBounds,'width'|'height'>,display:DesktopDisplay):DesktopBounds {
 return clampDesktopBounds({width:bounds.width,height:bounds.height},[display.workArea]);
}
export function restoreDesktopPlacement(preferred:DesktopPlacement|undefined,displays:DesktopDisplay[],size:{width:number;height:number},sourceBounds?:DesktopBounds):DesktopBounds {
 if(!preferred)return placeOnDesktopDisplay(size,sourceBounds?displayForBounds(sourceBounds,displays):primary(displays));
 const display=displays.find(item=>item.id===preferred.displayId);
 if(!display)return placeOnDesktopDisplay(preferred.bounds,primary(displays));
 const old=preferred.workArea,next=display.workArea,bounds=preferred.bounds;
 const width=Math.min(bounds.width,next.width),height=Math.min(bounds.height,next.height);
 const position=(value:number,start:number,extent:number,windowExtent:number)=>extent>windowExtent?Math.max(0,Math.min(1,(value-start)/(extent-windowExtent))):0.5;
 const x=next.x+position(bounds.x,old.x,old.width,bounds.width)*Math.max(0,next.width-width),y=next.y+position(bounds.y,old.y,old.height,bounds.height)*Math.max(0,next.height-height);
 return clampDesktopBounds({x,y,width,height},[next],size);
}
/** Programmatic rescue must not erase the monitor we should restore after reconnect. */
export function retainDesktopPlacement(bounds:DesktopBounds,preferred:DesktopPlacement|undefined,applied:DesktopBounds|undefined,displays:DesktopDisplay[]):DesktopPlacement {
 return preferred&&applied&&(['x','y','width','height'] as const).every(key=>bounds[key]===applied[key])?preferred:captureDesktopPlacement(bounds,displays);
}
