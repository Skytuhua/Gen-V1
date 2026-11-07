import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import {planDataId,PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import type {WorkspaceEnvelope,PanelPlacement} from '../../packages/contracts/workspace';

const fixtureModule='/@fs/'+encodeURI(resolve(import.meta.dirname,'workspace-app-fixture.tsx').replaceAll('\\','/'));

async function nativeBridge(page:Page){await page.addInitScript(()=>{
 const w=window as any,surface=JSON.parse(sessionStorage.getItem('workspace-test-surface')??'{"kind":"main"}'),focusSurface=JSON.parse(sessionStorage.getItem('workspace-test-focus')??'null');
 let windows:any[]=[{id:'main',surface:{kind:'main'},ready:true,minimized:false,visible:true}],listener:any;
 const context=()=>({windowId:surface.kind==='main'?'main':'native',surface,windows,...(focusSurface?{focusSurface}:{})});
 w.__workspaceNativeCalls=[];w.__workspaceSetDesktop=(value:any)=>listener?.(value);
 w.harnessDesktop={getContext:async()=>context(),ready:async()=>context(),onState:(fn:any)=>{listener=fn;return()=>{};},onCloseRequested:(fn:any)=>{w.__workspaceClose=fn;return()=>{};},list:async()=>windows,
 detach:async(value:any)=>{w.__workspaceNativeCalls.push(['detach',value]);const native={id:'native',surface:value,visible:true,ready:true,minimized:false};windows=[windows[0],native];listener?.({windows});return native;},
 reattach:async()=>{},focus:async()=>{},browser:async(value:any)=>{w.__workspaceNativeCalls.push(['browser',value]);},control:async(value:any)=>{w.__workspaceNativeCalls.push(['control',value]);const info=windows.find(info=>info.id===value.windowId);if(!info)throw Error('Missing native window');if(w.__failNativeControl){w.__failNativeControl=false;throw Error('Synthetic native visibility refused');}info.visible=value.visible;listener?.({windows:[...windows]});}
 };
});}

const stamp='2026-11-02T00:00:00Z';
async function pendingReads(page:Page,kind:'models'|'context'){
 await page.addInitScript(kind=>{
  const w=window as any,original=window.fetch,calls:any[]=[];w.__pendingWorkspaceReads=calls;
  window.fetch=(input,init)=>{
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
   if(kind==='models'?url.pathname!=='/api/models':!/^\/api\/projects\/[^/]+\/context$/.test(url.pathname))return original(input,init);
   const signal=init?.signal,call={id:calls.length,url:url.pathname+url.search,hasSignal:Boolean(signal),aborted:false,completed:false,complete:(_value?:unknown)=>{}};calls.push(call);
   return new Promise<Response>((accept,reject)=>{
    const abort=()=>{call.aborted=true;reject(new DOMException('Read cancelled','AbortError'));};
    call.complete=value=>{if(call.aborted||call.completed)return;call.completed=true;signal?.removeEventListener('abort',abort);const projectId=url.pathname.split('/')[3];accept(new Response(JSON.stringify(value??(kind==='models'?{models:[{id:'test/model',provider:'test',name:'Retained model'}]}:{project:{id:projectId,name:'Retained context',authority:{kind:'local'},createdAt:'2026-11-02T00:00:00Z'},machineName:'Retained context',editor:{available:false,label:'Editor'},branch:'fixture',head:null,changes:{added:0,removed:0,files:0},lineage:[],scripts:[],capabilities:{git:false,terminal:false,pullRequests:false}})),{headers:{'Content-Type':'application/json'}}));};
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
   });
  };
 },kind);
 return()=>page.evaluate(()=>(window as any).__pendingWorkspaceReads.map(({id,url,hasSignal,aborted,completed}:any)=>({id,url,hasSignal,aborted,completed})) as {id:number;url:string;hasSignal:boolean;aborted:boolean;completed:boolean}[]);
}
const panel=(id:string,threadId:string,x:number,kind:PanelPlacement['kind']='thread'):PanelPlacement=>({id,kind,canvasId:'canvas',binding:{authority:{kind:'local'},threadId,...(kind==='agent'?{agentId:'agent-one'}:{})},placement:'canvas',visible:true,collapsed:false,bounds:{x,y:56,width:480,height:600},order:0,alwaysOnTop:false});
async function fixture(page:Page,panels:PanelPlacement[],beforeCommand?:(type:string,envelope:WorkspaceEnvelope)=>void|{code:string;message:string},preset:'custom'|'workspace'='custom'){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Unused artifact fixture'}}}});
 snapshot.artifacts=[];snapshot.userStates=[];snapshot.settings.theme='dark';
 snapshot.threads[0]={...snapshot.threads[0],title:'Main investigation'};
 snapshot.threads.push({...snapshot.threads[0],id:'side',title:'Side investigation',sideParentId:'task-thread'}, {...snapshot.threads[0],id:'child',title:'Delegated investigation',kind:'delegate',parentThreadId:'task-thread'});
 snapshot.messages=[{id:'parent-message',threadId:'task-thread',role:'assistant',content:'Parent transcript only',runId:null,createdAt:stamp},...Array.from({length:105},(_,index)=>({id:'child-'+index,threadId:'child',role:'assistant' as const,content:'Actual child message '+index,runId:null,createdAt:stamp}))];
 snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:stamp,value:{version:1,title:'Parent plan',steps:[],agents:[{id:'agent-one',name:'Delegated investigation',commandId:'delegate-command',taskId:'delegate-task',createdAt:stamp,updatedAt:stamp,completedRequirementIds:[],reportedPercent:null,status:'working',task:'Inspect the child source',childThreadId:'child',requirements:[]}]}});
 const host=await serveTaskFixture(page,snapshot);
 const envelope:WorkspaceEnvelope={projects:[],state:{version:1,revision:0,activeCanvasId:'canvas',canvases:[{version:1,id:'canvas',name:'Acceptance',preset,viewport:{x:0,y:0,zoom:1},panels,filter:'active',projectIds:[]}],profiles:[],disabledKinds:[],integrations:{}}};
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));
 await page.route('**/api/workspace/commands',async route=>{const command=route.request().postDataJSON();const rejection=beforeCommand?.(command.type,envelope);if(rejection)return route.fulfill({status:409,json:{error:rejection}});if(command.payload.baseRevision!==undefined&&command.payload.baseRevision!==envelope.state.revision)return route.fulfill({status:400,json:{error:{code:'WORKSPACE_CHANGED',message:'The workspace revision changed.'}}});if(command.type==='workspace.canvas.viewport')Object.assign(envelope.state.canvases[0].viewport,command.payload);if(command.type==='workspace.canvas.select')envelope.state.activeCanvasId=command.payload.canvasId;if(command.type==='workspace.panel.add')panels.push({...command.payload.panel,canvasId:command.payload.canvasId,placement:'canvas',visible:true,collapsed:false,bounds:command.payload.bounds,order:panels.length,alwaysOnTop:false});if(command.type==='workspace.panel.update')Object.assign(panels.find(panel=>panel.id===command.payload.panelId)!,command.payload.patch);envelope.state.revision++;await route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result:envelope}});});
 await page.route('**/workspace-app-check',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureModule}');</script></body></html>`}));
 await page.goto('/workspace-app-check');
 if(await page.evaluate(()=>sessionStorage.getItem('workspace-test-surface')===JSON.stringify({kind:'navigation'})))await expect(page.getByRole('complementary',{name:'Thread navigation',exact:true})).toBeVisible();
 else if(preset==='custom')await expect(page.getByRole('region',{name:'Acceptance canvas',exact:true})).toBeVisible();
 else await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 return {...host,envelope};
}

