import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

// Explicit renderer fixtures. No source write, publishing or provider execution.
const review={title:'Review the compatibility note',items:[
  {id:'signature',label:'Public signature',detail:'Existing callers keep the same function signature.',evidence:[{label:'Proposed note',value:'The checkout total accepts the existing items argument. No caller changes are required.'}]},
  {id:'empty',label:'Empty basket',detail:'An empty basket returns zero.',evidence:[{label:'Proposed note',value:'An empty basket returns 0 without throwing.'}]},
]};
const parameters={title:'Image adjustments',controls:[
  {id:'quality',label:'Quality',type:'range',min:10,max:100,step:5,value:80},
  {id:'width',label:'Width',type:'number',min:320,max:4096,step:1,value:1600},
  {id:'metadata',label:'Include metadata',type:'boolean',value:false},
  {id:'format',label:'Format',type:'choice',value:'png',options:[{value:'png',label:'PNG'},{value:'webp',label:'WebP'}]},
  {id:'limit',label:'File size limit',type:'number',min:1,max:20,value:null},
]};
async function open(page:Page,type:'ReviewQueue'|'ParameterControls',action?:Parameters<typeof serveTaskFixture>[2]){
  const snapshot=taskFixture({root:'view',elements:{view:{type,props:{dataBinding:'data',stateKey:'draft',actionId:'ask',actionLabel:type==='ReviewQueue'?'Send review':'Apply adjustments'}}}},{data:type==='ReviewQueue'?review:parameters});
  snapshot.artifacts[0].title=type==='ReviewQueue'?review.title:parameters.title;
  const host=await serveTaskFixture(page,snapshot,action);await page.goto('/');
  await expect(page.locator('.interaction-tools')).toBeVisible();return host;
}

test('review puts the supplied material before its compact navigation and decisions',async({page})=>{
  const host=await open(page,'ReviewQueue');
  const material=page.getByText(review.items[0].evidence[0].value,{exact:true});await expect(material).toBeVisible();
  const measure=()=>page.locator('.review-queue-layout').evaluate(node=>{
    const origin=node.getBoundingClientRect(),detail=node.querySelector('.review-item-detail')!.getBoundingClientRect(),material=node.querySelector('.review-item-material')!.getBoundingClientRect(),decisions=node.querySelector('.review-decisions')!.getBoundingClientRect(),nav=node.querySelector('nav')!.getBoundingClientRect();
    const [prev,next]=[...node.querySelectorAll<HTMLElement>('.review-item-pagination button')].map(button=>{const box=button.getBoundingClientRect();return{x:box.x-origin.x,y:box.y-origin.y};});
    return {detailTop:detail.top-origin.top,detailRight:detail.right-origin.left,materialBottom:material.bottom-origin.top,decisionsTop:decisions.top-origin.top,navTop:nav.top-origin.top,navLeft:nav.left-origin.left,prev,next};
  });
  const tools=page.locator('.interaction-tools');
  // Rail layout: nav becomes the right-side column once the inner width clears 720px.
  await tools.evaluate(node=>(node as HTMLElement).style.width='720px');
  const wide=await measure();
  expect(wide.detailRight).toBeLessThanOrEqual(wide.navLeft+1);
  expect(Math.abs(wide.detailTop-wide.navTop)).toBeLessThanOrEqual(1);
  // Previous/Next stay put while the evidence column grows.
  const longEvidence=Array.from({length:40},(_,index)=>`Paragraph ${index+1} of supplied evidence.`).join('\n\n');
  host.setInput('data',{...review,items:[{...review.items[0],evidence:[{label:'Proposed note',value:longEvidence}]},review.items[1]]});await host.publish();
  const grown=await measure();
  await page.getByRole('button',{name:'Next item',exact:true}).click();const onward=await measure();
  await page.getByRole('button',{name:'Previous item',exact:true}).click();const back=await measure();
  for(const sample of [grown,onward,back]){expect(Math.abs(sample.prev.x-wide.prev.x)).toBeLessThanOrEqual(1);expect(Math.abs(sample.prev.y-wide.prev.y)).toBeLessThanOrEqual(1);expect(Math.abs(sample.next.x-wide.next.x)).toBeLessThanOrEqual(1);expect(Math.abs(sample.next.y-wide.next.y)).toBeLessThanOrEqual(1);}
  // Narrow layout: strip stays after the work region and decisions sit beneath material.
  await tools.evaluate(node=>(node as HTMLElement).style.width='600px');
  const narrow=await measure();
  expect(narrow.decisionsTop).toBeGreaterThanOrEqual(narrow.materialBottom-1);expect(narrow.navTop).toBeGreaterThanOrEqual(narrow.decisionsTop);
  expect((await page.getByRole('textbox',{name:'Review comment',exact:true}).boundingBox())!.height).toBeLessThan(75);
});

