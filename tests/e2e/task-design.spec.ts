import {test,expect} from '@playwright/test';
import {serveTaskFixture,taskFixture,type TaskSpec,linkedMapSpec,linkedMapData} from './task-interface-fixture';

const metrics={title:'Request latency',period:'Past five days',metrics:[{id:'latency',label:'Response time',value:184,unit:'ms',series:[{label:'Mon',value:210},{label:'Tue',value:205},{label:'Wed',value:null},{label:'Thu',value:190},{label:'Fri',value:184}]},{id:'requests',label:'Requests',value:1280}]};
const choices={criteria:[{id:'price',label:'Monthly price',unit:'credits'},{id:'capacity',label:'Project slots'}],options:[{id:'small',label:'Starter',values:{price:12,capacity:1}},{id:'large',label:'Team',values:{price:28,capacity:6}}]};
const spec:TaskSpec={root:'root',elements:{root:{type:'Stack',props:{gap:'md'},children:['choice','comparison']},choice:{type:'ChoiceList',props:{stateKey:'choice',label:'Delivery',options:[{value:'local',label:'Local export'},{value:'review',label:'Review here'}]}},comparison:{type:'Comparison',props:{dataBinding:'plans',stateKey:'plan'}}}};

for(const theme of ['light','dark'] as const)test(`${theme} selections are neutral while keyboard focus remains visible`,async({page})=>{
 const snapshot=taskFixture(spec,{plans:choices},{choice:'local'});snapshot.settings.theme=theme;
 await serveTaskFixture(page,snapshot);await page.goto('/');
 const selected=page.locator('.task-choice.is-selected');await expect(selected).toBeVisible();
 const appearance=await selected.evaluate(node=>{const rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number);return {background:rgb(getComputedStyle(node).backgroundColor),border:rgb(getComputedStyle(node).borderTopColor),canvas:rgb(getComputedStyle(document.body).backgroundColor)};});
 for(const color of [appearance.background,appearance.border,appearance.canvas])expect(Math.max(...color)-Math.min(...color)).toBeLessThanOrEqual(2);
 if(theme==='dark')expect(appearance.canvas).toEqual([0,0,0]);
 const selectedColumn=page.locator('.everyday-comparison-table td.is-selected').first();const color=await selectedColumn.evaluate(node=>getComputedStyle(node).backgroundColor.match(/\d+/g)!.slice(0,3).map(Number));expect(Math.max(...color)-Math.min(...color)).toBeLessThanOrEqual(2);
 await selected.focus();const outline=await selected.evaluate(node=>({width:parseFloat(getComputedStyle(node).outlineWidth),style:getComputedStyle(node).outlineStyle}));expect(outline.width).toBeGreaterThanOrEqual(2);expect(outline.style).not.toBe('none');
});

test('statistics lead with the selected trend without repeating measurements in navigation',async({page})=>{
 const snapshot=taskFixture({root:'stats',elements:{stats:{type:'Stats',props:{dataBinding:'metrics',stateKey:'metric'}}}},{metrics});const host=await serveTaskFixture(page,snapshot);await page.goto('/');
 await expect(page.getByRole('region',{name:'Selected statistic',exact:true})).toContainText('184');
 await expect(page.getByRole('tablist',{name:'Statistics',exact:true})).not.toContainText('184');
 await expect(page.getByRole('img',{name:'Response time trend',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Requests',exact:true}).click();await expect.poll(()=>host.snapshot.userStates[0].values.metric).toBe('requests');
 await host.publish();await page.reload();await expect(page.getByRole('tab',{name:'Requests',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('region',{name:'Selected statistic',exact:true})).toContainText('1,280');
});

test('route geometry stays legible on the night map without a blue surface wash',async({page})=>{
 await serveTaskFixture(page,taskFixture(linkedMapSpec,{places:linkedMapData},{mapTheme:'night'}));await page.goto('/');await expect(page.locator('.task-map-route')).toBeVisible();
 const colors=await page.locator('.task-map').evaluate(node=>({route:getComputedStyle(node.querySelector('.task-map-route')!).stroke,land:getComputedStyle(node.querySelector('.map-land')!).fill,park:getComputedStyle(node.querySelector('.map-park')!).fill}));
 const luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(value=>{const x=Number(value)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const ink=luminance(colors.route);for(const background of [colors.land,colors.park]){const base=luminance(background);expect((Math.max(ink,base)+.05)/(Math.min(ink,base)+.05)).toBeGreaterThanOrEqual(3);}
});

test('an image keeps its native proportions beside taller adjustment controls',async({page})=>{
 const spec:TaskSpec={root:'pair',elements:{pair:{type:'Split',props:{ratio:.55,gap:'md'},children:['image','parameters']},image:{type:'Image',props:{resourceId:'source',alt:'Original image'}},parameters:{type:'ParameterControls',props:{dataBinding:'parameters',stateKey:'draft'}}}};
 await serveTaskFixture(page,taskFixture(spec,{parameters:{controls:Array.from({length:8},(_,index)=>({id:`size${index}`,label:`Dimension ${index+1}`,type:'number',value:1600,min:640,max:3840}))}}));
 await page.route('**/api/resources/source/content',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#888"/></svg>'}));await page.goto('/');const image=page.getByAltText('Original image');
 await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(960);
 const box=(await image.boundingBox())!;expect(box.width/box.height).toBeCloseTo(960/600,2);
});

test('unclassified chart and progress data use neutral ink rather than an action color',async({page})=>{
 const spec:TaskSpec={root:'data',elements:{data:{type:'Stack',props:{},children:['chart','progress']},chart:{type:'Chart',props:{kind:'bar',rowsBinding:'rows',xKey:'name',yKey:'value'}},progress:{type:'Progress',props:{dataBinding:'progress',max:10}}}};
 await serveTaskFixture(page,taskFixture(spec,{rows:[{name:'Before',value:3},{name:'After',value:8}],progress:6}));await page.goto('/');await expect(page.locator('.chart rect').first()).toBeVisible();
 const colors=await page.locator('.chart rect').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).fill));
 for(const value of colors){const rgb=value.match(/[\d.]+/g)!.slice(0,3).map(Number);expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThanOrEqual(2);}
});
