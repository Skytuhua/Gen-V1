import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture,type TaskSpec} from './task-interface-fixture';

async function open(page:Page,type:string,data:unknown){
 const spec:TaskSpec={root:'view',elements:{view:{type,props:{dataBinding:'data',stateKey:'selection',...(type==='RelationshipGraph'?{orientation:'horizontal',label:'Release dependencies'}:{})}}}};
 const snapshot=taskFixture(spec,{data}),host=await serveTaskFixture(page,snapshot);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');return {snapshot,host};
}
async function fits(page:Page,area:string,nodes:string){
 await expect.poll(()=>page.locator(area).evaluate((element,selector)=>{
  const bounds=element.getBoundingClientRect();let escape=0;
  for(const child of element.querySelectorAll(selector)){const box=child.getBoundingClientRect();escape=Math.max(escape,bounds.left-box.left,box.right-bounds.right);}
  return Math.max(escape,element.scrollWidth-element.clientWidth,element.scrollHeight-element.clientHeight);
 },nodes)).toBeLessThanOrEqual(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
}

test('inline horizontal history wraps complete readable nodes and preserves selection through resize',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page,'RelationshipGraph',{nodes:Array.from({length:12},(_,i)=>({id:`node-${i}`,label:`Change ${i+1}`,lane:i%2,column:i})),edges:Array.from({length:11},(_,i)=>({from:`node-${i}`,to:`node-${i+1}`}))});
 const node=page.locator('[data-node-id="node-11"]');await expect(node).toBeAttached();await fits(page,'.task-graph-viewport','[data-node-id]');
 await node.click();const original=await node.elementHandle();await page.setViewportSize({width:1440,height:1000});await fits(page,'.task-graph-viewport','[data-node-id]');expect(await node.evaluate((current,old)=>current===old,original)).toBe(true);
  await expect(node.getByRole('button')).toHaveAttribute('aria-pressed','true');
});

test('inline architecture reflows its complete layers without clipping or shrinking readable nodes',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page,'ArchitectureCanvas',{revision:'a1',layers:Array.from({length:6},(_,i)=>({id:`layer-${i}`,label:`Layer ${i+1}`})),nodes:Array.from({length:12},(_,i)=>({id:`node-${i}`,layerId:`layer-${Math.floor(i/2)}`,label:`Service ${i+1}`,kind:'service'})),edges:Array.from({length:11},(_,i)=>({from:`node-${i}`,to:`node-${i+1}`}))});
 const node=page.getByRole('button',{name:'Service 12',exact:true});await expect(node).toBeAttached();await fits(page,'.architecture-scroll','[data-architecture-node]');expect((await node.boundingBox())!.width).toBeGreaterThanOrEqual(140);
 await node.click();const original=await node.elementHandle();await page.setViewportSize({width:1440,height:1000});await fits(page,'.architecture-scroll','[data-architecture-node]');expect(await node.evaluate((current,old)=>current===old,original)).toBe(true);await expect(node).toHaveAttribute('aria-pressed','true');
});

test('inline workflow lanes wrap without an inner scroll area',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page,'WorkflowBoard',{revision:'b1',lanes:Array.from({length:6},(_,i)=>({id:`lane-${i}`,label:`Lane ${i+1}`})),cards:Array.from({length:12},(_,i)=>({id:`card-${i}`,laneId:`lane-${i%6}`,title:`Task ${i+1}`}))});
 await expect(page.getByRole('button',{name:'Task 12',exact:true})).toBeAttached();await fits(page,'.workflow-lanes-scroll','.workflow-lane');
 await page.getByRole('button',{name:'Task 12',exact:true}).click();await page.getByRole('combobox',{name:'Move selected card'}).selectOption('lane-0');await expect(page.getByRole('region',{name:'Lane 1',exact:true})).toContainText('Task 12');
});

test('inline trace fits labels and all tracks instead of trapping scroll or exposing overflow zoom',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {snapshot,host}=await open(page,'TraceWaterfall',{revision:'t1',spans:Array.from({length:24},(_,i)=>({id:`span-${i}`,name:`Span ${i+1}`,status:'ok',startMs:i*3,durationMs:30}))});
 await expect(page.getByRole('treeitem',{name:'Span 24',exact:true})).toBeAttached();await fits(page,'.trace-scroll','.trace-span');await expect(page.getByRole('combobox',{name:'Timeline zoom'})).toHaveCount(0);
 await page.getByRole('treeitem',{name:'Span 24',exact:true}).click();await page.reload();await expect(page.getByRole('treeitem',{name:'Span 24',exact:true})).toHaveAttribute('aria-selected','true');
 snapshot.artifacts[0].placement='expanded';await host.publish();await page.getByRole('combobox',{name:'Timeline zoom'}).selectOption('4');await expect.poll(()=>snapshot.userStates[0].values.selection).toMatchObject({zoom:4,selectedId:'span-23'});
 snapshot.artifacts[0].placement='inline';await host.publish();await fits(page,'.trace-scroll','.trace-span');await expect(page.getByRole('combobox',{name:'Timeline zoom'})).toHaveCount(0);expect(snapshot.userStates[0].values.selection).toMatchObject({zoom:4});
});
