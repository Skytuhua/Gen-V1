import type {DesktopBounds} from '../../packages/desktop-contract';

/** IPC supplies owner CSS pixels; WebContentsView uses native device-independent pixels. */
export function nativeBrowserBounds(bounds:DesktopBounds,[width,height]:readonly number[],zoom:number):DesktopBounds{
 if(!Number.isFinite(zoom)||zoom<=0||![width,height,bounds.x,bounds.y,bounds.width,bounds.height].every(value=>Number.isFinite(value)&&value>=0))throw Error('Browser bounds must fit the window');
 const left=bounds.x*zoom,top=bounds.y*zoom,right=(bounds.x+bounds.width)*zoom,bottom=(bounds.y+bounds.height)*zoom;
 if(![left,top,right,bottom].every(Number.isFinite)||right>width+1||bottom>height+1)throw Error('Browser bounds must fit the window');
 const x=Math.min(width,Math.ceil(left)),y=Math.min(height,Math.ceil(top)),w=Math.max(0,Math.min(width,Math.floor(right))-x),h=Math.max(0,Math.min(height,Math.floor(bottom))-y);
 return w&&h?{x,y,width:w,height:h}:{x:0,y:0,width:0,height:0};
}
