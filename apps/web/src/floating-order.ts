// Focus changes a bounded shell-only stacking list, never generated task state.
const order:string[]=[];
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
// Each window's layer derives from its rank so any number of windows stacks by
// recency; windows outside the list rest at the rail's base layer.
export function layerFor(id:string){return 34+Math.max(0,order.indexOf(id));}
export function removeLayer(id:string){const index=order.indexOf(id);if(index>=0){order.splice(index,1);notify();}}
export function bringForward(id:string){if(order.at(-1)===id)return;removeLayer(id);order.push(id);notify();}
export function subscribeLayer(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