test('primary Workspace shows added tools and preserves its chat draft through pin hide and reload',async({page})=>{
 const host=await fixture(page,[],undefined,'workspace'),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the primary draft');
 await page.getByRole('button',{name:'Panels',exact:false}).click();await page.getByRole('menuitem',{name:'Add Files panel',exact:true}).click();
 const files=page.locator('.canvas-panel-files');await expect(files).toBeVisible();
 if(await page.locator('.workspace-menu').isVisible())await page.getByRole('button',{name:'Panels',exact:true}).click();
 await files.getByRole('button',{name:'Pin Files',exact:true}).click();await expect(files).toHaveAttribute('data-pinned','true');
 await files.getByRole('button',{name:'Hide Files',exact:true}).click();await expect(files).toHaveCount(0);
 await page.getByRole('button',{name:'Panels',exact:false}).click();await page.getByRole('button',{name:'Show Files',exact:true}).click();
 await expect(files).toBeVisible();await expect(draft).toHaveValue('Keep the primary draft');
 await page.reload();await expect(files).toBeVisible();await expect(draft).toHaveValue('Keep the primary draft');
 expect(host.commands.some(command=>command.type==='run.stop')).toBe(false);
});

test('detached navigation footer opens typed views for its selected conversation',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('workspace-test-surface',JSON.stringify({kind:'navigation'})));await nativeBridge(page);await fixture(page,[],undefined,'workspace');
 await page.getByRole('button',{name:'Pull requests',exact:true}).click();await page.getByRole('button',{name:'Usage',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__workspaceNativeCalls.filter((value:any)=>value[0]==='detach').map((value:any)=>value[1]))).toEqual([{kind:'workspace',tab:'linked-pull-requests',threadId:'task-thread'},{kind:'workspace',tab:'usage',threadId:'task-thread'}]);
});

