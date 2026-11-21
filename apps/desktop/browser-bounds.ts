import type {DesktopBounds,DesktopBrowserBoundsResult,DesktopBrowserWidthPreset} from '../../packages/desktop-contract';

/** IPC supplies owner CSS pixels; WebContentsView uses native device-independent pixels. */
export function nativeBrowserBounds(bounds:DesktopBounds,[width,height]:readonly number[],zoom:number):DesktopBounds{
 if(!Number.isFinite(zoom)||zoom<=0||![width,height,bounds.x,bounds.y,bounds.width,bounds.height].every(value=>Number.isFinite(value)&&value>=0))throw Error('Browser bounds must fit the window');
 const left=bounds.x*zoom,top=bounds.y*zoom,right=(bounds.x+bounds.width)*zoom,bottom=(bounds.y+bounds.height)*zoom;
 if(![left,top,right,bottom].every(Number.isFinite)||right>width+1||bottom>height+1)throw Error('Browser bounds must fit the window');
 const x=Math.min(width,Math.ceil(left)),y=Math.min(height,Math.ceil(top)),w=Math.max(0,Math.min(width,Math.floor(right))-x),h=Math.max(0,Math.min(height,Math.floor(bottom))-y);
 return w&&h?{x,y,width:w,height:h}:{x:0,y:0,width:0,height:0};
}

/** Sizing authority for the docked browser preview. The supplied rectangle is the
 * renderer-measured usable slot; the returned bounds are always a subset of the
 * validated slot, so a preset can never expand an accepted rectangle. */
export function nativeBrowserPreviewBounds(bounds:DesktopBounds,preset:DesktopBrowserWidthPreset,ownerSize:readonly number[],ownerZoom:number,contentZoom:number):DesktopBrowserBoundsResult{
 if(preset!=='fit'&&preset!==390&&preset!==768||!Number.isFinite(contentZoom)||contentZoom<=0)throw Error('Invalid browser preview request');
 const slot=nativeBrowserBounds(bounds,ownerSize,ownerZoom);
 const hidden=slot.width===0||slot.height===0;
 const availableWidth=slot.width/contentZoom;
 const required=(width:390|768)=>Math.ceil(width*contentZoom);
 const availability={390:!hidden&&required(390)<=slot.width,768:!hidden&&required(768)<=slot.width};
 const effective:DesktopBrowserWidthPreset=preset==='fit'||hidden||availability[preset]?preset:'fit';
 const fallbackReason=preset!=='fit'&&!hidden&&!availability[preset]?`${preset} px needs ${preset} px; available ${Math.floor(availableWidth)} px`:undefined;
 let applied=slot;
 if(!hidden&&effective!=='fit'){
  const width=Math.min(required(effective),slot.width),x=Math.min(slot.x+slot.width-width,Math.max(slot.x,slot.x+Math.floor((slot.width-width)/2)));
  applied={x,y:slot.y,width:Math.max(0,Math.min(slot.x+slot.width,x+width)-x),height:slot.height};
 }
 const ownerBounds={x:applied.x/ownerZoom,y:applied.y/ownerZoom,width:applied.width/ownerZoom,height:applied.height/ownerZoom};
 return {requested:preset,effective,bounds:applied,ownerBounds,actualWidth:applied.width/contentZoom,availableWidth,availability,hidden,...(fallbackReason?{fallbackReason}:{})};
}
