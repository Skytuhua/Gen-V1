import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture,linkedMapData,linkedMapSpec} from './task-interface-fixture';

const flushFrames=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

test('choosing Plan for a first thread migrates the current composer draft',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Ready'}}}}),created=structuredClone(snapshot.threads[0]);created.id='new-plan';created.title='New plan';snapshot.threads=[];snapshot.messages=[];snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];snapshot.activeThreadId=null;
 await serveTaskFixture(page,snapshot);await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='thread.create'){snapshot.threads.push(created);return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:created}});}if(command.type==='thread.mode'){created.mode='plan';return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:created}});}return route.fallback();});
 await page.goto('/');const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled();await message.fill('Keep the scope I already typed.');const mode=page.getByRole('button',{name:'Task mode',exact:true});await mode.click();await expect(mode).toHaveAttribute('aria-pressed','true');await expect(mode).toContainText('Plan');await expect(message).toHaveValue('Keep the scope I already typed.');await page.reload();await expect(message).toHaveValue('Keep the scope I already typed.');
});

test('unequal step panels reshape continuously rather than dropping height after the fade',async({page})=>{
  const snapshot=taskFixture({root:'steps',elements:{steps:{type:'Steps',props:{stateKey:'step',steps:[{key:'long',label:'Details'},{key:'short',label:'Confirm'}]},children:['long','short']},long:{type:'Stack',props:{gap:'md'},children:Array.from({length:16},(_,i)=>'line'+i)},short:{type:'Input',props:{stateKey:'note',label:'Review note'}},...Object.fromEntries(Array.from({length:16},(_,i)=>['line'+i,{type:'Text',props:{text:'A source-backed detail for the current review.'}}]))}},{},{step:'long',note:'Keep this draft'});
  await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.getByRole('group',{name:'Details',exact:true})).toBeVisible();
  await page.evaluate(()=>{const node=document.querySelector<HTMLElement>('.task-step-content')!;const samples:number[]=[];Object.assign(window,{stepHeights:samples});let watching=false;new MutationObserver(()=>{if(!watching&&node.querySelector('[data-phase="current"][aria-label="Confirm"]')){watching=true;const start=performance.now();const sample=()=>{samples.push(node.getBoundingClientRect().height);if(performance.now()-start<750)requestAnimationFrame(sample);else Object.assign(window,{stepHeightsDone:true});};requestAnimationFrame(sample);}}).observe(node,{attributes:true,subtree:true});});
  await page.getByRole('button',{name:'Next step',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {stepHeightsDone?:boolean}).stepHeightsDone)).toBe(true);
  const values=await page.evaluate(()=>(window as unknown as {stepHeights:number[]}).stepHeights);
  expect(values.length).toBeGreaterThan(8);expect(Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i])))).toBeLessThan(80);
  await expect(page.getByRole('textbox',{name:'Review note',exact:true})).toHaveValue('Keep this draft');
});

test('frequent running detail updates remain opaque instead of replaying status transitions',async({page})=>{
  const snapshot=taskFixture({root:'status',elements:{status:{type:'Status',props:{dataBinding:'run'}}}},{run:{status:'running',label:'Running tests',detail:'1 of 20'}});
  const host=await serveTaskFixture(page,snapshot);await page.addInitScript(()=>{const animate=Element.prototype.animate;Object.assign(window,{statusAnimations:0});Element.prototype.animate=function(...args){if(this.classList.contains('task-status'))(window as unknown as {statusAnimations:number}).statusAnimations++;return animate.apply(this,args);};});
  await page.goto('/');const status=page.locator('.task-status');await expect(status).toContainText('Running tests');
  for(let i=2;i<=9;i++){host.setInput('run',{status:'running',label:'Running tests',detail:`${i} of 20`});await host.publish();await flushFrames(page);}
  expect(await page.evaluate(()=>(window as unknown as {statusAnimations:number}).statusAnimations)).toBe(0);
  await expect(status).toContainText('9 of 20');
});

test('a restored map selection aligns immediately without a synthetic carousel journey',async({page})=>{
  const snapshot=taskFixture(linkedMapSpec,{places:linkedMapData},{selectedPlace:'cafe'});
  await serveTaskFixture(page,snapshot);await page.addInitScript(()=>{const scroll=Element.prototype.scrollTo;Object.assign(window,{restoredMapScroll:[]});Element.prototype.scrollTo=(function(this:Element,...args:unknown[]){if(this.classList.contains('task-map-carousel'))(window as unknown as {restoredMapScroll:unknown[]}).restoredMapScroll.push(args[0]);return (scroll as (...a:unknown[])=>void).apply(this,args);}) as typeof scroll;});
  await page.goto('/');await expect(page.getByRole('region',{name:'Selected place',exact:true})).toContainText('Garden cafe');
  const calls=await page.evaluate(()=>(window as unknown as {restoredMapScroll:{behavior?:string}[]}).restoredMapScroll);
  expect(calls.length).toBeGreaterThan(0);expect(calls.every(call=>call.behavior!=='smooth')).toBe(true);
});