test('opened native child survives a placement failure and metadata retry retains one owner and the chat draft',async({page})=>{
 test.skip(true,'Historical detached-view creation evidence; new detachment is retired.');
 await nativeBridge(page);let failPlacement=true;
 const host=await fixture(page,[panel('chat-origin','task-thread',24),panel('files-origin','task-thread',528,'files')],type=>{if(failPlacement&&type==='workspace.panel.update'){failPlacement=false;return {code:'FIXTURE_PLACEMENT_FAILED',message:'Synthetic placement write failed'};}});
 const draft=page.locator('[data-panel-id="chat-origin"]').getByRole('textbox',{name:'Message',exact:true}),identity=await draft.elementHandle();await draft.fill('Retain this draft');
 const files=page.locator('[data-panel-id="files-origin"]');await files.getByRole('button',{name:'Detach Files',exact:true}).click();
 await expect(files).toContainText('This view is open in another window.');await expect(files.getByRole('button',{name:'Focus window',exact:true})).toBeVisible();await expect(files.getByRole('button',{name:'Save window placement',exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('The window opened, but its panel placement could not be saved');
 expect(host.envelope.state.canvases[0].panels.find(value=>value.id==='files-origin')!.placement).toBe('canvas');await expect(draft).toHaveValue('Retain this draft');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
 const first=await page.evaluate(async()=>await (window as any).harnessDesktop.list());expect(first.filter((value:any)=>value.id==='native')).toHaveLength(1);
 await files.getByRole('button',{name:'Save window placement',exact:true}).click();await expect.poll(()=>host.envelope.state.canvases[0].panels.find(value=>value.id==='files-origin')!.placement).toBe('native');
 const after=await page.evaluate(async()=>await (window as any).harnessDesktop.list());expect(after.filter((value:any)=>value.id==='native').map((value:any)=>value.id)).toEqual(first.filter((value:any)=>value.id==='native').map((value:any)=>value.id));await expect(draft).toHaveValue('Retain this draft');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
});

test('delegated agent panels page the actual child transcript without a composer',async({page})=>{
 await fixture(page,[panel('agent-panel','task-thread',24,'agent')]);
 const agent=page.locator('[data-panel-id="agent-panel"]');
 await expect(agent.getByRole('log',{name:'Delegated agent messages'})).toContainText('Actual child message 104');
 await expect(agent.getByText('Parent transcript only',{exact:true})).toHaveCount(0);
 await expect(agent.getByText('Actual child message 0',{exact:true})).toHaveCount(0);
 await expect(agent.getByRole('textbox')).toHaveCount(0);
 await agent.getByRole('button',{name:'Load earlier messages'}).click();
 await expect(agent.getByText('Actual child message 0',{exact:true})).toBeVisible();
});

test('main and side composers keep independent drafts across reload and rejected sends',async({page})=>{
 const host=await fixture(page,[panel('main-panel','task-thread',24),panel('side-panel','side',528),panel('child-panel','child',1032)]);
 const main=page.locator('[data-panel-id="main-panel"]').getByRole('textbox',{name:'Message',exact:true});
 const side=page.getByRole('textbox',{name:'Message to Side investigation',exact:true});
 await main.fill('Main draft stays');await side.fill('Side draft stays');
 await page.reload();await expect(main).toHaveValue('Main draft stays');await expect(side).toHaveValue('Side draft stays');
 const child=page.locator('[data-panel-id="child-panel"]');await expect(child.getByRole('textbox')).toHaveCount(0);await expect(child).toContainText('Read-only delegated transcript');
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='message.send')return route.fulfill({status:409,json:{error:{code:'RUN_BUSY',message:'Synthetic side send refused'}}});await route.fallback();});
 await page.locator('[data-panel-id="side-panel"]').getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Synthetic side send refused');
 await expect(side).toHaveValue('Side draft stays');await expect(main).toHaveValue('Main draft stays');
 expect(host.commands.some(command=>command.type==='run.stop')).toBe(false);
});

test('offscreen tool bodies unmount while zoom leaves the surrounding shell unchanged',async({page})=>{
 let fileRequests=0;

 const files=panel('files-panel','task-thread',9000,'files');files.binding.projectId='project';
 const host=await fixture(page,[files]);
 await page.route('**/api/projects/project/files?*',route=>{fileRequests++;return route.fulfill({json:{entries:[{name:'fixture.ts',path:'fixture.ts',kind:'file'}]}});});
 const shell=page.locator('[data-panel-id="files-panel"]');
 await expect(shell).toHaveCount(1);await expect(shell.locator('.canvas-panel-body')).toHaveCount(0);expect(fileRequests).toBe(0);
 const sidebar=page.locator('.sidebar'),before=await sidebar.boundingBox();
 await page.getByRole('button',{name:'Zoom canvas out',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('90%');
 expect(await sidebar.boundingBox()).toEqual(before);
 files.bounds.x=24;host.envelope.state.revision++;
 await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(shell.getByRole('navigation',{name:'Project files',exact:true})).toContainText('fixture.ts');expect(fileRequests).toBe(1);
 files.bounds.x=9000;host.envelope.state.revision++;
 await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(shell.locator('.canvas-panel-body')).toHaveCount(0);expect(fileRequests).toBe(1);
});

for(const kind of ['thread','agent','artifact','context','plan','usage','navigation','browser'] as const)test(`docking specialized ${kind} restores its saved originating tile using canonical native identity`,async({page})=>{
 await nativeBridge(page);
 const value=panel(kind+'-origin','task-thread',24,kind);if(kind==='artifact')value.binding.artifactId='artifact';if(kind==='browser')value.binding.browserId='browser';
 const host=await fixture(page,[value]);
  await page.locator(`[data-panel-id="${value.id}"] > header`).getByRole('button',{name:/^Detach /}).click();
  await expect.poll(()=>value.placement).toBe('native');
  const calls=await page.evaluate(()=>(window as any).__workspaceNativeCalls),surface=calls.filter((call:any)=>call[0]==='detach').at(-1)[1];
  await page.evaluate(surface=>sessionStorage.setItem('workspace-test-focus',JSON.stringify(surface)),surface);await page.reload();
  await expect.poll(()=>value.placement).toBe('canvas');
  await expect(page.locator(`[data-panel-id="${value.id}"]`)).toBeVisible();
 expect(host.commands.some(command=>command.type==='run.stop')).toBe(false);
});

test('live native dock retries a concurrent layout revision without losing either draft',async({page})=>{
 await nativeBridge(page);let raceEnabled=false,conflicts=0;
 const host=await fixture(page,[],(type,envelope)=>{if(raceEnabled&&type==='workspace.panel.update'){raceEnabled=false;conflicts++;envelope.state.revision++;}});
 Object.assign(host.envelope.state.canvases[0],{preset:'all-agents',filter:'all'});host.envelope.state.revision++;
 await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 const tile=page.locator('[data-panel-id="live-thread:canvas:task-thread"]'),main=tile.getByRole('textbox',{name:'Message',exact:true}),side=page.getByRole('textbox',{name:'Message to Side investigation',exact:true});
 await main.fill('Main native handoff draft');await side.fill('Independent side draft');
 await tile.locator(':scope > header').getByRole('button',{name:/^Detach /}).click();
 await expect.poll(()=>host.envelope.state.canvases[0].panels.find(panel=>panel.id==='live-thread:canvas:task-thread')?.placement).toBe('native');
 raceEnabled=true;
 await page.evaluate(()=>(window as any).__workspaceSetDesktop({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}],focusSurface:{kind:'thread',threadId:'task-thread'}}));
 await expect(tile).toBeVisible();await expect(main).toHaveValue('Main native handoff draft');await expect(side).toHaveValue('Independent side draft');
 expect(conflicts).toBe(1);expect(host.envelope.state.canvases[0].panels.find(panel=>panel.id==='live-thread:canvas:task-thread')?.placement).toBe('canvas');
});

