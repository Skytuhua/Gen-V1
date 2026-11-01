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
  await open(page,'ReviewQueue');
  const material=page.getByText(review.items[0].evidence[0].value,{exact:true});await expect(material).toBeVisible();
  const geometry=await page.locator('.review-queue-layout').evaluate(node=>{
    const material=node.querySelector('.review-item-material')!.getBoundingClientRect(),decisions=node.querySelector('.review-decisions')!.getBoundingClientRect(),nav=node.querySelector('nav')!.getBoundingClientRect();
    return {materialBottom:material.bottom,decisionsTop:decisions.top,navTop:nav.top,bodyTop:material.top};
  });
  expect(geometry.decisionsTop).toBeGreaterThanOrEqual(geometry.materialBottom-1);expect(geometry.navTop).toBeGreaterThan(geometry.decisionsTop);
  expect((await page.getByRole('textbox',{name:'Review comment',exact:true}).boundingBox())!.height).toBeLessThan(75);
});

test('material review keeps decisions, comments, validation and the exact content envelope across reload',async({page})=>{
  const host=await open(page,'ReviewQueue');
  await page.getByRole('radio',{name:'Request changes',exact:true}).check();await page.getByRole('button',{name:'Next item',exact:true}).click();
  await page.getByRole('radio',{name:'Accept',exact:true}).check();await page.getByRole('button',{name:'Send review',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Add a comment');await expect(page.getByText(review.items[0].evidence[0].value,{exact:true})).toBeVisible();
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
  await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Minimum 320');
  expect(host.commands.some(command=>command.type==='action.submit')).toBe(false);await page.reload();await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('100');
});

test('a pending review keeps its clicked action and material mounted through snapshot refresh',async({page})=>{
  let release!:()=>void;const accepted=new Promise<void>(resolve=>{release=resolve;});
  const host=await open(page,'ReviewQueue',async()=>{await accepted;return {};});
  await page.getByRole('radio',{name:'Accept',exact:true}).check();await page.getByRole('button',{name:'Next item',exact:true}).click();await page.getByRole('radio',{name:'Defer',exact:true}).check();
  const button=page.getByRole('button',{name:'Send review',exact:true});const original=await button.elementHandle();
  await button.click();await expect(page.getByRole('button',{name:'Sending…',exact:true})).toBeDisabled();await host.publish();
  expect(await page.getByRole('button',{name:'Sending…',exact:true}).evaluate((node,old)=>node===old,original)).toBe(true);await expect(page.getByText(review.items[1].evidence[0].value,{exact:true})).toBeVisible();
  release();await expect(button).toBeEnabled();expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(1);
});

test('a rejected adjustment visibly preserves its exact draft and supports an explicit retry',async({page})=>{
  const host=await open(page,'ParameterControls');let reject=true;
  await page.route('**/api/commands',async route=>{if(reject&&route.request().postDataJSON().type==='action.submit')return route.fulfill({status:409,json:{error:{code:'STALE_ACTION',message:'The source changed. Review the current values before applying.'}}});await route.fallback();});
  await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('The source changed');await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1920');await expect(page.getByRole('region',{name:'Changes to apply',exact:true})).toContainText('1920');
  reject=false;await page.getByRole('button',{name:'Apply adjustments',exact:true}).click();await expect.poll(()=>host.commands.find(command=>command.type==='action.submit')?.payload.payload).toMatchObject({values:{width:1920}});
});

for(const type of ['ReviewQueue','ParameterControls'] as const)test(`${type} is neutral, keyboard accessible and grows inside chat on a narrow view`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,type);
  if(type==='ReviewQueue'){const radio=page.getByRole('radio',{name:'Defer',exact:true});await radio.focus();await page.keyboard.press('Space');await expect(radio).toBeChecked();}
  else{await page.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');await page.getByRole('button',{name:'Reset Width',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1600');}
  const neutral=await page.locator(type==='ReviewQueue'?'.review-decision-choice[data-selected=true]':'.parameter-list').evaluate(node=>{const rgb=getComputedStyle(node).backgroundColor.match(/[\d.]+/g)!.slice(0,3).map(Number);return Math.max(...rgb)-Math.min(...rgb);});expect(neutral).toBeLessThanOrEqual(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const inner=await page.locator('.interaction-tools').evaluate(node=>Array.from(node.querySelectorAll('*')).filter(child=>['auto','scroll'].includes(getComputedStyle(child).overflowY)&&child.scrollHeight>child.clientHeight+1).length);expect(inner).toBe(0);
});
