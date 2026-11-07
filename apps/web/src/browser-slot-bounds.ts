export interface BrowserSlotRect {left:number;top:number;right:number;bottom:number}

/** Keep native content off full-span resize targets; other overlays still use occlusion. */
export function browserSlotRect(slot:BrowserSlotRect,viewport:{width:number;height:number},handles:readonly BrowserSlotRect[]):BrowserSlotRect{
 let left=Math.max(0,slot.left),top=Math.max(0,slot.top),right=Math.max(left,Math.min(viewport.width,slot.right)),bottom=Math.max(top,Math.min(viewport.height,slot.bottom));
 for(const handle of handles){
  if(handle.top<=top&&handle.bottom>=bottom){
   if(handle.left<=left&&handle.right>left)left=Math.min(right,handle.right);
   else if(handle.right>=right&&handle.left<right)right=Math.max(left,handle.left);
  }
  if(handle.left<=left&&handle.right>=right){
   if(handle.top<=top&&handle.bottom>top)top=Math.min(bottom,handle.bottom);
   else if(handle.bottom>=bottom&&handle.top<bottom)bottom=Math.max(top,handle.top);
  }
 }
 return{left,top,right,bottom};
}