test('native dock refuses a panel retargeted by a concurrent profile change',async({page})=>{
 await nativeBridge(page);let raceEnabled=false;const original=panel('origin','task-thread',24);
 await fixture(page,[original],(type,envelope)=>{if(raceEnabled&&type==='workspace.panel.update'){raceEnabled=false;original.binding={...original.binding,threadId:'side'};original.visible=false;envelope.state.revision++;}});
 await page.locator('[data-panel-id="origin"] > header').getByRole('button',{name:/^Detach /}).click();
 await expect.poll(()=>original.placement).toBe('native');raceEnabled=true;
 await page.evaluate(()=>(window as any).__workspaceSetDesktop({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}],focusSurface:{kind:'thread',threadId:'task-thread'}}));
 await expect(page.getByRole('alert').filter({hasText:'owning panel changed'})).toBeVisible();
 expect(original).toMatchObject({binding:{threadId:'side'},placement:'native',visible:false});
});

for(const geometryOnly of [true,false])test(`canvas command ${geometryOnly?'retries native geometry only':'refuses a changed canvas'} without rebasing its owner`,async({page})=>{
 let conflicts=0;const owner=panel('owner','task-thread',24);
 const host=await fixture(page,[owner],(type,envelope)=>{if(type==='workspace.panel.add'&&!conflicts){conflicts++;envelope.state.revision++;if(!geometryOnly)envelope.state.canvases[0].name='Changed by another layout';}});
 await page.locator('[data-panel-id="owner"]').getByRole('button',{name:'Inspect changes',exact:true}).click();
 if(geometryOnly){await expect(page.locator('.canvas-panel-diff')).toBeVisible();expect(host.envelope.state.canvases[0].panels.find(panel=>panel.kind==='diff')!.binding.threadId).toBe('task-thread');}
 else{await expect(page.getByRole('alert').filter({hasText:'workspace revision changed'})).toBeVisible();expect(host.envelope.state.canvases[0].panels.some(panel=>panel.kind==='diff')).toBe(false);}
 expect(conflicts).toBe(1);
});

for(const liveProject of [false,true])test(`detach persists ${liveProject?'live project':'unbound selected task'} binding for reload and dock`,async({page})=>{
 await nativeBridge(page);const value=panel('context-origin','side',24,'context');
 if(liveProject)Object.assign(value.binding,{projectId:'unassigned',liveProject:true});else delete value.binding.threadId;
 await fixture(page,[value]);await page.locator('[data-panel-id="context-origin"] > header').getByRole('button',{name:/^Detach /}).click();
 await expect.poll(()=>value.placement).toBe('native');expect(value.binding.threadId).toBe('task-thread');
 await page.evaluate(()=>sessionStorage.setItem('workspace-test-focus','{"kind":"plan","threadId":"task-thread"}'));await page.reload();
 await expect.poll(()=>value.placement).toBe('canvas');await expect(page.locator('[data-panel-id="context-origin"]')).toBeVisible();
});

