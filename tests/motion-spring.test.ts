import {it,expect,vi,afterEach} from 'vitest';
import {createSpringValue,springStep} from '../apps/web/src/motion-spring';
afterEach(()=>vi.unstubAllGlobals());
it('is frame-rate independent and keeps velocity continuous when the target changes',()=>{
 const whole=springStep(100,40,260,.032),half=springStep(100,40,260,.016),next=springStep(half.value,half.velocity,260,.016);
 expect(next.value).toBeCloseTo(whole.value,9);expect(next.velocity).toBeCloseTo(whole.velocity,9);
 const reversed=springStep(whole.value,whole.velocity,40,.001);expect(Math.abs(reversed.value-whole.value)).toBeLessThan(3);
});
it('retargets one scheduled value and stops all frame work after rest/disposal',()=>{
 let now=0,sequence=0;const pending=new Map<number,FrameRequestCallback>(),writes:number[]=[];
 vi.stubGlobal('document',{visibilityState:'visible'});vi.stubGlobal('performance',{now:()=>now});
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{pending.set(++sequence,callback);return sequence;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>pending.delete(id));
 const value=createSpringValue(0,next=>writes.push(next));value.to(200);
 const tick=()=>{now+=16;const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(now));};
 for(let i=0;i<8;i++)tick();const position=value.value,velocity=value.velocity;value.to(50);expect(value.value).toBe(position);expect(value.velocity).toBe(velocity);expect(pending.size).toBe(1);
 for(let i=0;i<60&&pending.size;i++)tick();expect(value.value).toBe(50);expect(value.active).toBe(false);expect(pending.size).toBe(0);value.to(500);value.dispose();expect(pending.size).toBe(0);expect(writes.length).toBeGreaterThan(8);
});
