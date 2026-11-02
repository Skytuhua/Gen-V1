import {test,expect,type Locator,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serveTaskFixture,taskFixture,type TaskSpec} from './task-interface-fixture';
import {createSigningPdfFixture} from './document-preview-fixture';

// Explicit intercepted renderer fixtures: no model, calendar, repository or executor effects.
const schedule={title:'Review windows',timeZone:'America/Los_Angeles',slots:Array.from({length:40},(_,index)=>({id:`slot-${index}`,start:new Date(Date.UTC(2026,10,3,16,index*10)).toISOString(),end:new Date(Date.UTC(2026,10,3,16,index*10+5)).toISOString(),label:`Design review ${index+1}`,availability:'available'}))};
const reviews={title:'Review the release notes',items:Array.from({length:20},(_,index)=>({id:`item-${index}`,label:`Release note ${index+1}`,detail:'Review this change before continuing.',evidence:[{label:'Change',value:'Keeps the existing callers compatible.'}]}))};
const logs={title:'Checkout investigation',events:Array.from({length:90},(_,index)=>({id:`event-${index}`,timestamp:new Date(Date.UTC(2026,10,3,16,0,index)).toISOString(),level:index%4===0?'warning':'info',message:`Checkout event ${index+1}`,detail:'Supplied event details.'}))};
const rows=Array.from({length:90},(_,index)=>({id:`row-${index}`,name:`Record ${index+1}`,status:'Ready'}));
const graph={nodes:Array.from({length:28},(_,index)=>({id:`commit-${index}`,label:`Commit ${index+1}`,lane:index%2,status:'neutral'})),edges:Array.from({length:27},(_,index)=>({from:`commit-${index}`,to:`commit-${index+1}`}))};
const tail=Array(40).fill('Continue reviewing the next part of this conversation.').join('\n\n');

async function open(page:Page,type:string,props:Record<string,unknown>,data:Record<string,unknown>={},withTail=true){
  const spec:TaskSpec={root:'root',elements:{root:{type:'Stack',props:{gap:'md'},children:withTail?['view','tail']:['view']},view:{type,props},tail:{type:'Text',props:{text:tail}}}};
  const snapshot=taskFixture(spec,data);snapshot.artifacts[0].presentation={width:'wide',frame:'canvas'};
  if(type==='SchedulePicker'){snapshot.artifacts[0].title='Review windows';snapshot.messages[0].content='Choose a time to review the design.';}
  if(type==='ReviewQueue'){snapshot.artifacts[0].title='Review the release notes';snapshot.messages[0].content='Review these release notes before continuing.';}
  snapshot.threads[0].title=snapshot.artifacts[0].title;snapshot.threads[0].projectName='Generative Harness';
  const host=await serveTaskFixture(page,snapshot);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await expect(page.locator('.artifact-content')).toBeVisible();return host;
}

async function natural(region:Locator){
  const value=await region.evaluate(node=>({overflow:getComputedStyle(node).overflowY,height:node.clientHeight,scroll:node.scrollHeight}));
  expect(['auto','scroll']).not.toContain(value.overflow);
  expect(value.scroll).toBeLessThanOrEqual(value.height+1);
}

async function wheelMovesChat(page:Page,region:Locator){
  await region.evaluate(node=>node.scrollIntoView({block:'start'}));
  const scroll=page.locator('.conversation-scroll'),before=await scroll.evaluate(node=>node.scrollTop);
  const box=await region.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+Math.min(box!.width/2,150),Math.max(80,Math.min(box!.y+45,500)));
  await page.mouse.wheel(0,360);
  await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(before+30);
  expect(await region.evaluate(node=>node.scrollTop)).toBe(0);
}

async function openingView(page:Page){
  await page.evaluate(()=>{(document.activeElement as HTMLElement|null)?.blur();document.querySelector('.conversation-scroll')!.scrollTop=0;});
  await expect.poll(()=>page.locator('.conversation-scroll').evaluate(node=>node.scrollTop)).toBe(0);
}