test('side draft follows the native App composer and returns with rejected and newer pending edits intact',async({page})=>{
 test.skip(true,'Historical detached-view creation evidence; new detachment is retired.');
 await nativeBridge(page);await fixture(page,[panel('side-panel','side',24)]);
 const side=page.getByRole('textbox',{name:'Message to Side investigation',exact:true});await side.fill('Draft before detach');
 await page.getByRole('button',{name:'Detach Side investigation',exact:true}).click();
 await page.evaluate(()=>sessionStorage.setItem('workspace-test-surface',JSON.stringify({kind:'thread',threadId:'side'})));await page.reload();
 await expect(side).toHaveValue('Draft before detach');await side.fill('Rejected native draft');
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='message.send')return route.fulfill({status:409,json:{error:{code:'RUN_BUSY',message:'Synthetic native side refused'}}});await route.fallback();});
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Synthetic native side refused');await expect(side).toHaveValue('Rejected native draft');
 let release:()=>void=()=>{},received:()=>void=()=>{};const pending=new Promise<void>(resolve=>release=resolve),sent=new Promise<void>(resolve=>received=resolve);
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='message.send'){received();await pending;return route.fulfill({json:{commandId:command.id,seq:2,result:{}}});}await route.fallback();});
 await page.getByRole('button',{name:'Send',exact:true}).click();await sent;await side.fill('Newer edit while native send is pending');release();await expect(side).toHaveValue('Newer edit while native send is pending');
 await page.evaluate(()=>{sessionStorage.setItem('workspace-test-surface','{"kind":"main"}');sessionStorage.setItem('workspace-test-focus','{"kind":"thread","threadId":"side"}');});await page.reload();
 await expect(side).toHaveValue('Newer edit while native send is pending');await expect(side).toBeEnabled();
});

test('native instance visibility uses the owned native window and retains the host record on refusal',async({page})=>{
 test.skip(true,'Historical detached-view creation evidence; new detachment is retired.');
 await nativeBridge(page);const value=panel('thread-origin','task-thread',24),host=await fixture(page,[value]);
 await page.getByRole('button',{name:'Detach Main investigation',exact:true}).click();await expect.poll(()=>value.placement).toBe('native');
 await page.getByRole('button',{name:'Panels',exact:false}).click();
 await page.getByRole('button',{name:'Hide Main investigation',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__workspaceNativeCalls)).toContainEqual(['control',{type:'visibility',windowId:'native',visible:false}]);expect(value.visible).toBe(false);
 await page.getByRole('button',{name:'Show Main investigation',exact:true}).click();await expect.poll(()=>value.visible).toBe(true);
 await page.getByRole('button',{name:'Hide thread window',exact:true}).click();await expect(page.getByRole('button',{name:'Show Main investigation',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show Main investigation',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__workspaceNativeCalls.at(-1))).toEqual(['control',{type:'visibility',windowId:'native',visible:true}]);
 await page.evaluate(()=>(window as any).__failNativeControl=true);await page.getByRole('button',{name:'Hide Main investigation',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Synthetic native visibility refused');expect(value.visible).toBe(true);expect(host.commands.some(command=>command.type==='run.stop')).toBe(false);
});

test('keyboard and refreshed browser panel geometry updates native bounds while menus still occlude it',async({page},testInfo)=>{
 await nativeBridge(page);const browser=panel('browser-panel','task-thread',24,'browser');browser.binding.browserId='browser';await fixture(page,[browser]);
 await page.evaluate(()=>(window as any).__workspaceSetDesktop({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}],dockedBrowser:{browserId:'browser',state:{url:'https://example.com',title:'Fixture browser',loading:false,canGoBack:false,canGoForward:false}}}));
 const latest=()=>page.evaluate(()=>(window as any).__workspaceNativeCalls.filter((call:any)=>call[0]==='browser'&&call[1].type==='bounds').at(-1)?.[1].bounds);
 try{await expect.poll(async()=>(await latest())?.width).toBeGreaterThan(0);}catch(cause){const debug=await page.evaluate(()=>({panel:document.querySelector('.canvas-panel-browser')?.outerHTML,native:[...document.querySelectorAll('.desktop-browser-native')].map(node=>({html:node.outerHTML,rect:node.getBoundingClientRect().toJSON(),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,pointerEvents:getComputedStyle(node).pointerEvents,closestInert:node.closest('[inert],[hidden]')?.outerHTML,interaction:document.documentElement.classList.contains('workspace-canvas-interaction'),blocker:document.querySelector('dialog[open],.artifact-expanded,[aria-modal="true"],.workspace-menu')?.outerHTML,samples:(()=>{const r=node.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);return [[left+1,top+1],[right-1,top+1],[left+1,bottom-1],[right-1,bottom-1],[(left+right)/2,(top+bottom)/2]].map(([x,y])=>{const hit=document.elementFromPoint(x,y);return {x,y,owned:hit?node.contains(hit):null,hitClass:hit?.className,hitHtml:hit?.outerHTML.slice(0,1400)};});})(),ancestors:(()=>{const chain=[];let el:Element|null=node;while(el&&chain.length<6){const css=getComputedStyle(el);chain.push({className:el.className,pointerEvents:css.pointerEvents,overflow:css.overflow,position:css.position,zIndex:css.zIndex});el=el.parentElement;}return chain;})()})),calls:(window as any).__workspaceNativeCalls,context:(window as any).harnessDesktop?null:'no bridge'}));await writeFile('.harness-frontend-refinement/browser-geometry-debug.json',JSON.stringify(debug,null,2));await testInfo.attach('browser-geometry-debug',{body:JSON.stringify(debug,null,2),contentType:'application/json'});throw cause;}const before=await latest();
 await page.getByRole('button',{name:'Move Browser',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await latest())?.x).toBe(before.x+8);
 browser.bounds.x+=80;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));await expect.poll(async()=>(await latest())?.x).toBe(before.x+88);
 await page.getByRole('button',{name:'Panels',exact:false}).click();await expect.poll(latest).toEqual({x:0,y:0,width:0,height:0});
});


