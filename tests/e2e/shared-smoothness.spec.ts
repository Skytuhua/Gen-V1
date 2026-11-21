import {test,expect,type Page} from '@playwright/test';
import {openApp,reloadApp,warmApp} from './app-ready';
test.beforeAll(async({browser,baseURL})=>{await warmApp(browser,baseURL);});
import {taskFixture,serveTaskFixture,linkedMapData,linkedMapSpec} from './task-interface-fixture';
import {plateauThenJump} from './settle';

const flushFrames=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

test('choosing Plan for a first thread migrates the current composer draft',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Ready'}}}}),created=structuredClone(snapshot.threads[0]);created.id='new-plan';created.title='New plan';snapshot.threads=[];snapshot.messages=[];snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];snapshot.activeThreadId=null;
 await serveTaskFixture(page,snapshot);await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='thread.create'){snapshot.threads.push(created);return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:created}});}if(command.type==='thread.mode'){created.mode='plan';return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:created}});}return route.fallback();});
 await openApp(page);const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled();await message.fill('Keep the scope I already typed.');const mode=page.getByRole('button',{name:/^(Build|Plan) mode, switch to (Plan|Build)$/,exact:true});await mode.click();await expect(mode).toHaveAttribute('aria-pressed','true');await expect(mode).toContainText('Plan');await expect(message).toHaveValue('Keep the scope I already typed.');await reloadApp(page);await expect(message).toHaveValue('Keep the scope I already typed.');
});

test('unequal step panels reshape continuously rather than dropping height after the fade',async({page})=>{
  const snapshot=taskFixture({root:'steps',elements:{steps:{type:'Steps',props:{stateKey:'step',steps:[{key:'long',label:'Details'},{key:'short',label:'Confirm'}]},children:['long','short']},long:{type:'Stack',props:{gap:'md'},children:Array.from({length:16},(_,i)=>'line'+i)},short:{type:'Input',props:{stateKey:'note',label:'Review note'}},...Object.fromEntries(Array.from({length:16},(_,i)=>['line'+i,{type:'Text',props:{text:'A source-backed detail for the current review.'}}]))}},{},{step:'long',note:'Keep this draft'});
  await serveTaskFixture(page,snapshot);await openApp(page);await expect(page.getByRole('group',{name:'Details',exact:true})).toBeVisible();
  // Sample per frame until the panel settles. Per-frame travel is not load-invariant —
  // a starved compositor legitimately yields fewer, larger frames — so the assertion
  // looks for the defect's real shape: a plateau (the fade finishing) followed by one
  // jump after it. Interpolated reshaping has no such plateau-then-jump under any load.
  await page.evaluate(()=>{const node=document.querySelector<HTMLElement>('.task-step-content')!,samples:{t:number;h:number}[]=[];Object.assign(window,{stepHeights:samples});const start=performance.now();let stable=0,previous=-1;const sample=()=>{const h=node.getBoundingClientRect().height;samples.push({t:performance.now()-start,h});if(Math.abs(h-previous)<.5)stable++;else stable=0;previous=h;if(stable>=12||samples.length>=180)Object.assign(window,{stepHeightsDone:true});else requestAnimationFrame(sample);};new MutationObserver(()=>{if(!(window as unknown as {watching?:boolean}).watching&&node.querySelector('[data-phase="current"][aria-label="Confirm"]')){Object.assign(window,{watching:true});requestAnimationFrame(sample);}}).observe(node,{attributes:true,subtree:true});});
  await page.getByRole('button',{name:'Next step',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {stepHeightsDone?:boolean}).stepHeightsDone)),{timeout:20000}).toBe(true);
  const values=await page.evaluate(()=>(window as unknown as {stepHeights:{t:number;h:number}[]}).stepHeights);
  const {travel,jump,distinct}=plateauThenJump(values);
  expect(travel).toBeGreaterThan(0);expect(distinct).toBeGreaterThan(2);expect(jump).toBe(0);
  await expect(page.getByRole('textbox',{name:'Review note',exact:true})).toHaveValue('Keep this draft');
});

test('frequent running detail updates remain opaque instead of replaying status transitions',async({page})=>{
  const snapshot=taskFixture({root:'status',elements:{status:{type:'Status',props:{dataBinding:'run'}}}},{run:{status:'running',label:'Running tests',detail:'1 of 20'}});
  const host=await serveTaskFixture(page,snapshot);await page.addInitScript(()=>{const animate=Element.prototype.animate;Object.assign(window,{statusAnimations:0});Element.prototype.animate=function(...args){if(this.classList.contains('task-status'))(window as unknown as {statusAnimations:number}).statusAnimations++;return animate.apply(this,args);};});
  await openApp(page);const status=page.locator('.task-status');await expect(status).toContainText('Running tests');
  for(let i=2;i<=9;i++){host.setInput('run',{status:'running',label:'Running tests',detail:`${i} of 20`});await host.publish();await flushFrames(page);}
  expect(await page.evaluate(()=>(window as unknown as {statusAnimations:number}).statusAnimations)).toBe(0);
  await expect(status).toContainText('9 of 20');
});

test('a restored map selection aligns immediately without a synthetic carousel journey',async({page})=>{
  const snapshot=taskFixture(linkedMapSpec,{places:linkedMapData},{selectedPlace:'cafe'});
  await serveTaskFixture(page,snapshot);await page.addInitScript(()=>{const scroll=Element.prototype.scrollTo;Object.assign(window,{restoredMapScroll:[]});Element.prototype.scrollTo=(function(this:Element,...args:unknown[]){if(this.classList.contains('task-map-carousel'))(window as unknown as {restoredMapScroll:unknown[]}).restoredMapScroll.push(args[0]);return (scroll as (...a:unknown[])=>void).apply(this,args);}) as typeof scroll;});
  await openApp(page);await expect(page.getByRole('region',{name:'Selected place',exact:true})).toContainText('Garden cafe');
  const calls=await page.evaluate(()=>(window as unknown as {restoredMapScroll:{behavior?:string}[]}).restoredMapScroll);
  expect(calls.length).toBeGreaterThan(0);expect(calls.every(call=>call.behavior!=='smooth')).toBe(true);
});
