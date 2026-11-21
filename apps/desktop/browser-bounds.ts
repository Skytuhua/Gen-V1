import type {DesktopBounds} from '../../packages/desktop-contract';

/** IPC supplies owner CSS pixels; WebContentsView uses native device-independent pixels. */
export function nativeBrowserBounds(bounds:DesktopBounds,[width,height]:readonly number[],zoom:number):DesktopBounds{
 if(!Number.isFinite(zoom)||zoom<=0||![width,height,bounds.x,bounds.y,bounds.width,bounds.height].every(value=>Number.isFinite(value)&&value>=0))throw Error('Browser bounds must fit the window');
 const left=bounds.x*zoom,top=bounds.y*zoom,right=(bounds.x+bounds.width)*zoom,bottom=(bounds.y+bounds.height)*zoom;
 if(![left,top,right,bottom].every(Number.isFinite)||right>width+1||bottom>height+1)throw Error('Browser bounds must fit the window');
 const x=Math.min(width,Math.ceil(left)),y=Math.min(height,Math.ceil(top)),w=Math.max(0,Math.min(width,Math.floor(right))-x),h=Math.max(0,Math.min(height,Math.floor(bottom))-y);
 return w&&h?{x,y,width:w,height:h}:{x:0,y:0,width:0,height:0};
}
import type {DesktopBrowserWidthPreset} from '../../packages/desktop-contract';

export interface NativeBrowserPreviewMetrics {
  effective:DesktopBrowserWidthPreset;
  /** Viewport width in content CSS pixels after DIP quantization. */
  actualWidth:number;
  /** Available viewport width in content CSS pixels inside the validated slot. */
  availableWidth:number;
  availability:{390:boolean;768:boolean};
  hidden:boolean;
  fallback?:'insufficient-space';
}

/** Apply an optional width preset inside the already validated slot S: a preset
 * is centered, never scaled down to fit, and falls back to Fit when the
 * required native width exceeds S.width. The returned rectangle is always a
 * subset of S and therefore inside the owner content bounds. */
export function nativeBrowserPreviewBounds(bounds:DesktopBounds,ownerSize:readonly number[],ownerZoom:number,contentZoom:number,preset:DesktopBrowserWidthPreset):DesktopBounds&NativeBrowserPreviewMetrics{
 if(!Number.isFinite(contentZoom)||contentZoom<=0)throw Error('Browser bounds must fit the window');
 const slot=nativeBrowserBounds(bounds,ownerSize,ownerZoom),hidden=slot.width<=0||slot.height<=0,availableWidth=slot.width/contentZoom;
 const fits=(p:390|768)=>!hidden&&Math.ceil(p*contentZoom)<=slot.width;
 const availability={390:fits(390),768:fits(768)};
 if(hidden||preset==='fit'||(preset!==390&&preset!==768))return {...slot,effective:'fit',actualWidth:availableWidth,availableWidth,availability,hidden};
 const required=Math.ceil(preset*contentZoom);
 if(!fits(preset))return {...slot,effective:'fit',actualWidth:availableWidth,availableWidth,availability,hidden,fallback:'insufficient-space'};
 const x=Math.max(slot.x,Math.min(slot.x+Math.floor((slot.width-required)/2),slot.x+slot.width-required));
 return {x,y:slot.y,width:required,height:slot.height,effective:preset,actualWidth:required/contentZoom,availableWidth,availability,hidden:false};
}