test('material review keeps decisions, comments, validation and the exact content envelope across reload',async({page})=>{
  const host=await open(page,'ReviewQueue');
  await page.getByRole('radio',{name:'Request changes',exact:true}).check();await page.getByRole('button',{name:'Next item',exact:true}).click();
  await page.getByRole('radio',{name:'Accept',exact:true}).check();await page.getByRole('button',{name:'Send review',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Add a comment'})).toBeVisible();await expect(page.getByText(review.items[0].evidence[0].value,{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Review comment',exact:true}).fill('State which argument remains compatible.');
  await expect.poll(()=>host.snapshot.userStates[0].values.draft).toMatchObject({selectedId:'signature',items:{signature:{decision:'revise',comment:'State which argument remains compatible.'},empty:{decision:'approve'}}});
  await page.reload();await expect(page.getByRole('radio',{name:'Request changes',exact:true})).toBeChecked();await expect(page.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('State which argument remains compatible.');
  await page.getByRole('button',{name:'Send review',exact:true}).click();
  await expect.poll(()=>host.commands.find(command=>command.type==='action.submit')?.payload.payload).toEqual({reviews:[{itemId:'signature',decision:'revise',comment:'State which argument remains compatible.'},{itemId:'empty',decision:'approve',comment:''}]});
  expect(host.commands.some(command=>command.type==='operation.approve')).toBe(false);
});

test('parameter adjustments expose a precise source to draft proposal and reset only the chosen change',async({page})=>{
  const host=await open(page,'ParameterControls');
  const quality=page.getByRole('slider',{name:'Quality',exact:true});await quality.focus();await page.keyboard.press('ArrowRight');
  await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');
  const proposal=page.getByRole('region',{name:'Changes to apply',exact:true});await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Quality');await expect(proposal).toContainText('80');await expect(proposal).toContainText('85');await expect(proposal).toContainText('1600');await expect(proposal).toContainText('1920');
  await page.getByRole('button',{name:'Reset Quality',exact:true}).click();await expect(quality).toHaveValue('80');await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1920');
  await expect.poll(()=>host.snapshot.userStates[0].values.draft).toMatchObject({values:{width:'1920'}});await page.reload();await expect(quality).toHaveValue('80');await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1920');
  await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();await expect.poll(()=>host.commands.find(command=>command.type==='action.submit')?.payload.payload).toEqual({values:{quality:80,width:1920,metadata:false,format:'png',limit:null}});
  expect(host.snapshot.data[0].value).toEqual(parameters);
});

test('invalid adjustment proposals stay editable and show the failed constraint without sending',async({page})=>{
  const host=await open(page,'ParameterControls');await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('100');
  await expect(page.getByRole('region',{name:'Changes to apply',exact:true})).toContainText('Minimum 320');
  await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Minimum 320'})).toBeVisible();
  expect(host.commands.some(command=>command.type==='action.submit')).toBe(false);await page.reload();await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('100');
});

test('a pending review keeps its clicked action and material mounted through snapshot refresh',async({page})=>{
  let release!:()=>void;const accepted=new Promise<void>(resolve=>{release=resolve;});
  const host=await open(page,'ReviewQueue',async()=>{await accepted;return {};});
  await page.getByRole('radio',{name:'Accept',exact:true}).check();await page.getByRole('button',{name:'Next item',exact:true}).click();await page.getByRole('radio',{name:'Defer',exact:true}).check();
  const button=page.getByRole('button',{name:'Send review',exact:true});const original=await button.elementHandle();
  await button.click();await expect(page.getByRole('button',{name:'Sending…',exact:true})).toBeDisabled();await host.publish();
  expect(await page.getByRole('button',{name:'Sending…',exact:true}).evaluate((node,old)=>node===old,original)).toBe(true);await expect(page.getByText(review.items[1].evidence[0].value,{exact:true})).toBeVisible();
  release();await expect(page.getByRole('status').filter({hasText:'Review submitted'})).toHaveCount(1);await expect(button).toBeDisabled();expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(1);
});

test('a rejected adjustment visibly preserves its exact draft and supports an explicit retry',async({page})=>{
  const host=await open(page,'ParameterControls');let reject=true;
  await page.route('**/api/commands',async route=>{if(reject&&route.request().postDataJSON().type==='action.submit')return route.fulfill({status:409,json:{error:{code:'STALE_ACTION',message:'The source changed. Review the current values before applying.'}}});await route.fallback();});
  await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'The source changed'})).toBeVisible();await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1920');await expect(page.getByRole('region',{name:'Changes to apply',exact:true})).toContainText('1920');
  reject=false;await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();await expect.poll(()=>host.commands.find(command=>command.type==='action.submit')?.payload.payload).toMatchObject({values:{width:1920}});
});

