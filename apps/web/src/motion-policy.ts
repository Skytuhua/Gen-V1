/** Effective policy for imperative browser effects. No subscriptions at import time. */
export type MotionPolicy = 'full' | 'reduced' | 'off';
const effectivePolicy = (reduce: boolean): MotionPolicy => {
 const app=document.documentElement.dataset.motion;
 return app==='off'?'off':app==='reduced'||reduce?'reduced':'full';
};
export function readMotionPolicy(): MotionPolicy {
 return effectivePolicy(matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/** Own both sources; notify only when their combined policy changes. */
export function observeMotionPolicy(listener: (policy: MotionPolicy) => void): () => void {
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 let current=effectivePolicy(media.matches),disposed=false;
 const changed=()=>{
  if(disposed)return;
  const next=effectivePolicy(media.matches);
  if(next!==current){current=next;listener(next);}
 };
 const observer=new MutationObserver(changed);
 observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
 media.addEventListener('change',changed);
 return ()=>{if(disposed)return;disposed=true;observer.disconnect();media.removeEventListener('change',changed);};
}