test('canvas task interfaces have a visible normal-flow container aligned with the composer',async({page})=>{
  await open(page,'SchedulePicker',{dataBinding:'data',stateKey:'view',actionId:'ask'},{data:{...schedule,slots:schedule.slots.slice(0,2)}});
  const appearance=()=>page.locator('.artifact').evaluate(node=>{
    const style=getComputedStyle(node),header=node.querySelector('.artifact-header')!,head=getComputedStyle(header);
    const box=node.getBoundingClientRect(),composer=document.querySelector('.composer')!.getBoundingClientRect();
    return {border:parseFloat(style.borderTopWidth),borderStyle:style.borderTopStyle,radius:parseFloat(style.borderTopLeftRadius),background:style.backgroundColor,headerPosition:head.position,headerOpacity:head.opacity,edge:Math.max(Math.abs(box.left-composer.left),Math.abs(box.right-composer.right))};
  });
  for(const size of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(size);const result=await appearance();
    expect(result.border).toBeGreaterThanOrEqual(1);expect(result.borderStyle).toBe('solid');expect(result.radius).toBeGreaterThanOrEqual(10);
    expect(result.background).not.toBe('rgba(0, 0, 0, 0)');expect(result.headerPosition).not.toBe('absolute');expect(result.headerOpacity).toBe('1');expect(result.edge).toBeLessThan(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
});

test('long schedule windows grow in chat and preserve a selected time through refresh and reload',async({page})=>{
  const host=await open(page,'SchedulePicker',{dataBinding:'data',stateKey:'view',actionId:'ask'},{data:schedule});
  const slots=page.locator('.schedule-slots');await expect(slots.getByRole('option')).toHaveCount(40);await natural(slots);await wheelMovesChat(page,slots);
  await slots.getByRole('option').nth(2).click();await expect.poll(()=>host.snapshot.userStates[0].values.view).toMatchObject({selectedId:'slot-2'});
  await host.publish();await expect(slots.getByRole('option').nth(2)).toHaveAttribute('aria-selected','true');await page.reload();await expect(slots.getByRole('option').nth(2)).toHaveAttribute('aria-selected','true');
});

test('review navigation grows with its items while decisions and comments survive chat scrolling and reload',async({page})=>{
  const host=await open(page,'ReviewQueue',{dataBinding:'data',stateKey:'view',actionId:'ask',actionLabel:'Send review'},{data:reviews});
  const nav=page.locator('.review-queue-layout>nav');await expect(nav.locator('li')).toHaveCount(20);await natural(nav);await wheelMovesChat(page,nav);
  await nav.locator('button').first().click();await page.getByRole('radio',{name:'Request changes',exact:true}).check();await page.getByRole('textbox',{name:'Review comment',exact:true}).fill('Keep the existing callers compatible.');
  await expect.poll(()=>host.snapshot.userStates[0].values.view).toMatchObject({selectedId:'item-0',items:{'item-0':{decision:'revise',comment:'Keep the existing callers compatible.'}}});
  await host.publish();await page.reload();await expect(page.getByRole('radio',{name:'Request changes',exact:true})).toBeChecked();await expect(page.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Keep the existing callers compatible.');
});

test('supplied log events grow naturally and wheel input goes to chat',async({page})=>{
  await open(page,'LogExplorer',{dataBinding:'data',stateKey:'view',actionId:'ask'},{data:logs});
  const region=page.locator('.log-events');await expect(region.locator('.log-event')).toHaveCount(90);await natural(region);await wheelMovesChat(page,region);
});

test('table rows remain in one natural document flow without an inner vertical scroller',async({page})=>{
  await open(page,'Table',{rowsBinding:'data',columns:[{key:'name',label:'Record'},{key:'status',label:'Status'}],rowKey:'id',stateKey:'selection'},{data:rows});
  const region=page.locator('.table-scroll');await expect(page.locator('tbody tr')).toHaveCount(90);await natural(region);await wheelMovesChat(page,region);
});

test('long vertical history grows in chat rather than trapping graph wheel input',async({page})=>{
  await open(page,'RelationshipGraph',{dataBinding:'data',stateKey:'selected',orientation:'vertical',label:'Branch review'},{data:graph});
  const region=page.locator('.task-graph-viewport');await expect(page.locator('.task-node')).toHaveCount(28);await natural(region);await wheelMovesChat(page,region);
});

test('question history and long code use chat scrolling while branches retain their saved state',async({page})=>{
  const spec:TaskSpec={root:'root',elements:{root:{type:'Stack',props:{gap:'md'},children:['questions','code','tail']},questions:{type:'Stack',props:{scroll:'bounded',label:'Questions'},children:Array.from({length:20},(_,index)=>`question-${index}`)},code:{type:'Code',props:{code:Array.from({length:100},(_,index)=>`const item${index} = 'value';`).join('\n'),language:'typescript'}},tail:{type:'Text',props:{text:tail}}}};
  for(let index=0;index<20;index++)spec.elements[`question-${index}`]={type:'Disclosure',props:{title:`Question ${index+1}`,text:'The answer remains available in this conversation.',stateKey:`question-${index}`}};
  const snapshot=taskFixture(spec),host=await serveTaskFixture(page,snapshot);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  const questions=page.locator('.task-history');await expect(questions).toBeVisible();await natural(questions);await wheelMovesChat(page,questions);
  await page.getByRole('button',{name:'Question 1',exact:true}).click();await expect.poll(()=>host.snapshot.userStates[0].values['question-0']).toBe(true);await page.reload();await expect(page.getByRole('button',{name:'Question 1',exact:true})).toHaveAttribute('aria-expanded','true');
  const code=page.locator('.code-block pre');await natural(code);await wheelMovesChat(page,code);
});

test('wheel input over the PDF preview scrolls chat while the real page remains ready',async({page})=>{
  const bytes=await createSigningPdfFixture({pages:1});const spec:TaskSpec={root:'root',elements:{root:{type:'Stack',props:{gap:'md'},children:['pdf','tail']},pdf:{type:'DocumentPreview',props:{resourceId:'agreement',title:'Agreement.pdf'}},tail:{type:'Text',props:{text:tail}}}};
  await serveTaskFixture(page,taskFixture(spec));await page.route('**/api/resources/agreement/content',route=>route.fulfill({contentType:'application/pdf',body:Buffer.from(bytes)}));await page.goto('/');
  await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:20000});
  const region=page.locator('.document-preview-scroll');await wheelMovesChat(page,region);await expect(page.locator('.document-preview canvas')).toBeVisible();
});

test('narrow inline PDF compositions fit the actual column without hiding the right edge',async({page})=>{
  const bytes=await createSigningPdfFixture({pages:1});
  const snapshot=taskFixture({root:'grid',elements:{grid:{type:'Grid',props:{columns:6},children:['pdf']},pdf:{type:'DocumentPreview',props:{resourceId:'agreement',title:'Review.pdf'}}}});
  await serveTaskFixture(page,snapshot);await page.route('**/api/resources/agreement/content',route=>route.fulfill({contentType:'application/pdf',body:Buffer.from(bytes)}));await page.goto('/');
  const preview=page.locator('.document-preview');await expect(preview).toHaveAttribute('data-preview-state','ready',{timeout:20000});
  const bounds=await preview.evaluate(node=>{const box=node.getBoundingClientRect(),canvas=node.querySelector('canvas')!.getBoundingClientRect();return{left:canvas.left-box.left,right:box.right-canvas.right};});
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeGreaterThanOrEqual(0);
});

test('Fit page keeps the complete inline PDF reachable through chat across zoom changes',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
  const bytes=await createSigningPdfFixture({pages:1});
  const spec:TaskSpec={root:'root',elements:{root:{type:'Stack',props:{gap:'md'},children:['pdf','tail']},pdf:{type:'DocumentPreview',props:{resourceId:'agreement',title:'Agreement.pdf'}},tail:{type:'Text',props:{text:tail}}}};
  await serveTaskFixture(page,taskFixture(spec));await page.route('**/api/resources/agreement/content',route=>route.fulfill({contentType:'application/pdf',body:Buffer.from(bytes)}));await page.goto('/');
  const preview=page.locator('.document-preview'),canvas=preview.locator('canvas'),viewport=page.locator('.document-preview-scroll');
  await expect(preview).toHaveAttribute('data-preview-state','ready',{timeout:20000});const original=await canvas.elementHandle();
  const completePage=async()=>{
    await expect.poll(()=>viewport.evaluate(node=>{
      const view=node.getBoundingClientRect(),page=node.querySelector('canvas')!.getBoundingClientRect();
      return Math.max(0,page.bottom-view.bottom,view.top-page.top,view.left-page.left,page.right-view.right);
    })).toBeLessThan(2);
    // Move the chat, not the document viewport, until the actual final canvas pixels are on screen.
    await canvas.evaluate(node=>{const chat=document.querySelector('.conversation-scroll')!,box=node.getBoundingClientRect(),view=chat.getBoundingClientRect();chat.scrollTop+=box.bottom-3-(view.top+view.height/2);});
    await expect.poll(()=>canvas.evaluate(node=>{
      const box=node.getBoundingClientRect(),view=document.querySelector('.conversation-scroll')!.getBoundingClientRect(),x=box.left+box.width/2,y=box.bottom-3;
      return y>view.top&&y<view.bottom&&document.elementFromPoint(x,y)===node;
    })).toBe(true);
    expect(await canvas.evaluate((node,old)=>node===old,original)).toBe(true);
    expect(await canvas.evaluate(node=>{const canvas=node as HTMLCanvasElement;return canvas.getContext('2d')!.getImageData(Math.floor(canvas.width/2),canvas.height-3,1,1).data[3];})).toBe(255);
    expect(await viewport.evaluate(node=>node.scrollTop)).toBe(0);
    await expect(preview).toHaveAttribute('data-preview-state','ready');
  };
  await page.getByRole('button',{name:'Fit PDF page',exact:true}).click();
  await expect(preview).toHaveAttribute('data-fit','page');
  await completePage();const defaultHeight=(await canvas.boundingBox())!.height;
  const zoomIn=page.getByRole('button',{name:'Zoom in PDF',exact:true}),zoomOut=page.getByRole('button',{name:'Zoom out PDF',exact:true});
  await expect(zoomIn).toBeDisabled();
  await zoomOut.click();await expect.poll(async()=>(await canvas.boundingBox())!.height).toBeLessThan(defaultHeight-2);await expect(preview).toHaveAttribute('data-preview-state','ready');await completePage();
  const middleHeight=(await canvas.boundingBox())!.height;
  await zoomOut.click();await expect.poll(async()=>(await canvas.boundingBox())!.height).toBeLessThan(middleHeight-2);await expect(preview).toHaveAttribute('data-preview-state','ready');await completePage();await expect(zoomOut).toBeDisabled();
  await zoomIn.click();await zoomIn.click();await expect.poll(async()=>Math.abs((await canvas.boundingBox())!.height-defaultHeight)).toBeLessThan(2);await expect(preview).toHaveAttribute('data-preview-state','ready');await completePage();await expect(zoomIn).toBeDisabled();
  await wheelMovesChat(page,viewport);
});

