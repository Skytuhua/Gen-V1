import {test,expect,type Page} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {taskFixture,serveTaskFixture,type TaskSpec} from './task-interface-fixture';

const suppliedBoard={revision:'board-7',title:'Release preparation',lanes:[{id:'ready',label:'Ready'},{id:'review',label:'In review'},{id:'done',label:'Prepared'}],cards:[{id:'retry',laneId:'ready',title:'Keep retries ordered',detail:'Review queue ordering before the release.',tag:'Runtime',owner:'Mira'},{id:'grant',laneId:'ready',title:'Bound document grants',tag:'Security',owner:'Jules'},{id:'notes',laneId:'review',title:'Prepare migration notes',tag:'Docs',owner:'Sam'}]};
const suppliedGraph={revision:'architecture-2',title:'Document processing path',layers:[{id:'experience',label:'Experience'},{id:'boundary',label:'Boundary'},{id:'storage',label:'Storage'}],nodes:[{id:'preview',layerId:'experience',label:'Document preview',kind:'client',detail:'Shows the granted document.',facts:[{label:'Input',value:'Granted resource ID'}]},{id:'parser',layerId:'boundary',label:'Bounded parser',kind:'service',detail:'Parses only the supplied resource.'},{id:'queue',layerId:'boundary',label:'Draft queue',kind:'queue'},{id:'files',layerId:'storage',label:'Resource store',kind:'store',detail:'Retains the supplied source bytes.'}],edges:[{from:'preview',to:'parser',label:'Preview request'},{from:'parser',to:'files',label:'Resource read'},{from:'queue',to:'files',label:'Draft storage'}]};
const suppliedTrace={revision:'trace-4',title:'Import request',spans:[{id:'request',name:'Import request',service:'gateway',status:'ok',startMs:0,durationMs:240},{id:'grant',parentId:'request',name:'Validate grant',service:'gateway',status:'ok',startMs:12,durationMs:32},{id:'parse',parentId:'request',name:'Parse document',service:'worker',status:'error',startMs:48,durationMs:170,detail:'The supplied record reports a page limit failure.'},{id:'fetch',parentId:'parse',name:'Read source bytes',service:'storage',status:'ok',startMs:58,durationMs:65},{id:'unknown',parentId:'request',name:'Legacy adapter',service:'adapter',status:'unknown'}]};
async function fixture(page:Page,kind:'WorkflowBoard'|'ArchitectureCanvas'|'TraceWaterfall',data:unknown,values:Record<string,unknown>={},action?:Parameters<typeof serveTaskFixture>[2]){
 const snapshot=taskFixture({root:'view',elements:{view:{type:kind,props:{dataBinding:'data',stateKey:'view',actionId:'ask'}}}} as TaskSpec,{data},values);
 return {snapshot,host:await serveTaskFixture(page,snapshot,action)};
}
test('board keyboard moves are immediate, durable and submit only an explicit proposal',async({page})=>{
 const {host}=await fixture(page,'WorkflowBoard',suppliedBoard);await page.goto('/');const card=page.getByRole('button',{name:'Keep retries ordered',exact:true});await card.click();await card.press('Alt+ArrowRight');await expect(page.getByRole('region',{name:'In review',exact:true})).toContainText('Keep retries ordered');
 await expect.poll(()=>(host.snapshot.userStates[0].values.view as any)?.placements?.find((row:any)=>row.cardId==='retry')?.laneId).toBe('review');await page.reload();await expect(page.getByRole('region',{name:'In review',exact:true})).toContainText('Keep retries ordered');await page.getByRole('button',{name:'Send move proposal',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
 expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({sourceRevision:'board-7',moves:[{cardId:'retry',fromLaneId:'ready',toLaneId:'review'}]});expect(host.commands.some(command=>command.type.startsWith('operation.'))).toBe(false);await expect(page.getByText('1 local move',{exact:true})).toBeVisible();
});
test('board pointer drop moves a card and changed or removed source cards cannot submit',async({page})=>{
 const {host}=await fixture(page,'WorkflowBoard',suppliedBoard);await page.goto('/');await page.locator('[data-work-card="grant"]').dragTo(page.getByRole('region',{name:'Prepared',exact:true}));await expect(page.getByRole('region',{name:'Prepared',exact:true})).toContainText('Bound document grants');
 host.setInput('data',{...suppliedBoard,revision:'board-8',cards:suppliedBoard.cards.filter(card=>card.id!=='grant')});await host.publish();await expect(page.getByRole('button',{name:'Send move proposal',exact:true})).toBeDisabled();await expect(page.getByText('The source changed. Reset the local draft before proposing moves.',{exact:true})).toBeVisible();expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});
test('board reset keeps the original source draft recoverable when that revision returns',async({page})=>{
 const {host}=await fixture(page,'WorkflowBoard',suppliedBoard);await page.goto('/');await page.getByRole('button',{name:'Keep retries ordered',exact:true}).click();await page.getByRole('combobox',{name:'Move selected card',exact:true}).selectOption('review');
 host.setInput('data',{...suppliedBoard,revision:'board-8'});await host.publish();await page.getByRole('button',{name:'Reset to source',exact:true}).click();await expect.poll(()=>(host.snapshot.userStates[0].values.view as any)?.previous?.sourceRevision).toBe('board-7');
 host.setInput('data',suppliedBoard);await host.publish();await expect(page.getByRole('region',{name:'In review',exact:true})).toContainText('Keep retries ordered');await expect(page.getByRole('button',{name:'Send move proposal',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Send move proposal',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);expect((host.commands.find(command=>command.type==='action.submit')!.payload.payload as any).sourceRevision).toBe('board-7');
});
test('architecture keeps node selection and neighbor context attached to the supplied graph',async({page})=>{
 const {host}=await fixture(page,'ArchitectureCanvas',suppliedGraph);await page.goto('/');await page.getByRole('button',{name:'Bounded parser',exact:true}).click();await expect(page.locator('.architecture-detail')).toContainText('Parses only the supplied resource.');await page.getByRole('button',{name:'Focus neighbors',exact:true}).click();await expect(page.locator('[data-architecture-node="queue"]')).toHaveAttribute('data-dimmed','true');await page.reload();await expect(page.getByRole('button',{name:'Bounded parser',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Focus neighbors',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Ask about node',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({sourceRevision:'architecture-2',nodeId:'parser'});
 host.setInput('data',{...suppliedGraph,revision:'architecture-new'});await host.publish();await page.getByRole('button',{name:'Focus neighbors',exact:true}).click();await expect(page.getByRole('button',{name:'Ask about node',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Bounded parser',exact:true}).click();await expect(page.getByRole('button',{name:'Ask about node',exact:true})).toBeEnabled();
 host.setInput('data',{...suppliedGraph,revision:'architecture-3',nodes:suppliedGraph.nodes.filter(node=>node.id!=='parser'),edges:suppliedGraph.edges.filter(edge=>edge.from!=='parser'&&edge.to!=='parser')});await host.publish();await expect(page.getByRole('button',{name:'Ask about node',exact:true})).toBeDisabled();await expect(page.locator('.architecture-detail')).toHaveCount(0);
});
test('trace preserves real hierarchy, filters, zoom and honest unavailable timing through reload',async({page})=>{
 const {snapshot,host}=await fixture(page,'TraceWaterfall',suppliedTrace);snapshot.artifacts[0].placement='expanded';await page.goto('/');const unknown=page.getByRole('treeitem',{name:'Legacy adapter',exact:true});await unknown.click();await expect(page.locator('.trace-detail')).toContainText('Timing unavailable');await expect(unknown.locator('.trace-bar')).toHaveCount(0);await page.getByRole('combobox',{name:'Timeline zoom',exact:true}).selectOption('2');await page.getByRole('searchbox',{name:'Filter spans',exact:true}).fill('Legacy');await expect(page.getByRole('treeitem')).toHaveCount(2);await page.reload();await expect(page.getByRole('searchbox',{name:'Filter spans',exact:true})).toHaveValue('Legacy');await expect(page.getByRole('combobox',{name:'Timeline zoom',exact:true})).toHaveValue('2');await expect(unknown).toHaveAttribute('aria-selected','true');await page.getByRole('button',{name:'Ask about span',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({sourceRevision:'trace-4',spanId:'unknown'});
});
test('trace tree keyboard and collapse keep supplied spans discoverable',async({page})=>{
 await fixture(page,'TraceWaterfall',suppliedTrace);await page.goto('/');const root=page.getByRole('treeitem',{name:'Import request',exact:true});await root.focus();await root.press('ArrowDown');await expect(page.getByRole('treeitem',{name:'Validate grant',exact:true})).toBeFocused();await page.getByRole('button',{name:'Collapse Parse document',exact:true}).click();await expect(page.getByRole('treeitem',{name:'Read source bytes',exact:true})).toHaveCount(0);await page.getByRole('searchbox',{name:'Filter spans',exact:true}).fill('source');await expect(page.getByRole('treeitem',{name:'Read source bytes',exact:true})).toBeVisible();await expect(page.getByRole('treeitem',{name:'Parse document',exact:true})).toBeVisible();
});

const navigationTrace={revision:'navigation-1',spans:[{id:'parent',name:'Parent',status:'ok'},{id:'branch',parentId:'parent',name:'Branch',status:'ok'},{id:'leaf',parentId:'branch',name:'Leaf',status:'error'},{id:'other',name:'Other root',status:'unknown'}]};
async function traceState(page:Page,names:string[],entry:string,expanded:Record<string,boolean>,focused=entry){
 const tree=page.getByRole('tree',{name:'Supplied spans',exact:true});
 await expect(tree.getByRole('treeitem')).toHaveCount(names.length);
 expect(await tree.getByRole('treeitem').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))).toEqual(names);
 for(const name of names)await expect(tree.getByRole('treeitem',{name,exact:true})).toBeVisible();
 const current=tree.getByRole('treeitem',{name:entry,exact:true});await expect(current).toHaveAttribute('tabindex','0');
 expect(await tree.locator('*').evaluateAll(nodes=>nodes.filter(node=>node instanceof HTMLElement&&node.tabIndex>=0&&!node.matches(':disabled')).map(node=>node.getAttribute('aria-label')))).toEqual([entry]);
 for(const [name,value] of Object.entries(expanded))await expect(tree.getByRole('treeitem',{name,exact:true})).toHaveAttribute('aria-expanded',String(value));
 if(focused)await expect(tree.getByRole('treeitem',{name:focused,exact:true})).toBeFocused();
}

test('trace horizontal arrows traverse visible parents and children',async({page})=>{
 await fixture(page,'TraceWaterfall',navigationTrace);await page.goto('/');
 const item=(name:string)=>page.getByRole('treeitem',{name,exact:true}),all=['Parent','Branch','Leaf','Other root'];
 await item('Leaf').click();await item('Leaf').press('ArrowLeft');await expect.soft(item('Branch')).toBeFocused();
 await item('Parent').click();await item('Parent').press('ArrowRight');await expect(item('Branch')).toBeFocused();await expect(item('Branch')).toHaveAttribute('aria-selected','true');await traceState(page,all,'Branch',{Parent:true,Branch:true});
 await item('Leaf').click();await item('Leaf').press('ArrowLeft');await traceState(page,all,'Branch',{Parent:true,Branch:true});await expect(item('Branch')).toHaveAttribute('aria-selected','true');
 await item('Branch').press('ArrowLeft');await traceState(page,['Parent','Branch','Other root'],'Branch',{Parent:true,Branch:false});
 await item('Branch').press('ArrowLeft');await traceState(page,['Parent','Branch','Other root'],'Parent',{Parent:true,Branch:false});
 await item('Branch').click();await item('Branch').press('ArrowRight');await traceState(page,all,'Branch',{Parent:true,Branch:true});
 await item('Branch').press('ArrowRight');await traceState(page,all,'Leaf',{Parent:true,Branch:true});await expect(item('Leaf')).toHaveAttribute('aria-selected','true');
 await item('Leaf').press('ArrowRight');await traceState(page,all,'Leaf',{Parent:true,Branch:true});
 await item('Other root').click();await item('Other root').press('ArrowLeft');await traceState(page,all,'Other root',{Parent:true,Branch:true});
});

test('trace has one sequential tree entry and keeps pointer collapse',async({page})=>{
 await fixture(page,'TraceWaterfall',navigationTrace);await page.goto('/');const item=(name:string)=>page.getByRole('treeitem',{name,exact:true}),status=page.getByRole('combobox',{name:'Span status',exact:true});
 await traceState(page,['Parent','Branch','Leaf','Other root'],'Parent',{Parent:true,Branch:true},'');
 await status.focus();await page.keyboard.press('Tab');await expect(item('Parent')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(status).toBeFocused();await page.keyboard.press('Tab');await item('Parent').press('ArrowDown');await traceState(page,['Parent','Branch','Leaf','Other root'],'Branch',{Parent:true,Branch:true});
 await item('Branch').press('End');await traceState(page,['Parent','Branch','Leaf','Other root'],'Other root',{Parent:true,Branch:true});await item('Other root').press('Home');await traceState(page,['Parent','Branch','Leaf','Other root'],'Parent',{Parent:true,Branch:true});
 await item('Parent').press('ArrowDown');await item('Branch').press('ArrowDown');await traceState(page,['Parent','Branch','Leaf','Other root'],'Leaf',{Parent:true,Branch:true});
 await page.getByRole('button',{name:'Collapse Branch',exact:true}).click();await traceState(page,['Parent','Branch','Other root'],'Parent',{Parent:true,Branch:false});await expect(page.getByRole('button',{name:'Expand Branch',exact:true})).toBeVisible();
 await item('Parent').press('End');await item('Other root').press('ArrowUp');await traceState(page,['Parent','Branch','Other root'],'Branch',{Parent:true,Branch:false});await item('Branch').press('ArrowDown');await traceState(page,['Parent','Branch','Other root'],'Other root',{Parent:true,Branch:false});
 await page.getByRole('button',{name:'Expand Branch',exact:true}).click();await traceState(page,['Parent','Branch','Leaf','Other root'],'Other root',{Parent:true,Branch:true},'');
 await status.focus();await page.keyboard.press('Tab');await expect(item('Other root')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(status).toBeFocused();
});

test('trace filtered descendants and stale source retain truthful state',async({page})=>{
 const {host}=await fixture(page,'TraceWaterfall',navigationTrace,{view:{selectedId:'branch',collapsedIds:['branch'],query:'',status:'all',zoom:1,sourceRevision:'navigation-1'}});await page.goto('/');
 const item=(name:string)=>page.getByRole('treeitem',{name,exact:true}),filter=page.getByRole('searchbox',{name:'Filter spans',exact:true}),status=page.getByRole('combobox',{name:'Span status',exact:true}),ask=page.getByRole('button',{name:'Ask about span',exact:true});
 await filter.fill('Leaf');await expect(item('Branch')).toHaveAttribute('aria-expanded','true');await traceState(page,['Parent','Branch','Leaf'],'Branch',{Parent:true,Branch:true},'');
 await item('Branch').focus();await item('Branch').press('ArrowRight');await traceState(page,['Parent','Branch','Leaf'],'Leaf',{Parent:true,Branch:true});await item('Leaf').press('ArrowLeft');await traceState(page,['Parent','Branch','Leaf'],'Branch',{Parent:true,Branch:true});
 await item('Branch').press('ArrowLeft');await traceState(page,['Parent','Branch','Leaf'],'Parent',{Parent:true,Branch:true});await item('Parent').press('ArrowLeft');await traceState(page,['Parent','Branch','Leaf'],'Parent',{Parent:true,Branch:true});
 await expect.poll(()=>(host.snapshot.userStates[0].values.view as any).collapsedIds).toEqual(['branch']);await filter.fill('');await traceState(page,['Parent','Branch','Other root'],'Parent',{Parent:true,Branch:false},'');
 await status.selectOption('error');await traceState(page,['Parent','Branch','Leaf'],'Parent',{Parent:true,Branch:true},'');await item('Branch').click();await item('Branch').press('ArrowRight');await traceState(page,['Parent','Branch','Leaf'],'Leaf',{Parent:true,Branch:true});await item('Leaf').press('ArrowLeft');await item('Branch').press('ArrowLeft');await traceState(page,['Parent','Branch','Leaf'],'Parent',{Parent:true,Branch:true});
 await status.selectOption('all');await traceState(page,['Parent','Branch','Other root'],'Parent',{Parent:true,Branch:false},'');
 host.setInput('data',{...navigationTrace,revision:'navigation-2'});await host.publish();await expect(ask).toBeDisabled();await filter.fill('Leaf');await status.selectOption('error');await page.getByRole('button',{name:'Collapse Branch',exact:true}).click();await expect(ask).toBeDisabled();await expect.poll(()=>(host.snapshot.userStates[0].values.view as any).sourceRevision).toBe('navigation-1');expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
 // Restore the latent collapse while filters still force its descendants visible.
 await page.getByRole('button',{name:'Collapse Branch',exact:true}).click();await expect.poll(()=>(host.snapshot.userStates[0].values.view as any).collapsedIds).toEqual(['branch']);await page.reload();await expect(filter).toHaveValue('Leaf');await expect(status).toHaveValue('error');await traceState(page,['Parent','Branch','Leaf'],'Parent',{Parent:true,Branch:true},'');await expect(ask).toBeDisabled();
 await item('Parent').focus();await item('Parent').press('ArrowRight');await traceState(page,['Parent','Branch','Leaf'],'Branch',{Parent:true,Branch:true});await expect(ask).toBeEnabled();await ask.click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({sourceRevision:'navigation-2',spanId:'branch'});
 await filter.fill('no matching span');await expect(page.getByRole('treeitem')).toHaveCount(0);expect(await page.getByRole('tree').locator('*').evaluateAll(nodes=>nodes.filter(node=>node instanceof HTMLElement&&node.tabIndex>=0&&!node.matches(':disabled')).length)).toBe(0);await expect(page.getByText('No supplied spans match these filters.',{exact:true})).toBeVisible();await filter.focus();await page.keyboard.press('Tab');await expect(status).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(filter).toBeFocused();
 await filter.fill('');await status.selectOption('all');await traceState(page,['Parent','Branch','Other root'],'Branch',{Parent:true,Branch:false},'');
});

test('trace source revisions cannot be refreshed by editing a local filter',async({page})=>{
 const {host}=await fixture(page,'TraceWaterfall',suppliedTrace);await page.goto('/');await page.getByRole('treeitem',{name:'Parse document',exact:true}).click();host.setInput('data',{...suppliedTrace,revision:'trace-5'});await host.publish();await page.getByRole('searchbox',{name:'Filter spans',exact:true}).fill('Parse');await expect(page.getByRole('button',{name:'Ask about span',exact:true})).toBeDisabled();await page.getByRole('treeitem',{name:'Parse document',exact:true}).click();await expect(page.getByRole('button',{name:'Ask about span',exact:true})).toBeEnabled();
});
test('trace ruler and span tracks share an exact time origin at desktop and narrow widths',async({page})=>{
 await fixture(page,'TraceWaterfall',suppliedTrace);await page.goto('/');for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('.trace-waterfall').evaluate(node=>{const ruler=node.querySelector('.trace-ruler>div')!.getBoundingClientRect(),track=node.querySelector('.trace-track')!.getBoundingClientRect();return Math.abs(ruler.left-track.left)<1&&Math.abs(ruler.width-track.width)<1;})).toBe(true);}
});
test('fractional trace timing uses the same scale as its ruler',async({page})=>{
 await fixture(page,'TraceWaterfall',{revision:'fractional',spans:[{id:'one',name:'Fast span',status:'ok',startMs:0,durationMs:.5}]});await page.goto('/');const row=page.getByRole('treeitem',{name:'Fast span',exact:true});await expect(row).toBeVisible();expect(await row.evaluate(node=>{const track=node.querySelector('.trace-track')!.getBoundingClientRect(),bar=node.querySelector('.trace-bar')!.getBoundingClientRect();return bar.width/track.width;})).toBeCloseTo(1,2);
});
test('filtered and collapsed trace views always retain a keyboard entry',async({page})=>{
 await fixture(page,'TraceWaterfall',suppliedTrace);await page.goto('/');await page.getByRole('treeitem',{name:'Parse document',exact:true}).click();await page.getByRole('searchbox',{name:'Filter spans',exact:true}).fill('Legacy');await expect(page.getByRole('treeitem',{name:'Import request',exact:true})).toHaveAttribute('tabindex','0');
 await page.getByRole('searchbox',{name:'Filter spans',exact:true}).fill('');await page.getByRole('treeitem',{name:'Read source bytes',exact:true}).click();await page.getByRole('button',{name:'Collapse Parse document',exact:true}).click();await expect(page.getByRole('treeitem',{name:'Import request',exact:true})).toHaveAttribute('tabindex','0');
});
test('invalid replacement data shows an honest unavailable state without external reads',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const {host}=await fixture(page,'ArchitectureCanvas',suppliedGraph);await page.goto('/');await page.getByRole('button',{name:'Document preview',exact:true}).click();host.setInput('data',{...suppliedGraph,edges:[{from:'preview',to:'absent'}]});await host.publish();await expect(page.getByText('Architecture data is unavailable from the connected source.',{exact:true})).toBeVisible();await expect(page.locator('.architecture-canvas svg')).toHaveCount(0);expect(errors).toEqual([]);
});
test('pending proposal actions do not block local board movement or duplicate submission',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const {host}=await fixture(page,'WorkflowBoard',suppliedBoard,{},async()=>{await pending;return {};});try{await page.goto('/');await page.getByRole('button',{name:'Keep retries ordered',exact:true}).click();await page.getByRole('combobox',{name:'Move selected card',exact:true}).selectOption('review');await page.getByRole('button',{name:'Send move proposal',exact:true}).click();await expect(page.getByRole('button',{name:'Sending\u2026',exact:true})).toBeDisabled();await page.getByRole('combobox',{name:'Move selected card',exact:true}).selectOption('done');await expect(page.getByRole('region',{name:'Prepared',exact:true})).toContainText('Keep retries ordered');expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(1);}finally{release();}
});
test('batched theme and narrow captures preserve distinct geometry and reduced motion',async({page},info)=>{
 const directory=resolve('.harness-work-objects-evidence');await mkdir(directory,{recursive:true});const captures:string[]=[];
 for(const [kind,data,selection] of [['WorkflowBoard',suppliedBoard,'Keep retries ordered'],['ArchitectureCanvas',suppliedGraph,'Bounded parser'],['TraceWaterfall',suppliedTrace,'Parse document']] as const){
  const {host}=await fixture(page,kind,data);for(const [theme,width] of [['light',1440],['dark',1440],['light',390]] as const){host.snapshot.settings.theme=theme;await page.emulateMedia({reducedMotion:'reduce',colorScheme:theme});await page.setViewportSize({width,height:1000});await page.goto('/');await page.getByRole(kind==='TraceWaterfall'?'treeitem':'button',{name:selection,exact:true}).click();const object=page.locator('.work-object');await expect(object).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect.poll(()=>object.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);const file=`${kind}-${theme}-${width}.png`;await object.screenshot({path:resolve(directory,file),animations:'disabled'});captures.push(file);}
  await page.unrouteAll({behavior:'wait'});
 }
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify({provenance:'Authored synthetic local source data through the actual artifact renderer; no model, authentication or live service calls.',captures,project:info.project.name},null,2));
});


test('architecture and trace selections have subtle finite perimeter accents without white edges',async({page})=>{
 await fixture(page,'ArchitectureCanvas',suppliedGraph);await page.goto('/');const queue=page.locator('[data-architecture-node="queue"]');expect(await queue.evaluate(node=>getComputedStyle(node).borderLeftWidth)).toBe('1px');
 await queue.click();await expect(queue.locator('.work-selection-halo')).toBeAttached();await page.waitForTimeout(500);await expect(queue.locator('.work-selection-halo')).toHaveCount(0);
 await page.reload();await expect(queue).toHaveAttribute('aria-pressed','true');await expect(queue.locator('.work-selection-halo')).toHaveCount(0);
 await fixture(page,'TraceWaterfall',suppliedTrace);await page.goto('/');const span=page.getByRole('treeitem',{name:'Parse document',exact:true});expect(await span.locator('.trace-bar').evaluate(node=>getComputedStyle(node).borderLeftColor)).not.toBe(await span.evaluate(node=>getComputedStyle(node).color));
 await page.emulateMedia({reducedMotion:'reduce'});await span.click();await expect(span.locator('.work-selection-halo')).toHaveCount(0);await expect(span).toHaveAttribute('aria-selected','true');
});

for(const policy of ['off','reduced'] as const){
 test(`app ${policy} settles active board motion and preserves keyboard focus`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page,'WorkflowBoard',suppliedBoard);await page.goto('/');const card=page.getByRole('button',{name:'Keep retries ordered',exact:true});await card.focus();await card.press('Alt+ArrowRight');
  const result=await page.locator('[data-work-card="retry"]').evaluate(async(node,policy)=>{const before=(node as HTMLElement).style.transform;document.documentElement.dataset.motion=policy;await Promise.resolve();return {before,after:(node as HTMLElement).style.transform};},policy);
  expect(result.before).not.toBe('');expect(result.after).toBe('');await expect(card).toBeFocused();await page.evaluate(()=>document.documentElement.dataset.motion='system');expect(await page.locator('[data-work-card="retry"]').evaluate(node=>(node as HTMLElement).style.transform)).toBe('');
 });
 test(`app ${policy} settles selection halo without replay`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page,'ArchitectureCanvas',suppliedGraph);await page.goto('/');const node=page.getByRole('button',{name:'Bounded parser',exact:true});await node.click();
  await expect(page.locator('.work-selection-halo')).toHaveCount(1);
  expect(await page.evaluate(async policy=>{document.documentElement.dataset.motion=policy;await Promise.resolve();return document.querySelectorAll('.work-selection-halo').length;},policy)).toBe(0);
  await node.press('ArrowDown');await expect(page.getByRole('button',{name:'Draft queue',exact:true})).toBeFocused();expect(await page.locator('.work-selection-halo').count()).toBe(0);
  await page.evaluate(()=>document.documentElement.dataset.motion='system');expect(await page.locator('.work-selection-halo').count()).toBe(0);
 });
}

test('halo replacement and unmount cancel previously owned animation work',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});const {host}=await fixture(page,'ArchitectureCanvas',suppliedGraph);await page.goto('/');const node=page.getByRole('button',{name:'Bounded parser',exact:true});await node.click();
 await page.locator('.work-selection-halo').evaluate(node=>{const animation=node.getAnimations()[0];animation.pause();Object.assign(window,{previousHalo:animation});});
 await node.evaluate(node=>(node as HTMLElement).click());
 expect(await page.evaluate(()=>(window as unknown as {previousHalo:Animation}).previousHalo.playState)).toBe('idle');
 await page.locator('.work-selection-halo').evaluate(node=>{const animation=node.getAnimations()[0];animation.pause();Object.assign(window,{lastHalo:animation});});
 host.snapshot.artifacts=[];await host.publish();await expect(page.locator('.architecture-canvas')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {lastHalo:Animation}).lastHalo.playState)).toBe('idle');
});
