import {test,expect,type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {scopedContext} from '../scoped-conversation-fixture';
import type {CodeReviewComparison} from '../../packages/contracts/code-review';
const head='1'.repeat(40),revision='e'.repeat(64);
const local:CodeReviewComparison['identity']={kind:'local',id:'a'.repeat(64),scope:'worktree',headOid:head,branch:'topic',revision:'b'.repeat(64),base:{kind:'index',revision:'c'.repeat(64)},head:{kind:'worktree',revision:'b'.repeat(64)}};
const remote:CodeReviewComparison['identity']={kind:'pull-request',id:'d'.repeat(64),repo:'owner/repo',number:48,pullRequestId:'PR_48',baseOid:'2'.repeat(40),headOid:head,mergeBaseOid:'4'.repeat(40),baseRef:'main',headRef:'topic',semantics:'merge-base'};
const files=[{path:'src/first.ts',status:'MM',index:'M',worktree:'M',staged:true,untracked:false,binary:false,added:1,removed:1,additions:1,deletions:1}];
async function fixture(page:Page,{unbound=false,wrongProject=false,native=false,paged=false,side=false,readOnly=false,awaitComparison=false}={}){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic Code Review host fixture'}}}});
 snapshot.threads[0]={...snapshot.threads[0],id:'review-a',title:'Review changes',projectId:'project-a',projectName:'Alpha',status:'ready',runId:null,...(side?{kind:'side' as const}:{})};snapshot.activeThreadId='review-a';snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];snapshot.messages=[];
 snapshot.settings={theme:'dark',modelId:'test/model',preferences:{showUsageFooter:false}};
 const {commands}=await serveTaskFixture(page,snapshot);
 await page.addInitScript(({native})=>{
  localStorage.setItem('harness:selected-thread','irrelevant-thread');localStorage.setItem('harness:shell-layout:v1',JSON.stringify({sidebarCollapsed:false}));
  if(native){const context={windowId:'main',surface:{kind:'main'},windows:[],nativeTitleBar:true};Object.assign(window,{harnessDesktop:{getContext:async()=>context,ready:async()=>context,setTheme:async()=>{},onState:(notify:(state:unknown)=>void)=>{Object.assign(window,{publishReviewOwner:(away:boolean)=>notify({windows:away?[{id:'other',surface:{kind:'thread',threadId:'review-a'},title:'Review owner'}]:[]})});return()=>{};},onCloseRequested:()=>()=>{},list:async()=>[],onWorkspaceChanged:()=>()=>{}}});}
 },{native});
 const requests:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push(url.pathname+url.search);});
 const row=snapshot.threads[0],projects=[{id:'project-a',name:'Alpha',authority:{kind:'local'},rootPath:'C:/synthetic/alpha'}];
 const binding={authority:{kind:'local'},threadId:'review-a',projectId:wrongProject?'foreign-project':'project-a'};
 const panel={id:'review-owner',canvasId:'code-review',kind:'thread',binding,placement:'canvas',visible:true,collapsed:false,bounds:{x:0,y:0,width:600,height:500},order:0,alwaysOnTop:false};
 const canvases=['workspace','all-agents','code-review','research','custom'].map(preset=>({id:preset,name:preset,preset,panels:preset==='code-review'&&!unbound?[panel]:[],viewport:{x:0,y:0,zoom:1}}));
 const envelope={projects,state:{version:1,revision:1,activeCanvasId:'code-review',canvases,profiles:[],disabledKinds:[],integrations:{}}};
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));
 const workspaceCommands:Record<string,any>[]=[];
 await page.route('**/api/workspace/commands',route=>{const input=route.request().postDataJSON();workspaceCommands.push(input);if(input.type==='workspace.canvas.select')envelope.state.activeCanvasId=input.payload.canvasId;if(input.type==='workspace.panel.update')Object.assign(panel,input.payload.patch);if(input.type==='workspace.panel.add')canvases.find(canvas=>canvas.id===input.payload.canvasId)?.panels.push({...panel,...input.payload.panel});envelope.state.revision++;return route.fulfill({json:{commandId:input.id,seq:1,result:envelope}});});
 await page.route('**/api/shell-settings',route=>route.fulfill({json:snapshot.settings}));
 await page.route('**/api/shell/navigation?*',route=>{const second=new URL(route.request().url()).searchParams.has('cursor');return route.fulfill({json:{sequence:1,total:paged?2:1,items:paged&&second?[{...row,id:'older-copy',title:'Older working copy'}]:[row],nextCursor:paged&&!second?'page-2':null,order:'created-desc',stats:{pinned:0,working:0,waiting:0,settled:paged?2:1,minOrder:0,maxOrder:0}}});});
 await page.route('**/api/shell/navigation/*',route=>route.fulfill({json:row}));
 const context={...scopedContext,readOnly:side||readOnly,researchEligible:!side&&!readOnly,owner:{...scopedContext.owner,threadId:row.id,title:row.title,projectId:'project-a',projectName:'Alpha',modelId:'test/model'},sequence:10};
 await page.route('**/api/conversations/**',route=>{const url=new URL(route.request().url()),owner={authority:'personal',threadId:row.id,scopeKey:context.scopeKey,sequence:10};return route.fulfill({json:url.pathname.endsWith('/updates')?{...owner,fromSequence:10,owner:null,transcriptChanged:false,checkpoint:context.checkpoint}:url.pathname.endsWith('/transcript')?{...owner,messages:[],nextCursor:null}:context});});
 const actions:Record<string,any>[]=[],inspections:Record<string,any>[]=[];let outcome='confirmed',inspection='confirmed';
 await page.route('**/api/projects/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/actions')){const input=route.request().postDataJSON();actions.push(input);return route.fulfill({status:outcome==='confirmed'?200:409,json:outcome==='confirmed'?{commandId:input.id,seq:1,result:{operationId:input.id,operation:input.type,state:'confirmed'}}:{state:outcome,error:{code:'ACTION_UNCERTAIN',message:'Outcome uncertain'}}});}
  if(url.pathname.endsWith('/inspect')){inspections.push(route.request().postDataJSON());return route.fulfill({json:{state:inspection}});}
  if(url.pathname.endsWith('/git'))return route.fulfill({json:{head,revision,branch:'topic',gitWrite:true,files}});
  if(url.pathname.endsWith('/pull-requests'))return route.fulfill({json:{repo:'owner/repo',items:[{number:48,title:'Exact remote PR',url:'https://github.com/owner/repo/pull/48'}]}});
  if(url.pathname.endsWith('/pull-requests/48'))return route.fulfill({json:{repo:'owner/repo',item:{number:48,headRefOid:head},head,revision,canReview:true}});
  const identity=url.pathname.includes('pull-request')?remote:url.searchParams.get('scope')==='staged'?{...local,scope:'staged'}:local;
  return route.fulfill({json:url.pathname.endsWith('/file')?{identity,file:files[0],state:'text',text:'@@ -1 +1 @@\n-old\n+exact '+identity.kind+' source'}:{state:'ready',value:{identity,files,filesTruncated:false,checks:[],observedAt:'2026-11-06',access:{mode:identity.kind==='local'?'managed':'remote',untrackedIncluded:identity.kind==='local'}}}});
 });
 const module='/@fs/'+encodeURI(fileURLToPath(new URL('./workspace-app-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
 await page.route('**/code-review-host-check',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
 const comparisonReady=awaitComparison?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/project-a/git/comparison'&&response.ok()):null;
 await page.goto('/code-review-host-check');if(comparisonReady)await comparisonReady;return{context,row,requests,commands,workspaceCommands,actions,inspections,setOutcome:(value:string)=>{outcome=value;},setInspection:(value:string)=>{inspection=value;}};
}
async function choose(page:Page,label:string,value:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
test('cold Code Review shows its bound diff without a conversation snapshot or agent inventory',async({page})=>{
 const h=await fixture(page);await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Selected file diff'})).toContainText('exact local source');
 expect(h.requests.filter(path=>path==='/api/snapshot'||path.startsWith('/api/events')||path.startsWith('/api/agents'))).toEqual([]);expect(h.requests.some(path=>path.startsWith('/api/conversations/irrelevant-thread'))).toBe(false);
});
test('unbound Code Review asks for an explicit working-copy owner without creating a thread',async({page})=>{
 const h=await fixture(page,{unbound:true});await expect(page.getByRole('combobox',{name:'Project and working copy'})).toBeVisible();expect(h.commands.filter(command=>command.type==='thread.create')).toEqual([]);expect(h.requests.filter(path=>path.startsWith('/api/conversations/')||path.startsWith('/api/projects/'))).toEqual([]);
});

test('a mismatched saved project holds reads and asks for an explicit owner',async({page})=>{
 const h=await fixture(page,{wrongProject:true});await expect(page.getByRole('alert').filter({hasText:'The saved project no longer matches this conversation.'})).toBeVisible();expect(h.requests.some(path=>path.includes('/git/comparison'))).toBe(false);
});
test('optional chat keeps the actual shared draft and sends to the exact review owner',async({page})=>{
 const h=await fixture(page);await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toBeVisible();await page.getByRole('button',{name:'Agent chat',exact:true}).click();const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('Ask about these changes');await page.getByRole('button',{name:'Agent chat',exact:true}).click();await expect(input).toBeHidden();await page.getByRole('button',{name:'Agent chat',exact:true}).click();await expect(input).toHaveValue('Ask about these changes');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);expect(h.commands.find(command=>command.type==='message.send')?.threadId).toBe('review-a');
});
test('stage uses the actual canonical route with its original operation identity',async({page})=>{
 const h=await fixture(page);await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect.poll(()=>h.actions.length).toBe(1);expect(h.actions[0]).toMatchObject({type:'stage',threadId:'review-a',payload:{paths:['src/first.ts'],revision,expectedHead:head}});expect(h.actions[0]!.id).toMatch(/^[0-9a-f-]{36}$/);await expect(page.getByRole('status').filter({hasText:'Action confirmed.'}).first()).toBeVisible();
});
test('remote review uses exact PR comparison and preserves its draft across target navigation',async({page})=>{
 const h=await fixture(page);await choose(page,'Comparison','#48 Exact remote PR');await expect(page.getByRole('region',{name:'Selected file diff'})).toContainText('exact pull-request source');const draft=page.getByRole('textbox',{name:'Review draft',exact:true});await draft.fill('Exact remote feedback');await choose(page,'Comparison','Working copy');await choose(page,'Comparison','#48 Exact remote PR');await expect(draft).toHaveValue('Exact remote feedback');await page.getByRole('button',{name:'Submit review',exact:true}).click();await expect.poll(()=>h.actions.length).toBe(1);expect(h.actions[0]).toMatchObject({type:'review-pr',threadId:'review-a',payload:{number:48,body:'Exact remote feedback',head,revision}});expect(h.requests.some(path=>path.startsWith('/api/projects/project-a/pull-requests/48/comparison?threadId=review-a'))).toBe(true);
});
test('uncertain review inspection sends the original operation and never repeats a write',async({page})=>{
 const h=await fixture(page);h.setOutcome('uncertain');h.setInspection('not-applied');await choose(page,'Comparison','#48 Exact remote PR');await page.getByRole('textbox',{name:'Review draft',exact:true}).fill('Keep uncertain draft');await page.getByRole('button',{name:'Submit review',exact:true}).click();await page.getByRole('button',{name:'Inspect action outcome',exact:true}).click();await expect.poll(()=>h.inspections.length).toBe(1);expect(h.actions).toHaveLength(1);expect(h.inspections[0]).toMatchObject({operationId:h.actions[0]!.id,operation:'review-pr',selection:{owner:{projectId:'project-a',threadId:'review-a'},target:{kind:'pull-request',repo:'owner/repo',number:48}},comparison:remote,payload:h.actions[0]!.payload});await expect(page.getByRole('button',{name:'Use current comparison',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Review draft',exact:true})).toHaveValue('Keep uncertain draft');
});
test('a native owner roundtrip prevents an authenticated write retry',async({page})=>{
 await fixture(page,{native:true});let posts=0;await page.route('**/api/projects/project-a/actions',async route=>{posts++;await page.evaluate(()=>{const publish=Reflect.get(window,'publishReviewOwner');publish(true);publish(false);});return route.fulfill({status:403,json:{error:{code:'AUTH_REQUIRED',message:'Renew session'}}});});await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect(page.getByRole('button',{name:'Inspect action outcome',exact:true})).toBeVisible();expect(posts).toBe(1);
});

test('terminal starts only when opened and stops polling when hidden',async({page})=>{
 const h=await fixture(page);let opens=0;await page.route('**/api/terminals**',route=>{if(route.request().method()==='POST'&&new URL(route.request().url()).pathname==='/api/terminals')opens++;return route.fulfill({json:{id:'review-terminal',output:'Synthetic real terminal adapter',start:0,cursor:31,exited:false,exitCode:null}});});await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toBeVisible();expect(h.requests.filter(path=>path.startsWith('/api/terminals'))).toEqual([]);await page.getByRole('button',{name:'Terminal',exact:true}).click();await expect.poll(()=>opens).toBe(1);await expect(page.locator('.xterm-host')).toBeVisible();await page.getByRole('button',{name:'Terminal',exact:true}).click();await expect(page.locator('.xterm-host')).toBeHidden();
});
for(const theme of ['dark','light'] as const)for(const size of [{width:1440,height:900},{width:1000,height:650},{width:800,height:450}])test(`compact review geometry ${theme} ${size.width}`,async({page})=>{
 await page.setViewportSize(size);await fixture(page);await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toBeVisible();await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 expect(await page.locator('.workspace-controls').evaluate(element=>{const r=element.getBoundingClientRect();return r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight;})).toBe(true);
 expect(await page.locator('.code-review-host').evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);
 await expect(page.getByRole('heading',{name:'Code Review',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Selected file diff'})).toContainText('exact local source');
});

for(const mode of ['side','readOnly'] as const)test(`review rejects ${mode} conversations before opening project tools`,async({page})=>{
 const h=await fixture(page,{[mode]:true});await expect(page.getByRole('alert').filter({hasText:'Choose a main conversation connected to a project.'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toHaveCount(0);
 expect(h.requests.filter(path=>path.startsWith('/api/projects/')||path.startsWith('/api/terminals'))).toEqual([]);
});
test('bound working-copy selector can load older conversations',async({page})=>{
 const h=await fixture(page,{paged:true});await expect(page.getByRole('region',{name:'Code review workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'More conversations',exact:true}).click();
 await page.getByRole('combobox',{name:'Project and working copy',exact:true}).click();
 await expect(page.getByRole('option',{name:'Alpha / Older working copy',exact:true})).toBeVisible();
 expect(h.requests.some(path=>path.startsWith('/api/shell/navigation?')&&path.includes('cursor=page-2'))).toBe(true);
});
test('same-owner fresh-scope reacquisition retains presentation while holding tool actions',async({page})=>{
 const h=await fixture(page,{awaitComparison:true,paged:true});const region=page.getByRole('region',{name:'Code review workspace',exact:true});await expect(region).toBeVisible();
 await page.getByRole('button',{name:'More conversations',exact:true}).click();await expect.poll(()=>h.requests.some(path=>path.includes('cursor=page-2'))).toBe(true);
 const second={...files[0],path:'src/second.ts'};
 await page.route('**/api/projects/project-a/git/comparison?*',route=>route.fulfill({json:{state:'ready',value:{identity:local,files:[...files,second],filesTruncated:false,checks:[],observedAt:'2026-11-06',access:{mode:'managed',untrackedIncluded:true}}}}));
 await page.route('**/api/projects/project-a/git/comparison/file?*',route=>route.fulfill({json:{identity:local,file:second,state:'text',text:'@@ -1 +1 @@\n-old\n+second file source'}}));
 await page.getByRole('button',{name:'Refresh comparison',exact:true}).click();await page.getByRole('button',{name:/src\/second.ts/}).click();
 const filter=page.getByRole('searchbox',{name:'Filter files'});await filter.fill('second');
 const terminalCommands:Record<string,any>[]=[];await page.route('**/api/terminals**',route=>{if(route.request().method()==='POST'&&new URL(route.request().url()).pathname.endsWith('/commands'))terminalCommands.push(route.request().postDataJSON());return route.fulfill({json:{id:'review-terminal',output:'Synthetic real terminal adapter',start:0,cursor:31,exited:false,exitCode:null}});});
 await page.getByRole('button',{name:'Terminal',exact:true}).click();await expect(page.locator('.xterm-host .xterm')).toBeVisible();
 await page.getByRole('button',{name:'Agent chat',exact:true}).click();const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Retain review chat draft');
 h.setOutcome('uncertain');await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect(page.getByRole('button',{name:'Inspect action outcome',exact:true})).toBeVisible();
 const original=await region.elementHandle(),originalMessage=await message.elementHandle(),originalTerminal=await page.locator('.xterm-host').elementHandle();
 const fresh={...h.context,scopeKey:'f'.repeat(64),sequence:20,checkpoint:'checkpoint-fresh-20'};
 let sent=false,reacquiring=false,metadataPending=false,releaseContext!:()=>void,releaseMetadata!:()=>void;
 const contextHeld=new Promise<void>(resolve=>{releaseContext=resolve;}),metadataHeld=new Promise<void>(resolve=>{releaseMetadata=resolve;});
 await page.route('**/api/conversations/review-a?*',async route=>{reacquiring=true;await contextHeld;await route.fulfill({json:fresh});});
 await page.route('**/api/conversations/review-a/transcript?*',route=>route.fulfill({json:{authority:'personal',threadId:'review-a',scopeKey:fresh.scopeKey,sequence:20,messages:[],nextCursor:null}}));
 await page.route('**/api/conversations/review-a/updates?*',route=>{if(!sent){sent=true;return route.fulfill({status:400,json:{error:{code:'RESYNC_REQUIRED',message:'Reacquire unchanged owner'}}});}return route.fulfill({json:{authority:'personal',threadId:'review-a',scopeKey:fresh.scopeKey,sequence:20,fromSequence:20,owner:null,transcriptChanged:false,checkpoint:fresh.checkpoint}});});
 await page.route('**/api/projects/project-a/git?*',async route=>{metadataPending=true;await metadataHeld;await route.fulfill({json:{head,revision,branch:'topic',gitWrite:true,files}});});
 try{
  await expect.poll(()=>reacquiring).toBe(true);expect(await original!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(page.locator('.code-review-bound')).toHaveAttribute('inert','');await expect(page.getByRole('button',{name:'Stage file',exact:true})).toBeDisabled();
  releaseContext();await expect.poll(()=>metadataPending).toBe(true);
  // A real server issues a new scope. Metadata is still unresolved, but this must be the same mounted presentation.
  expect(await original!.evaluate(node=>node.isConnected)).toBe(true);expect(await originalMessage!.evaluate(node=>node.isConnected)).toBe(true);expect(await originalTerminal!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(page.locator('.code-review-bound')).toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Stage file',exact:true})).toBeDisabled();await expect(message).toBeDisabled();
  // Even direct event dispatch cannot turn retained metadata into command authority.
  await page.getByRole('button',{name:'Inspect action outcome',exact:true}).dispatchEvent('click');
  await page.locator('.cr-toolbar .ui-select-native').first().evaluate((select:HTMLSelectElement)=>{select.value=select.options[1]!.value;select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.getByRole('button',{name:'Stop',exact:true}).dispatchEvent('click');
  expect(h.actions).toHaveLength(1);expect(h.inspections).toHaveLength(0);expect(h.workspaceCommands).toHaveLength(0);expect(terminalCommands.filter(command=>command.type==='stop')).toHaveLength(0);expect(h.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
 }finally{releaseContext();releaseMetadata();}
 await expect(page.locator('.code-review-bound')).not.toHaveAttribute('inert','');
 await expect(page.getByRole('button',{name:'Agent chat',exact:true})).toHaveAttribute('aria-pressed','true');await expect(message).toHaveValue('Retain review chat draft');
 await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.xterm-host .xterm')).toBeVisible();
 await expect(filter).toHaveValue('second');await expect(page.getByRole('heading',{name:'src/second.ts',exact:true})).toBeVisible();
 expect(await original!.evaluate(node=>node.isConnected)).toBe(true);expect(await originalMessage!.evaluate(node=>node.isConnected)).toBe(true);
});

test('logical owner changes reset presentation and fence an old authenticated action retry',async({page})=>{
 const h=await fixture(page,{awaitComparison:true,paged:true});const region=page.getByRole('region',{name:'Code review workspace',exact:true});await expect(region).toBeVisible();
 const other={...h.row,id:'older-copy',title:'Older working copy'},context={...h.context,scopeKey:'d'.repeat(64),checkpoint:'older-checkpoint',owner:{...h.context.owner,threadId:other.id,title:other.title}};
 await page.route('**/api/shell/navigation?*',route=>route.fulfill({json:{sequence:1,total:2,items:[h.row,other],nextCursor:null,order:'created-desc',stats:{pinned:0,working:0,waiting:0,settled:2,minOrder:0,maxOrder:0}}}));
 await page.route('**/api/shell/navigation/older-copy',route=>route.fulfill({json:other}));
 await page.route('**/api/conversations/older-copy**',route=>{const url=new URL(route.request().url()),owner={authority:'personal',threadId:other.id,scopeKey:context.scopeKey,sequence:10};return route.fulfill({json:url.pathname.endsWith('/updates')?{...owner,fromSequence:10,owner:null,transcriptChanged:false,checkpoint:context.checkpoint}:url.pathname.endsWith('/transcript')?{...owner,messages:[],nextCursor:null}:context});});
 await page.getByRole('button',{name:'More conversations',exact:true}).click();
 await page.getByRole('searchbox',{name:'Filter files'}).fill('first');await page.getByRole('button',{name:'Agent chat',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original owner draft');
 await page.route('**/api/terminals**',route=>route.fulfill({json:{id:'review-terminal',output:'Synthetic terminal',start:0,cursor:18,exited:false,exitCode:null}}));
 await page.getByRole('button',{name:'Terminal',exact:true}).click();await expect(page.locator('.xterm-host .xterm')).toBeVisible();
 const original=await region.elementHandle();let posts=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/projects/project-a/actions',async route=>{posts++;await held;return route.fulfill({status:403,json:{error:{code:'AUTH_REQUIRED',message:'Renew session'}}});});
 await page.getByRole('button',{name:'Stage file',exact:true}).click();await expect.poll(()=>posts).toBe(1);
 try{
  await choose(page,'Project and working copy','Alpha / Older working copy');await expect(page.getByRole('combobox',{name:'Project and working copy',exact:true})).toContainText('Older working copy');
  expect(await original!.evaluate(node=>node.isConnected)).toBe(false);
  await expect(page.getByRole('searchbox',{name:'Filter files'})).toHaveValue('');await expect(page.getByRole('button',{name:'Agent chat',exact:true})).toHaveAttribute('aria-pressed','false');await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveAttribute('aria-pressed','false');
 }finally{release();}
 await choose(page,'Project and working copy','Alpha / Review changes');
 // Returning to the original owner observes the durable terminal outcome of the old callback.
 await expect(page.getByRole('alert').filter({hasText:'Action access revoked.'})).toBeVisible();expect(posts).toBe(1);
 await page.getByRole('button',{name:'Agent chat',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Original owner draft');
});