test('canvas owner tool callbacks open fixed Files and Diff panels while another conversation is selected',async({page})=>{
 const value=panel('other-main','other-main',24),context=panel('other-context','other-main',1032,'context'),launcher=panel('other-launcher','other-main',528,'workspace');
 value.binding.projectId=context.binding.projectId=launcher.binding.projectId='other-project';
 const host=await fixture(page,[value,context,launcher]);
 host.snapshot.threads.push({...host.snapshot.threads[0],id:'other-main',title:'Other project main',projectId:'other-project',projectName:'Other project'});
 host.snapshot.resources.push({id:'other-resource',threadId:'other-main',kind:'project',path:'C:/Fixture/Other',label:'Other project',writable:false,createdAt:stamp});
 await page.route('**/api/projects/other-project/context?*',route=>route.fulfill({json:{project:{id:'other-project',name:'Other project',authority:{kind:'local'},createdAt:stamp},threadId:'other-main',machineName:'Fixture',editor:{available:false,label:'Editor'},branch:'fixture',head:'a'.repeat(40),changes:{added:1,removed:0,files:1},lineage:[],scripts:[],capabilities:{git:true,terminal:false,pullRequests:false}}}));
 await page.reload();
 const owner=page.locator('[data-panel-id="other-main"]'),draft=owner.getByRole('textbox',{name:'Message',exact:true});
 await draft.fill('Draft in the clicked owner');
 await page.locator('[data-panel-id="other-launcher"]').getByRole('button',{name:'Files',exact:true}).click();
 await expect.poll(()=>host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='files').length).toBe(1);
 const files=host.envelope.state.canvases[0].panels.find(panel=>panel.kind==='files')!;
 expect(files.binding).toMatchObject({threadId:'other-main',projectId:'other-project',liveProject:false});
 await expect(page.locator(`[data-panel-id="${files.id}"]`)).toBeVisible();
 // Tool panels can overlap the originating composer; hide only their shell to continue the same owner's actions.
 files.visible=false;host.envelope.state.revision++;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(page.locator(`[data-panel-id="${files.id}"]`)).toHaveCount(0);
 await owner.getByRole('button',{name:'Inspect changes',exact:true}).click();
 await expect.poll(()=>host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='diff').length).toBe(1);
 await expect(page.locator('.canvas-panel-diff')).toBeVisible();
 expect(host.envelope.state.canvases[0].panels.find(panel=>panel.kind==='diff')!.binding).toMatchObject({threadId:'other-main',projectId:'other-project',liveProject:false});
 expect(host.snapshot.activeThreadId).toBe('task-thread');await expect(draft).toHaveValue('Draft in the clicked owner');
 // The owner's context Changes action follows the same fixed thread, independently of selection.
 for(const panel of host.envelope.state.canvases[0].panels)if(['files','diff'].includes(panel.kind))panel.visible=false;
 host.envelope.state.revision++;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(page.locator('.canvas-panel-diff')).toHaveCount(0);
 await page.locator('[data-panel-id="other-context"]').getByRole('button',{name:'Changes',exact:false}).click();
 await expect.poll(()=>host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='diff').length).toBe(2);
 await expect(page.locator('.canvas-panel-diff')).toBeVisible();
 expect(host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='diff').at(-1)!.binding).toMatchObject({threadId:'other-main',projectId:'other-project',liveProject:false});
 // A tool launcher's callback retains the launcher's fixed scope as well.
 for(const panel of host.envelope.state.canvases[0].panels)if(['files','diff','context'].includes(panel.kind))panel.visible=false;
 host.envelope.state.revision++;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(page.locator('[data-panel-id="other-context"]')).toHaveCount(0);
 await page.locator('[data-panel-id="other-launcher"]').getByRole('button',{name:'Files',exact:true}).click();
 await expect.poll(()=>host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='files').length).toBe(2);
 expect(host.envelope.state.canvases[0].panels.filter(panel=>panel.kind==='files').at(-1)!.binding).toMatchObject({threadId:'other-main',projectId:'other-project',liveProject:false});
});