test('an export proposal cannot stretch its source image',async({page})=>{
  const snapshot=taskFixture({root:'pair',elements:{pair:{type:'Split',props:{ratio:.56,gap:'md'},children:['source','parameters']},source:{type:'Image',props:{resourceId:'before-image',alt:'Source image for the export proposal'}},parameters:{type:'ParameterControls',props:{dataBinding:'data',stateKey:'draft',actionId:'ask'}}}},{data:parameters});
  await serveTaskFixture(page,snapshot);
  await page.route('**/api/resources/before-image/content',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="#8899aa"/></svg>'}));
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  const pair=page.locator('.parameter-preview-pair'),image=pair.locator('.parameter-source-figure .surface-image'),region=page.locator('.parameter-proposal-region'),width=page.getByRole('spinbutton',{name:'Width',exact:true});
  await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(960);await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalHeight)).toBe(600);
  await pair.evaluate(node=>(node as HTMLElement).style.width='700px');await pair.scrollIntoViewIfNeeded();
  const scroller=page.locator('.conversation-scroll');await scroller.evaluate(node=>{node.scrollTop=0;});
  const measure=async()=>({image:await image.boundingBox(),control:await width.boundingBox(),scroll:await scroller.evaluate(node=>node.scrollTop)});
  await width.focus();const before=await measure();
  await width.fill('1920');const mid=await measure();
  await expect(region).toHaveAttribute('data-motion-phase','open');const after=await measure();
  for(const sample of [mid,after])for(const key of ['x','y','width','height'] as const)expect(Math.abs(sample.image![key]-before.image![key])).toBeLessThanOrEqual(1);
  for(const sample of [mid,after])expect(Math.abs(sample.scroll-before.scroll)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.image!.height-after.image!.width*600/960)).toBeLessThanOrEqual(1);
  expect(await width.evaluate(node=>node===document.activeElement)).toBe(true);
  const src=await image.getAttribute('src');const reset=page.getByRole('button',{name:'Reset Width',exact:true});
  await reset.dispatchEvent('click');
  await expect(width).toHaveValue('1600');await expect(width).toBeFocused();
  await expect.poll(async()=>region.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await expect(region).toHaveAttribute('inert','');await expect(image).toHaveAttribute('src',src!);
  const settled=await measure();expect(Math.abs(settled.image!.x-before.image!.x)).toBeLessThanOrEqual(1);expect(Math.abs(settled.scroll-before.scroll)).toBeLessThanOrEqual(1);
  // a second opening reversed mid-close continues from the displayed height, never from zero
  await width.fill('1920');await expect(region).toHaveAttribute('data-motion-phase','open');
  await reset.dispatchEvent('click');await expect.poll(()=>region.getAttribute('data-motion-phase')).toBe('closing');
  const midClose=await region.evaluate(node=>node.getBoundingClientRect().height);
  await width.fill('1920');const reopened=await region.evaluate(node=>node.getBoundingClientRect().height);
  expect(midClose>2?reopened>0&&reopened<=midClose+8:true).toBe(true);
  await reset.dispatchEvent('click');await expect.poll(async()=>region.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  // narrow: one column, image fully above the first control, exact aspect
  for(const bounds of [{viewport:{width:390,height:844},pair:''},{viewport:{width:1440,height:1000},pair:'500px'}]){
    await page.setViewportSize(bounds.viewport);await pair.evaluate((node,w)=>(node as HTMLElement).style.width=w,bounds.pair);await pair.scrollIntoViewIfNeeded();
    const geometry=await pair.evaluate(node=>{const box=node.getBoundingClientRect(),img=node.querySelector('img')!.getBoundingClientRect(),first=node.querySelector<HTMLElement>('[data-parameter-id] input:not(:disabled),[data-parameter-id] button:not(:disabled)')!.getBoundingClientRect(),inside=[...node.querySelectorAll<HTMLElement>('.parameter-preview-columns>*')].every(child=>{const r=child.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1;});return{imgBottom:img.bottom,firstTop:first.top,inside,aspect:Math.abs(img.height-img.width*600/960)};});
    expect(geometry.imgBottom).toBeLessThanOrEqual(geometry.firstTop+1);expect(geometry.inside).toBe(true);expect(geometry.aspect).toBeLessThanOrEqual(1);
  }
  // reduced and off: no moving proposal height
  for(const policy of ['reduced','off']){
    await page.evaluate(mode=>{document.documentElement.dataset.motion=mode;},policy);
    await width.fill('1920');await expect(region).toHaveAttribute('data-motion-phase','open');
    const h1=await region.evaluate(node=>node.getBoundingClientRect().height);await page.waitForTimeout(80);const h2=await region.evaluate(node=>node.getBoundingClientRect().height);
    expect(h2).toBe(h1);await reset.dispatchEvent('click');await expect.poll(async()=>region.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  }
});

test('an ordinary two-child split keeps its own columns without the pairing wrapper',async({page})=>{
  const snapshot=taskFixture({root:'pair',elements:{pair:{type:'Split',props:{ratio:.5},children:['left','right']},left:{type:'Text',props:{text:'Left column'}},right:{type:'Text',props:{text:'Right column'}}}});
  await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.locator('.parameter-preview-pair')).toHaveCount(0);
  await expect(page.locator('.surface-split')).toHaveCount(1);await expect(page.getByText('Left column',{exact:true})).toBeVisible();
});

for(const type of ['ReviewQueue','ParameterControls'] as const)test(`${type} is neutral, keyboard accessible and grows inside chat on a narrow view`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,type);
  if(type==='ReviewQueue'){const radio=page.getByRole('radio',{name:'Defer',exact:true});await radio.focus();await page.keyboard.press('Space');await expect(radio).toBeChecked();}
  else{await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');await page.getByRole('button',{name:'Reset Width',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1600');}
  const neutral=await page.locator(type==='ReviewQueue'?'.review-decision-choice[data-selected=true]':'.parameter-list').evaluate(node=>{const rgb=getComputedStyle(node).backgroundColor.match(/[\d.]+/g)!.slice(0,3).map(Number);return Math.max(...rgb)-Math.min(...rgb);});expect(neutral).toBeLessThanOrEqual(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const inner=await page.locator('.interaction-tools').evaluate(node=>Array.from(node.querySelectorAll('*')).filter(child=>['auto','scroll'].includes(getComputedStyle(child).overflowY)&&child.scrollHeight>child.clientHeight+1).length);expect(inner).toBe(0);
});
