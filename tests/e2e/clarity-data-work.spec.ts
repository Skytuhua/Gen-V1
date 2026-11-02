import {test,expect} from '@playwright/test';
import {serveTaskFixture,taskFixture,type TaskSpec} from './task-interface-fixture';
import {WORK_OBJECT_REVIEW_DATA} from '../../scripts/work-object-review-data';

const one=(type:string):TaskSpec=>({root:'object',elements:{object:{type,props:{dataBinding:'source',stateKey:'choice'}}}});
test('trend gives its actual scale and units without hiding gaps or fabricating a zero baseline',async({page})=>{
 const data={title:'Request latency',metrics:[{id:'latency',label:'Response time',value:184,unit:'ms',series:[{label:'Mon',value:210},{label:'Tue',value:null},{label:'Wed',value:184}]}]};
 await serveTaskFixture(page,taskFixture(one('Stats'),{source:data}));await page.goto('/');
 const scale=page.getByRole('group',{name:'Trend scale',exact:true});await expect(scale).toBeVisible();await expect(scale).toContainText('210 ms');await expect(scale).toContainText('184 ms');await expect(scale.getByText('0 ms',{exact:true})).toHaveCount(0);
 const path=await page.locator('.everyday-trend-line').getAttribute('d');expect(path?.match(/M/g)).toHaveLength(2);
 await expect(page.locator('.everyday-trend-point')).toHaveCount(2);
 await page.getByText('View source values',{exact:true}).click();await expect(page.getByRole('row',{name:'Tue Unavailable',exact:true})).toBeVisible();
});
test('flat and unavailable trends describe only supplied values',async({page})=>{
 const data={metrics:[{id:'flat',label:'Response time',value:184,unit:'ms',series:[{label:'Mon',value:184},{label:'Tue',value:184}]}]};
 const host=await serveTaskFixture(page,taskFixture(one('Stats'),{source:data}));await page.goto('/');const scale=page.getByRole('group',{name:'Trend scale',exact:true});await expect(scale).toHaveText('184 ms');
 host.setInput('source',{metrics:[{...data.metrics[0],value:null,series:[{label:'Mon',value:null},{label:'Tue',value:null}]}]});await host.publish();await expect(page.getByText('Trend unavailable',{exact:true})).toBeVisible();await expect(scale).toHaveCount(0);await expect(page.locator('.everyday-trend')).not.toContainText(/Infinity|NaN/);
});
for(const {width,theme} of [{width:1440,theme:'light'},{width:390,theme:'light'},{width:1440,theme:'dark'}] as const)test(`trend periods align with their plotted values at ${width}px ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const snapshot=taskFixture(one('Stats'),{source:{metrics:[{id:'latency',label:'Response time',value:184,unit:'ms',series:[{label:'Mon',value:210},{label:'Fri',value:184}]}]}});snapshot.settings.theme=theme;await serveTaskFixture(page,snapshot);await page.goto('/');
 const points=page.locator('.everyday-trend-point'),labels=page.locator('.everyday-trend-labels span');await expect(points).toHaveCount(2);
 const first=(await points.first().boundingBox())!,last=(await points.last().boundingBox())!,start=(await labels.first().boundingBox())!,end=(await labels.last().boundingBox())!;
 expect(Math.abs(first.x+first.width/2-start.x)).toBeLessThan(3);expect(Math.abs(last.x+last.width/2-(end.x+end.width))).toBeLessThan(3);
 if(theme==='dark')await page.screenshot({path:'docs/evidence/ui-clarity-20261031/stats-dark-confirm.png'});
});
for(const theme of ['light','dark']as const)test(`${theme} architecture is legible before selecting a node`,async({page})=>{
 const snapshot=taskFixture(one('ArchitectureCanvas'),{source:WORK_OBJECT_REVIEW_DATA.architecture});snapshot.settings.theme=theme;await serveTaskFixture(page,snapshot);await page.goto('/');
 const node=page.locator('.architecture-node strong').first();await expect(node).toBeVisible();expect(await node.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
 const edge=page.locator('.architecture-edge').first();expect(await edge.evaluate(node=>Number(getComputedStyle(node).opacity))).toBe(1);
 await page.getByRole('button',{name:'Document preview',exact:true}).click();await expect(page.getByRole('button',{name:'Document preview',exact:true})).toHaveAttribute('aria-pressed','true');await page.reload();await expect(page.getByRole('button',{name:'Document preview',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('save feedback reserves its checkmark for acknowledged saves',async({page})=>{
 const snapshot=taskFixture({root:'name',elements:{name:{type:'Input',props:{stateKey:'name',label:'Name'}}}},{},{name:'Alex'});
 await serveTaskFixture(page,snapshot);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{if(route.request().postDataJSON().type==='state.save')await gate;return route.fallback();});
 await page.goto('/');const status=page.locator('.artifact .save-state');await expect(status).toHaveText('Saved');await page.getByRole('textbox',{name:'Name',exact:true}).fill('Jordan');
 await expect(status).toHaveAttribute('data-save-state','pending');await expect(status.locator('.lucide-check')).toHaveCount(0);
 await expect(status).toHaveAttribute('data-save-state','saving');await expect(status.locator('.lucide-check')).toHaveCount(0);release();await expect(status).toHaveAttribute('data-save-state','saved');await expect(status.locator('.lucide-check')).toBeVisible();
});