test('canvas project selection targets its owner and cancellation restores independent drafts and focus',async({page})=>{
 const main=panel('selected-main','task-thread',24),other=panel('other-main','other-main',560),host=await fixture(page,[main,other]);
 host.snapshot.threads.push({...host.snapshot.threads[0],id:'other-main',title:'Other main',sessionPath:null});
 host.envelope.projects.push({id:'chosen-local',name:'Other local project',rootPath:'C:/Fixture/Owner',authority:{kind:'local'},createdAt:stamp});await page.reload();
 const first=page.locator('[data-panel-id="selected-main"]').getByRole('textbox',{name:'Message',exact:true}),owner=page.locator('[data-panel-id="other-main"]'),second=owner.getByRole('textbox',{name:'Message',exact:true}),opener=owner.getByRole('button',{name:'Select project',exact:true});
 await first.fill('Selected draft');await second.fill('Other owner draft');await opener.click();
 const dialog=page.getByRole('dialog',{name:'Select project',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(opener).toBeFocused();
 let submitted:Record<string,any>|undefined;
 await page.route('**/api/workspace/commands',async route=>{const input=route.request().postDataJSON();if(input.type!=='workspace.project.connect')return route.fallback();submitted=input;return route.fulfill({json:{commandId:input.id,seq:host.snapshot.seq,result:host.envelope}});});
 await opener.click();await dialog.getByRole('button',{name:'Select Other local project',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(submitted?.payload).toMatchObject({threadId:'other-main',name:'Other local project',path:'C:/Fixture/Owner'});
 expect(host.commands.some(command=>command.type==='resource.grant')).toBe(false);
 await expect(first).toHaveValue('Selected draft');await expect(second).toHaveValue('Other owner draft');await expect(opener).toBeFocused();
});


test('canvas Connect project captures its owner across selection updates and preserves drafts and focus',async({page})=>{
 const selected=panel('selected-main','task-thread',24),other=panel('other-main','other-main',560),context=panel('other-context','other-main',1096,'context');
 other.binding.projectId=context.binding.projectId='other-project';
 const host=await fixture(page,[selected,other,context]);
 host.snapshot.threads.push({...host.snapshot.threads[0],id:'other-main',title:'Other owner',projectId:'other-project',projectName:'Other project'});await page.reload();
 const first=page.locator('[data-panel-id="selected-main"]').getByRole('textbox',{name:'Message',exact:true}),second=page.locator('[data-panel-id="other-main"]').getByRole('textbox',{name:'Message',exact:true}),opener=page.locator('[data-panel-id="other-context"]').getByRole('button',{name:'Connect project',exact:true});
 await first.fill('Selected main draft');await second.fill('Owning main draft');await opener.click();
 await page.getByRole('dialog',{name:'Connect project'}).getByRole('button',{name:'Cancel',exact:true}).click();await expect(opener).toBeFocused();
 await opener.click();const dialog=page.getByRole('dialog',{name:'Connect project'});
 await dialog.getByRole('textbox',{name:'Project name',exact:true}).fill('Chosen project');await dialog.getByRole('textbox',{name:'Local folder',exact:true}).fill('C:/Fixture/Chosen');
 // A host update can change the outer fallback selection while this modal remains open.
 host.snapshot.activeThreadId='side';await host.publish();
 let submitted:Record<string,any>|undefined;
 await page.route('**/api/workspace/commands',async route=>{const input=route.request().postDataJSON();if(input.type!=='workspace.project.connect')return route.fallback();submitted=input;return route.fulfill({json:{commandId:input.id,seq:host.snapshot.seq,result:host.envelope}});});
 await dialog.getByRole('button',{name:'Connect project',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(submitted?.payload).toMatchObject({name:'Chosen project',path:'C:/Fixture/Chosen',threadId:'other-main'});
 await expect(opener).toBeFocused();await expect(first).toHaveValue('Selected main draft');await expect(second).toHaveValue('Owning main draft');
});

test('obsolete model reads cancel on panel disposal and selection without cancelling another live owner',async({page})=>{
 const reads=await pendingReads(page,'models'),main=panel('selected-main','task-thread',24),other=panel('other-main','other-main',560),host=await fixture(page,[main,other]);
 host.snapshot.threads.push({...host.snapshot.threads[0],id:'other-main',title:'Other model owner'});await page.reload();
 await expect.poll(async()=>(await reads()).filter(read=>read.url.endsWith('threadId=task-thread')).length).toBe(2);
 await expect.poll(async()=>(await reads()).filter(read=>read.url.endsWith('threadId=other-main')).length).toBe(1);
 other.visible=false;host.envelope.state.revision++;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(page.locator('[data-panel-id="other-main"]')).toHaveCount(0);
 await expect.poll(async()=>(await reads()).find(read=>read.url.endsWith('threadId=other-main'))?.aborted).toBe(true);
 expect((await reads()).filter(read=>read.url.endsWith('threadId=task-thread')).every(read=>!read.aborted)).toBe(true);
 await page.locator('.thread-item').filter({hasText:'Other model owner'}).click();
 await expect.poll(async()=>(await reads()).filter(read=>read.url.endsWith('threadId=task-thread')&&read.aborted).length).toBe(1);
 expect((await reads()).filter(read=>read.url.endsWith('threadId=task-thread')&&!read.aborted)).toHaveLength(1);
 await expect.poll(async()=>(await reads()).filter(read=>read.url.endsWith('threadId=other-main')&&!read.aborted).length).toBe(1);
 await page.evaluate(()=>(window as any).__pendingWorkspaceReads.filter((read:any)=>!read.aborted).forEach((read:any)=>read.complete()));
 await expect(page.locator('[data-panel-id="selected-main"] .model-picker-trigger')).toContainText('Retained model');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('closing Settings cancels its pending catalog read and leaves the current workspace read alive',async({page})=>{
 const reads=await pendingReads(page,'models');await fixture(page,[panel('selected-main','task-thread',24)]);
 await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('threadId=task-thread')).length).toBe(2);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 await expect.poll(async()=>(await reads()).filter(read=>read.url==='/api/models').length).toBe(1);
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await expect.poll(async()=>(await reads()).find(read=>read.url==='/api/models')?.aborted).toBe(true);
 expect((await reads()).filter(read=>read.url.includes('threadId=task-thread')).every(read=>!read.aborted)).toBe(true);
 await page.evaluate(()=>(window as any).__pendingWorkspaceReads.filter((read:any)=>!read.aborted).forEach((read:any)=>read.complete()));
 await expect(page.locator('[data-panel-id="selected-main"] .model-picker-trigger')).toContainText('Retained model');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('disposing a project context cancels its read while another context still loads successfully',async({page})=>{
 const reads=await pendingReads(page,'context'),first=panel('first-context','task-thread',24,'context'),second=panel('second-context','other-main',560,'context');first.binding.projectId='first-project';second.binding.projectId='second-project';
 const host=await fixture(page,[first,second]);host.snapshot.threads[0].projectId='first-project';host.snapshot.threads.push({...host.snapshot.threads[0],id:'other-main',title:'Other context owner',projectId:'second-project'});await page.reload();
 await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('/second-project/context')).length).toBe(1);
 first.visible=false;host.envelope.state.revision++;await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect(page.locator('[data-panel-id="first-context"]')).toHaveCount(0);
 await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('/first-project/context')&&read.aborted).length).toBeGreaterThan(0);
 expect((await reads()).filter(read=>read.url.includes('/second-project/context')).every(read=>!read.aborted)).toBe(true);
 await page.evaluate(()=>(window as any).__pendingWorkspaceReads.filter((read:any)=>!read.aborted&&read.url.includes('/second-project/context')).forEach((read:any)=>read.complete()));
 await expect(page.locator('[data-panel-id="second-context"]')).toContainText('Retained context');
 await expect(page.locator('[data-panel-id="second-context"]').getByRole('alert')).toHaveCount(0);
});

test('a completed old project action cannot refresh over a retargeted context while current-owner actions still refresh',async({page})=>{
 const reads=await pendingReads(page,'context'),context=panel('action-context','task-thread',24,'context');context.binding.projectId='old-project';
 const host=await fixture(page,[context]);host.snapshot.threads[0].projectId='old-project';await page.reload();
 const value=(projectId:string,machineName:string)=>({project:{id:projectId,name:projectId,authority:{kind:'local'},createdAt:stamp},machineName,editor:{available:true,label:'Fixture editor'},branch:'fixture',head:null,changes:{added:0,removed:0,files:0},lineage:[],scripts:[],capabilities:{git:false,terminal:false,pullRequests:false}});
 await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('/old-project/context')).length).toBeGreaterThan(0);
 await page.evaluate(value=>(window as any).__pendingWorkspaceReads.forEach((read:any)=>read.complete(value)),value('old-project','Old owner'));
 const tile=page.locator('[data-panel-id="action-context"]'),editor=tile.getByRole('button',{name:'Open in Fixture editor',exact:true,includeHidden:true});await tile.getByText('Project tools',{exact:true}).click();await expect(editor).toBeEnabled();
 let release!:()=>void,oldAction:any;const gate=new Promise<void>(accept=>{release=accept;});
 await page.route('**/api/projects/old-project/actions',async route=>{oldAction=route.request().postDataJSON();await gate;await route.fulfill({json:{ok:true}});});
 await editor.click();await expect.poll(()=>Boolean(oldAction)).toBe(true);expect(oldAction.threadId).toBe('task-thread');expect(oldAction.type).toBe('open-editor');
 host.snapshot.threads[0].projectId='new-project';context.binding.projectId='new-project';host.envelope.state.revision++;await host.publish();await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));
 await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('/new-project/context')).length).toBeGreaterThan(0);
 const oldReads=(await reads()).filter(read=>read.url.includes('/old-project/context')).length;
 const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/old-project/actions');release();await response;
 await expect(editor).toBeEnabled();
 expect((await reads()).filter(read=>read.url.includes('/new-project/context')).every(read=>!read.aborted)).toBe(true);
 expect((await reads()).filter(read=>read.url.includes('/old-project/context'))).toHaveLength(oldReads);
 await page.evaluate(value=>(window as any).__pendingWorkspaceReads.filter((read:any)=>read.url.includes('/new-project/context')&&!read.aborted).forEach((read:any)=>read.complete(value)),value('new-project','Current owner'));
 await expect(tile).toContainText('Current owner');
 let currentAction:any;await page.route('**/api/projects/new-project/actions',async route=>{currentAction=route.request().postDataJSON();await route.fulfill({json:{ok:true}});});
 const beforeRefresh=(await reads()).filter(read=>read.url.includes('/new-project/context')).length;
 if(await tile.locator('.project-context-tools').getAttribute('open')===null)await tile.getByText('Project tools',{exact:true}).click();await editor.click();await expect.poll(async()=>(await reads()).filter(read=>read.url.includes('/new-project/context')).length).toBe(beforeRefresh+1);
 expect(currentAction.threadId).toBe('task-thread');expect(currentAction.type).toBe('open-editor');
 await page.evaluate(value=>(window as any).__pendingWorkspaceReads.filter((read:any)=>read.url.includes('/new-project/context')&&!read.aborted&&!read.completed).forEach((read:any)=>read.complete(value)),value('new-project','Refreshed current owner'));
 await expect(editor).toBeEnabled();await expect(tile).toContainText('Refreshed current owner');
});
