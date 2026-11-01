import {afterEach,expect,it,vi} from 'vitest';
import {createConversationScroll} from '../apps/web/src/conversation-scroll';

function fixture(){
 let now=0,nextFrame=0;
 const frames=new Map<number,FrameRequestCallback>();
 const page=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const preference=Object.assign(new EventTarget(),{matches:false});
 const content={} as Element;
 const element=Object.assign(new EventTarget(),{scrollTop:0,scrollHeight:1000,clientHeight:400,clientWidth:600,children:[content],getClientRects:()=>[{}]});
 let resized:ResizeObserverCallback=()=>{};
 vi.stubGlobal('document',page);
 vi.stubGlobal('performance',{now:()=>now});
 vi.stubGlobal('matchMedia',()=>preference);
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextFrame,callback);return nextFrame;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 vi.stubGlobal('ResizeObserver',class{constructor(callback:ResizeObserverCallback){resized=callback;}observe(){}unobserve(){}disconnect(){}});
 const scroll=createConversationScroll(element as unknown as HTMLElement);
 const tick=(count=1)=>{for(let i=0;i<count;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));}};
 const intent=(type:string,properties:Record<string,unknown>={})=>element.dispatchEvent(Object.assign(new Event(type),properties));
 return {element,scroll,tick,frames,page,preference,intent,resize:()=>resized([],{} as ResizeObserver)};
}
afterEach(()=>vi.unstubAllGlobals());

it('restores history immediately, then moves toward new content without detaching the tail',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});expect(f.element.scrollTop).toBe(600);expect(f.frames.size).toBe(0);
 f.element.scrollHeight=1300;f.scroll.update('one',{top:600,tail:true});expect(f.element.scrollTop).toBe(600);f.tick(4);
 expect(f.element.scrollTop).toBeGreaterThan(600);expect(f.element.scrollTop).toBeLessThan(900);expect(f.scroll.remember()).toBeNull();
 f.tick(60);expect(f.element.scrollTop).toBe(900);expect(f.frames.size).toBe(0);expect(f.scroll.remember()).toBeNull();
 f.scroll.dispose();
});

it('does not schedule motion for unchanged snapshots or replay an old thread entrance',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});
 for(let i=0;i<12;i++)f.scroll.update('one',{top:600,tail:true});expect(f.frames.size).toBe(0);
 f.scroll.update('two',{top:120,tail:false});expect(f.element.scrollTop).toBe(120);expect(f.frames.size).toBe(0);
 f.scroll.update('one',{top:600,tail:true});expect(f.element.scrollTop).toBe(600);expect(f.frames.size).toBe(0);f.scroll.dispose();
});

it('wheel intent cancels immediately and a concurrent snapshot cannot pull the reader back down',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});f.element.scrollHeight=1600;f.scroll.update('one',{top:600,tail:true});f.tick(5);
 f.intent('wheel',{deltaY:-150});const held=f.element.scrollTop;expect(f.frames.size).toBe(0);
 f.scroll.update('one',{top:600,tail:true});f.tick(10);expect(f.element.scrollTop).toBe(held);
 f.element.scrollTop=210;expect(f.scroll.remember()).toEqual({top:210,tail:false});
 f.element.scrollHeight=2000;f.resize();f.scroll.update('one',{top:210,tail:false});expect(f.element.scrollTop).toBe(210);expect(f.frames.size).toBe(0);f.scroll.dispose();
});

it('also yields to native scrolling that did not originate from its own frame',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});f.element.scrollHeight=1400;f.scroll.update('one',{top:600,tail:true});f.tick(3);
 f.element.scrollTop=140;expect(f.scroll.remember()).toEqual({top:140,tail:false});expect(f.frames.size).toBe(0);f.scroll.dispose();
});

it('does not detach the tail when a duplicate native scroll event arrives after content grows',()=>{
 const f=fixture();f.scroll.update('one',{top:160,tail:false});f.element.scrollTop=600;expect(f.scroll.remember()).toEqual({top:600,tail:true});
 f.element.scrollHeight=1931;f.scroll.update('one',{top:600,tail:true});expect(f.scroll.remember()).toBeNull();f.tick(60);expect(f.element.scrollTop).toBe(1531);f.scroll.dispose();
});

it('keeps an earlier-message anchor immediate and never animates across thread changes',()=>{
 const f=fixture();f.scroll.update('one',{top:160,tail:false});f.element.scrollHeight=1800;
 f.scroll.update('one',{top:160,tail:false},{height:1000,top:160});expect(f.element.scrollTop).toBe(960);expect(f.frames.size).toBe(0);
 f.scroll.update('two',{top:0,tail:true});f.element.scrollHeight=2200;f.scroll.update('two',{top:1400,tail:true});f.tick(2);expect(f.frames.size).toBe(1);
 f.scroll.update('one',{top:960,tail:false});expect(f.element.scrollTop).toBe(960);expect(f.frames.size).toBe(0);f.scroll.dispose();
});

it('follows delayed body growth only while the reader still follows the tail',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});f.element.scrollHeight=1450;f.resize();f.tick(60);expect(f.element.scrollTop).toBe(1050);
 f.intent('wheel',{deltaY:-120});f.element.scrollTop=200;f.scroll.remember();f.element.scrollHeight=1800;f.resize();f.tick(10);expect(f.element.scrollTop).toBe(200);expect(f.frames.size).toBe(0);f.scroll.dispose();
});

it('Jump to latest explicitly resumes following without changing a saved manual position first',()=>{
 const f=fixture();f.scroll.update('one',{top:180,tail:false});expect(f.scroll.jump()).toEqual({top:600,tail:true});expect(f.element.scrollTop).toBe(180);
 f.tick(60);expect(f.element.scrollTop).toBe(600);f.element.scrollHeight=1300;f.resize();f.tick(60);expect(f.element.scrollTop).toBe(900);f.scroll.dispose();
});

it('keeps the tail through composer or workspace height changes without moving a history reader',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});f.element.clientHeight=250;f.resize();f.tick(60);expect(f.element.scrollTop).toBe(750);
 f.intent('wheel',{deltaY:-150});f.element.scrollTop=140;f.scroll.remember();f.element.clientHeight=350;f.resize();f.tick(60);expect(f.element.scrollTop).toBe(140);f.scroll.dispose();
});

it('settles immediately for reduced motion or hidden documents and releases all frame work',()=>{
 const f=fixture();f.scroll.update('one',{top:0,tail:true});f.preference.matches=true;
 f.element.scrollHeight=1400;f.scroll.update('one',{top:600,tail:true});expect(f.element.scrollTop).toBe(1000);expect(f.frames.size).toBe(0);
 f.preference.matches=false;f.element.scrollHeight=1800;f.scroll.update('one',{top:1000,tail:true});f.tick(2);expect(f.frames.size).toBe(1);
 f.page.visibilityState='hidden';f.page.dispatchEvent(new Event('visibilitychange'));expect(f.element.scrollTop).toBe(1400);expect(f.frames.size).toBe(0);
 f.page.visibilityState='visible';f.element.scrollHeight=2200;f.scroll.update('one',{top:1400,tail:true});expect(f.frames.size).toBe(1);f.scroll.dispose();expect(f.frames.size).toBe(0);f.tick(2);expect(f.element.scrollTop).toBe(1400);
});
