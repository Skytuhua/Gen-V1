/** Small DOM motion value. Retargeting changes the destination, never the
 * visible position/velocity. No React render or layout read occurs per frame. */
export function springStep(value:number,velocity:number,target:number,seconds:number,frequency=18,damping=.82) {
  const offset=value-target,decay=Math.exp(-damping*frequency*seconds),rate=frequency*Math.sqrt(1-damping*damping);
  const wave=Math.cos(rate*seconds),sine=Math.sin(rate*seconds),coefficient=(velocity+damping*frequency*offset)/rate;
  return {value:target+decay*(offset*wave+coefficient*sine),velocity:decay*(-damping*frequency*(offset*wave+coefficient*sine)-offset*rate*sine+coefficient*rate*wave)};
}
export function createSpringValue(initial:number,write:(value:number)=>void,settled:()=>void=()=>{}) {
  let value=initial,velocity=0,target=initial,frame=0,last=0,started=0,disposed=false;
  const finish=()=>{cancelAnimationFrame(frame);frame=0;value=target;velocity=0;write(value);settled();};
  const tick=(now:number)=>{
    frame=0;if(disposed)return;
    if(document.visibilityState==='hidden'){finish();return;}
    const next=springStep(value,velocity,target,Math.min(.032,Math.max(.001,(now-last)/1000)));last=now;
    value=next.value;velocity=next.velocity;
    if((target===0&&value<0)||(Math.abs(value-target)<.2&&Math.abs(velocity)<4)||now-started>720){finish();return;}
    write(Math.max(0,value));frame=requestAnimationFrame(tick);
  };
  return {
    get value(){return value;},get velocity(){return velocity;},get active(){return frame!==0;},
    to(next:number,immediate=false){
      if(disposed||!Number.isFinite(next))return;
      next=Math.max(0,next);if(!immediate&&next===target)return;target=next;
      if(immediate){finish();return;}
      if(Math.abs(target-value)<.2&&Math.abs(velocity)<4){finish();return;}
      started=performance.now();if(!frame){last=started;frame=requestAnimationFrame(tick);}
    },
    dispose(){disposed=true;cancelAnimationFrame(frame);frame=0;},
  };
}
