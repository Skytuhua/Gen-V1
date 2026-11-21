import type {TaskbarReadResult,TaskbarStatus} from '../../packages/desktop-contract/index.ts';

export type NativeTaskbarMode='none'|'normal'|'indeterminate'|'paused'|'error';
export interface NativeTaskbarState {progress:number;mode:NativeTaskbarMode;overlay:boolean}
const EMPTY:NativeTaskbarState={progress:-1,mode:'none',overlay:false};

/** Maps the host-computed status onto Windows' native progress modes (VD-01). */
export function taskbarNativeState(status:TaskbarStatus|undefined):NativeTaskbarState{
 if(!status||!status.enabled)return {...EMPTY};
 const value=status.progress===null?null:Math.min(.98,Math.max(.02,Math.round(status.progress*100)/100));
 switch(status.mode){
  case 'none':return {...EMPTY};
  case 'indeterminate':return {progress:2,mode:'indeterminate',overlay:false};
  case 'normal':return {progress:value??2,mode:'normal',overlay:false};
  case 'paused':return {progress:value??1,mode:'paused',overlay:false};
  case 'error':return {progress:value??1,mode:'error',overlay:true};
 }
}
export function sameNativeState(a:NativeTaskbarState,b:NativeTaskbarState):boolean{return a.mode===b.mode&&a.overlay===b.overlay&&Math.round(a.progress*100)===Math.round(b.progress*100);}

/** VD-03 failure badge: 12px #E5484D circle ringed #0F0F0F at (11,11), white exclamation. */
export function failureOverlayBitmap(scale:number):Uint8Array{
 const size=Math.round(16*scale),pixels=new Uint8Array(size*size*4);
 const cx=11*scale,cy=11*scale,radius=6*scale,ring=1*scale;
 const set=(x:number,y:number,r:number,g:number,b:number,a:number)=>{const o=(y*size+x)*4;pixels[o]=r;pixels[o+1]=g;pixels[o+2]=b;pixels[o+3]=a;};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const distance=Math.hypot(x+.5-cx,y+.5-cy);
  if(distance>radius+.5)continue;
  const edge=distance>radius-.5;
  const alpha=edge?128:255;
  // Exclamation: 2px-wide bar, 5px tall, 1px gap, 2x2 dot — centred on the circle.
  const inStem=x+.5>=cx-scale&&x+.5<cx+scale&&(y+.5>=cy-4*scale&&y+.5<cy+scale);
  const inDot=x+.5>=cx-scale&&x+.5<cx+scale&&y+.5>=cy+2*scale&&y+.5<cy+4*scale;
  if(inStem||inDot){set(x,y,255,255,255,edge?Math.min(alpha,255):alpha);continue;}
  if(distance>radius-ring)set(x,y,15,15,15,alpha);
  else set(x,y,0xE5,0x48,0x4D,alpha);
 }
 return pixels;
}

export interface TaskbarRefresherDeps {
 read():Promise<TaskbarReadResult>;
 apply(state:NativeTaskbarState):void;
 result?(result:TaskbarReadResult):void;
 setTimer?(callback:()=>void,ms:number):()=>void;
}
/** Coalescing refresher: one read in flight, a 250 ms trailing re-read, a 15 s
 * safety poll while the bar shows anything but none, two failures clear to none. */
export function createTaskbarRefresher(deps:TaskbarRefresherDeps){
 const setTimer=deps.setTimer??((callback:()=>void,ms:number)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);});
 let inFlight=false,queued=false,failures=0,last:NativeTaskbarState={...EMPTY},heldProgress=-1,cancelPoll:(()=>void)|undefined,cancelTrail:(()=>void)|undefined,alive=true;
 const arm=()=>{cancelPoll?.();cancelPoll=undefined;if(alive&&last.mode!=='none')cancelPoll=setTimer(()=>void refresh(),15000);};
 const apply=(next:NativeTaskbarState)=>{
  // VD-02: determinate progress never regresses while the bar stays normal.
  if(next.mode==='normal'&&last.mode==='normal'&&next.progress<heldProgress)next={...next,progress:heldProgress};
  heldProgress=next.mode==='normal'?next.progress:-1;
  if(sameNativeState(last,next)){last=next;return;}
  last=next;deps.apply({...next});
 };
 const refresh=async()=>{
  if(!alive||inFlight){queued=true;return;}
  inFlight=true;
  try{
   const result=await deps.read();
   failures=0;deps.result?.(result);
   apply(taskbarNativeState(result.taskbar));
  }catch{
   failures++;
   if(failures>=2)apply({...EMPTY});
  }finally{
   inFlight=false;arm();
   if(queued){queued=false;cancelTrail?.();cancelTrail=setTimer(()=>void refresh(),250);}
  }
 };
 return{
  refresh:()=>{void refresh();},
  reapply:()=>{deps.apply({...last});},
  clear:()=>{last={...EMPTY};heldProgress=-1;deps.apply({...EMPTY});},
  state:()=>({...last}),
  stop:()=>{alive=false;cancelPoll?.();cancelTrail?.();cancelPoll=cancelTrail=undefined;},
 };
}