if(process.env.INLINE_SURFACES_CAPTURE_DIR)test('capture contained schedule and review in light dark and narrow layouts',async({browser})=>{
  const folder=resolve(process.env.INLINE_SURFACES_CAPTURE_DIR!);await mkdir(folder,{recursive:true});
  await writeFile(resolve(folder,'README.md'),'Synthetic intercepted local renderer fixtures, not model generation or calendar/executor effects. Captures show the outer container, shared composer width and natural inline content.\n');
  const captureSchedule={...schedule,slots:[schedule.slots[0],{...schedule.slots[1],availability:'unavailable'},...schedule.slots.slice(0,2).map((slot,index)=>({...slot,id:`alternate-${index}`,start:new Date(Date.parse(slot.start)+86400000).toISOString(),end:new Date(Date.parse(slot.end)+86400000).toISOString()}))]};
  const captureReviews={...reviews,items:[{id:'summary',label:'Opening summary',detail:'A shorter explanation of the checkout repair.'},{id:'compatibility',label:'Compatibility note',detail:'Existing callers keep the same function signature.'},{id:'timing',label:'Publication timing',detail:'Confirm the release window after verification.'}]};
  for(const variant of [{name:'light',width:1440,height:1000,theme:'light'},{name:'dark',width:1440,height:1000,theme:'dark'},{name:'narrow',width:390,height:844,theme:'light'}] as const){
    const page=await browser.newPage({viewport:variant,colorScheme:variant.theme});
    try{const host=await open(page,'SchedulePicker',{dataBinding:'data',stateKey:'view',actionId:'ask'},{data:captureSchedule},false);await expect(page.locator('.schedule-picker')).toBeVisible();await page.getByRole('option').first().click();await expect.poll(()=>host.snapshot.userStates[0].values.view).toMatchObject({selectedId:'slot-0'});await openingView(page);await page.screenshot({path:resolve(folder,`schedule-${variant.name}.png`)});}finally{await page.close();}
    const reviewPage=await browser.newPage({viewport:variant,colorScheme:variant.theme});
    try{await open(reviewPage,'ReviewQueue',{dataBinding:'data',stateKey:'view',actionId:'ask',actionLabel:'Send review'},{data:captureReviews},false);await expect(reviewPage.getByRole('heading',{name:'Opening summary',exact:true})).toBeVisible();await openingView(reviewPage);await reviewPage.screenshot({path:resolve(folder,`review-${variant.name}.png`)});}finally{await reviewPage.close();}
  }
});
