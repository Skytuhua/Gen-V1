import {test,expect,type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {scopedContext} from '../scoped-conversation-fixture';
import type {CodeReviewComparison} from '../../packages/contracts/code-review';
const head='1'.repeat(40),revision='e'.repeat(64);
const local:CodeReviewComparison['identity']={kind:'local',id:'a'.repeat(64),scope:'worktree',headOid:head,branch:'topic',revision:'b'.repeat(64),base:{kind:'index',revision:'c'.repeat(64)},head:{kind:'worktree',revision:'b'.repeat(64)}};
const remote:CodeReviewComparison['identity']={kind:'pull-request',id:'d'.repeat(64),repo:'owner/repo',number:48,pullRequestId:'PR_48',baseOid:'2'.repeat(40),headOid:head,mergeBaseOid:'4'.repeat(40),baseRef:'main',headRef:'topic',semantics:'merge-base'};
const files=[{path:'src/first.ts',status:'MM',index:'M',worktree:'M',staged:true,untracked:false,binary:false,added:1,removed:1,additions:1,deletions:1}];
async function fixture(page:Page,{unbound=false,wrongProject=false,native=false,paged=false,side=false,readOnly=false}={}){
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
 await page.route('**/api/workspace/commands',route=>{const input=route.request().postDataJSON();if(input.type==='workspace.canvas.select')envelope.state.activeCanvasId=input.payload.canvasId;if(input.type==='workspace.panel.update')Object.assign(panel,input.payload.patch);if(input.type==='workspace.panel.add')canvases.find(canvas=>canvas.id===input.payload.canvasId)?.panels.push({...panel,...input.payload.panel});envelope.state.revision++;return route.fulfill({json:{commandId:input.id,seq:1,result:envelope}});});
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
 await page.goto('/code-review-host-check');return{context,requests,commands,actions,inspections,setOutcome:(value:string)=>{outcome=value;},setInspection:(value:string)=>{inspection=value;}};
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
test('same-owner reacquisition retains review and chat while holding tool actions',async({page})=>{
 const h=await fixture(page);const region=page.getByRole('region',{name:'Code review workspace',exact:true});await expect(region).toBeVisible();
 await page.getByRole('button',{name:'Agent chat',exact:true}).click();const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Retain review chat draft');
 const original=await region.elementHandle();let sent=false,reacquiring=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/conversations/review-a?*',async route=>{reacquiring=true;await held;await route.fulfill({json:h.context});});
 await page.route('**/api/conversations/review-a/updates?*',route=>{if(!sent){sent=true;return route.fulfill({status:400,json:{error:{code:'RESYNC_REQUIRED',message:'Reacquire unchanged owner'}}});}return route.fulfill({json:{authority:'personal',threadId:'review-a',scopeKey:h.context.scopeKey,sequence:10,fromSequence:10,owner:null,transcriptChanged:false,checkpoint:h.context.checkpoint}});});
 try{
  await expect.poll(()=>reacquiring).toBe(true);expect(await original!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(page.locator('.code-review-bound')).toHaveAttribute('inert','');await expect(page.getByRole('button',{name:'Stage file',exact:true})).toBeDisabled();expect(h.actions).toHaveLength(0);
 }finally{release();}
 await expect(page.locator('.code-review-bound')).not.toHaveAttribute('inert','');
 await expect(page.getByRole('button',{name:'Agent chat',exact:true})).toHaveAttribute('aria-pressed','true');await expect(message).toHaveValue('Retain review chat draft');
 expect(await original!.evaluate(node=>node.isConnected)).toBe(true);
});
