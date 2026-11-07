import {test,expect,type Page} from '@playwright/test';

type ScrollFixture={
 controller:ReturnType<typeof import('../../apps/web/src/conversation-scroll')['createConversationScroll']>;
 element:HTMLElement;content:HTMLElement;positions:{top:number;tail:boolean}[];
};
declare global{interface Window{conversationFixture:ScrollFixture;}}
async function mount(page:Page){
 await page.route('**/scroll-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><style>body{margin:20px;background:#000;color:#eee}#chat{height:360px;width:640px;overflow:auto;overflow-anchor:none}#content{height:800px;background:linear-gradient(#191919,#303030)}input{display:block}p{margin:0;padding:12px}</style><div id="chat" tabindex="0"><div id="content"><input aria-label="Inline note"><p>Earlier conversation</p></div></div></html>'}));
 await page.goto('/scroll-fixture');
 await page.evaluate(async()=>{
  const path='/src/conversation-scroll.ts',module=await import(path);
  const element=document.getElementById('chat')!,content=document.getElementById('content')!,positions:{top:number;tail:boolean}[]=[];
  const controller=module.createConversationScroll(element) as ScrollFixture['controller'];
  element.addEventListener('scroll',()=>{const saved=controller.remember();if(saved)positions.push(saved);});
  window.conversationFixture={controller,element,content,positions};controller.update('one',{top:0,tail:true});
 });
 await expect.poll(()=>page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBe(440);
}

test('native tail frames move continuously and never record a false manual-reading position',async({page})=>{
 await mount(page);
 const samples=await page.evaluate(async()=>{
  const f=window.conversationFixture,values:number[]=[f.element.scrollTop];f.content.style.height='1500px';
  const started=performance.now();await new Promise<void>(resolve=>{const sample=()=>{values.push(f.element.scrollTop);if(performance.now()-started<950)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});return values;
 });
 expect(samples.some(top=>top>440&&top<1140)).toBe(true);
 expect(Math.max(...samples.slice(1).map((top,index)=>Math.abs(top-samples[index])))).toBeLessThan(180);
 expect(samples.at(-1)).toBeCloseTo(1140,0);
 expect(await page.evaluate(()=>window.conversationFixture.positions)).toEqual([]);
});

test('real wheel input interrupts following and later content leaves the reader in place',async({page})=>{
 await mount(page);await page.evaluate(()=>{window.conversationFixture.content.style.height='1700px';});
 await expect.poll(()=>page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBeGreaterThan(500);
 await page.mouse.move(300,200);await page.mouse.wheel(0,-320);await page.waitForTimeout(350);
 const reading=await page.evaluate(()=>window.conversationFixture.element.scrollTop);
 expect(await page.evaluate(()=>window.conversationFixture.positions.at(-1)?.tail)).toBe(false);
 await page.evaluate(()=>{const f=window.conversationFixture;f.content.style.height='2200px';f.controller.update('one',{top:440,tail:true});});
 await page.waitForTimeout(850);expect(await page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBeCloseTo(reading,0);
});

test('restoration and prepended history keep their anchor without a cross-thread journey',async({page})=>{
 await mount(page);
 const positions=await page.evaluate(()=>{
  const f=window.conversationFixture;f.controller.update('two',{top:130,tail:false});const restored=f.element.scrollTop;
  f.content.style.height='1200px';f.controller.update('two',{top:130,tail:false},{height:800,top:130});const anchored=f.element.scrollTop;
  f.controller.update('one',{top:440,tail:true});const switched=f.element.scrollTop;return {restored,anchored,switched};
 });
 expect(positions).toEqual({restored:130,anchored:530,switched:840});
 await page.waitForTimeout(800);expect(await page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBe(840);
});

test('reduced motion and disposal do not leave delayed scroll work',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await mount(page);
 await page.evaluate(()=>{window.conversationFixture.content.style.height='1400px';});
 await expect.poll(()=>page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBe(1040);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{const f=window.conversationFixture;f.content.style.height='2000px';f.controller.update('one',{top:1040,tail:true});});
 await expect.poll(()=>page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBeGreaterThan(1040);
 const held=await page.evaluate(()=>{const f=window.conversationFixture;f.controller.dispose();return f.element.scrollTop;});
 await page.evaluate(()=>{window.conversationFixture.content.style.height='2400px';});await page.waitForTimeout(800);
 expect(await page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBeCloseTo(held,0);
});

for(const policy of ['off','reduced'] as const)test(`app ${policy} settles following and preserves a detached reader`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page);
 const position=await page.evaluate(async policy=>{const f=window.conversationFixture;f.content.style.height='1900px';f.controller.update('one',{top:440,tail:true});const before=f.element.scrollTop;document.documentElement.dataset.motion=policy;await Promise.resolve();const after=f.element.scrollTop;f.controller.beginManualScroll();f.controller.scrollTo(120);document.documentElement.dataset.motion='system';await Promise.resolve();document.documentElement.dataset.motion=policy;await Promise.resolve();return {before,after,detached:f.element.scrollTop};},policy);
 expect(position).toEqual({before:440,after:1540,detached:120});
 await page.evaluate(()=>{window.conversationFixture.controller.dispose();document.documentElement.dataset.motion='system';window.conversationFixture.content.style.height='2500px';});await page.waitForTimeout(50);expect(await page.evaluate(()=>window.conversationFixture.element.scrollTop)).toBe(120);
});
