import {test,expect,type Page,type Route} from '@playwright/test';
const fixtureRoot=encodeURI('/@fs/'+process.cwd().replaceAll('\\','/'));

test.beforeEach(async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:404,json:{error:{message:'Unconfigured fixture request'}}}));
 await page.route('**/shared-panels-check*',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/shared-panels-fixture.tsx');</script></body></html>`}));
 await page.goto('/shared-panels-check');await expect(page.getByRole('complementary',{name:'Workspace panel'})).toBeVisible();
});
test('default launcher opens the real tool tabs and keeps browser and device boundaries',async({page})=>{
 const panel=page.getByRole('complementary',{name:'Workspace panel'}),launcher=panel.getByRole('region',{name:'Workspace launcher'});
 await expect(launcher.getByRole('button',{name:'Browser',exact:true})).toHaveCount(0);await expect(launcher.getByRole('button',{name:'Device',exact:true})).toBeDisabled();
 for(const [label,kind] of [['Terminal','terminal'],['Pull request','pull-request'],['Linked pull requests','linked-pull-requests']]){
  await panel.getByRole('tab',{name:'Artifact',exact:true}).click();await launcher.getByRole('button',{name:label,exact:true}).click();
  await expect(panel.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');await expect(panel.getByRole('tabpanel')).toContainText('Connect and select a project to use '+kind);
 }
 await panel.getByRole('tab',{name:'Output',exact:true}).click();await expect(panel.getByRole('tabpanel')).toContainText('Recorded executor receipts and output.');await expect(panel.getByRole('tabpanel')).not.toContainText('PTY input are unavailable');
});
test('canvas launch requests go to the owning canvas callback',async({page})=>{
 const canvas=page.getByRole('region',{name:'Canvas launcher'});
 for(const name of ['Terminal','Files','Diff','Pull request','Linked pull requests','Executor output','Usage'])await canvas.getByRole('button',{name,exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__opened)).toEqual(['terminal','files','diff','pull-request','linked-pull-requests','output','usage']);
 await expect(page.getByRole('tab',{name:'Artifact',exact:true})).toHaveAttribute('aria-selected','true');
});
test('browser layout handoff saves every duplicate editor and refuses a failed save',async({page})=>{
 await page.getByRole('textbox',{name:'first editor'}).fill('unsaved first');await page.getByRole('textbox',{name:'second editor'}).fill('unsaved second');
 await page.evaluate(()=>(window as any).__refuseSave=true);await page.getByRole('button',{name:'Prepare layout change'}).click();await expect(page.getByRole('alert')).toHaveText('Save refused');await expect(page.getByRole('textbox',{name:'first editor'})).toHaveValue('unsaved first');
 await page.evaluate(()=>(window as any).__refuseSave=false);await page.getByRole('button',{name:'Prepare layout change'}).click();await expect(page.getByRole('textbox',{name:'first editor'})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__saved)).toEqual(['second:unsaved second','first:unsaved first','second:unsaved second']);
});
test('saved terminal and pull request tabs restore through the shared panel',async({page})=>{
 for(const [kind,label] of [['terminal','Terminal'],['pull-request','Pull request'],['linked-pull-requests','Linked pull requests']]){
  await page.evaluate(tab=>localStorage.setItem('harness:shell-layout:v1',JSON.stringify({activeTab:tab})),kind);await page.reload();await expect(page.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');
 }
});
test('directory navigation rejects a file response from the previous selection',async({page})=>{
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{csrfToken:'fixture'}}));
 await page.route('**/api/projects/project-one/files?*',route=>route.fulfill({json:{entries:new URL(route.request().url()).searchParams.has('path')?[]:[{name:'late.txt',path:'late.txt',kind:'file'},{name:'next',path:'next',kind:'directory'}]}}));
 let pending:import('@playwright/test').Route|undefined;await page.route('**/api/projects/project-one/file?*',route=>{pending=route;});
 await page.goto('/shared-panels-check?project=1');const panel=page.getByRole('complementary',{name:'Workspace panel'});await panel.getByRole('tab',{name:'Files',exact:true}).click();
 const files=page.getByRole('navigation',{name:'Project files'});await files.getByRole('button',{name:'late.txt',exact:true}).click();await expect.poll(()=>Boolean(pending)).toBe(true);await files.getByRole('button',{name:'next',exact:true}).click();
 await pending!.fulfill({json:{text:'Content from the previous directory',binary:false,sha256:'a'.repeat(64)}});
 await expect(panel.locator('.live-files .panel-toolbar')).toContainText('next');await expect(panel.getByRole('region',{name:'File content'})).not.toContainText('Content from the previous directory');
});

async function pullRequestFixture(page:Page,options:{gitWrite?:boolean;missingWrite?:boolean;kind?:string;dirty?:boolean}={}){
 const state={head:'a'.repeat(40),revision:'c'.repeat(64),gitWrite:options.gitWrite??true,remoteHead:'a'.repeat(40)},actions:Record<string,any>[]=[],lists:string[]=[];
 let pendingCreate:Route|undefined,pendingReview:Route|undefined,holdCreate=false,holdReview=false;
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{csrfToken:'fixture'}}));
 await page.route('**/api/projects/project-one/git?*',route=>route.fulfill({json:{head:state.head,revision:state.revision,branch:'gen/review',mode:'managed',...(options.missingWrite?{}:{gitWrite:state.gitWrite}),files:options.dirty?[{path:'source.ts',index:' ',worktree:'M',staged:false,untracked:false,binary:false,added:1,removed:0}]:[],diff:'',stagedDiff:'',truncated:false}}));
 await page.route('**/api/projects/project-one/pull-requests?*',route=>{lists.push(route.request().url());return route.fulfill({json:{repo:'fixture/project',items:[12,13].map(number=>({number,title:'PR '+number,url:'https://github.com/fixture/project/pull/'+number,state:'OPEN'}))}});});
 await page.route('**/api/projects/project-one/pull-requests/*?*',route=>{const number=Number(new URL(route.request().url()).pathname.split('/').at(-1));return route.fulfill({json:{item:{number,title:'PR '+number,headRefOid:state.remoteHead,state:'OPEN',files:[],statusCheckRollup:[]},head:state.head,revision:state.revision,canReview:true}});});
 await page.route('**/api/projects/project-one/actions',async route=>{const command=route.request().postDataJSON();actions.push(command);if(command.type==='create-pr'&&holdCreate){pendingCreate=route;return;}if(command.type==='review-pr'&&holdReview){pendingReview=route;return;}await route.fulfill({json:{url:'https://github.com/fixture/project/pull/14'}});});
 await page.goto('/shared-panels-check?project=1&pr-panels='+(options.kind??'pull-request'));
 const panel=page.getByRole('region',{name:'first PR panel',exact:true});if(options.kind==='diff')await expect(panel.getByText('Changes',{exact:true})).toBeVisible();else await expect(panel.getByRole('button',{name:'#12 PR 12',exact:true})).toBeVisible();
 return{panel,state,actions,lists,holdCreate:()=>{holdCreate=true;},holdReview:()=>{holdReview=true;},releaseCreate:async()=>{await expect.poll(()=>Boolean(pendingCreate)).toBe(true);await pendingCreate!.fulfill({json:{url:'https://github.com/fixture/project/pull/14'}});},releaseReview:async()=>{await expect.poll(()=>Boolean(pendingReview)).toBe(true);await pendingReview!.fulfill({json:{id:1}});}};
}

test('PR forms and exact review drafts survive remount and reload independently per panel',async({page})=>{
 const{panel}=await pullRequestFixture(page);await panel.getByRole('button',{name:'New draft PR',exact:true}).click();
 await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Unsent PR title');await panel.getByRole('textbox',{name:'Description',exact:true}).fill('Unsent PR description');await panel.getByRole('textbox',{name:'Base branch',exact:true}).fill('release');await panel.getByRole('checkbox',{name:'Push this reviewed branch to GitHub'}).check();
 await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Review twelve stays');
 await panel.getByRole('button',{name:'#13 PR 13',exact:true}).click();await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Review thirteen stays');await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Review twelve stays');
 const second=page.getByRole('region',{name:'second PR panel',exact:true});await second.getByRole('button',{name:'New draft PR',exact:true}).click();await second.getByRole('textbox',{name:'Title',exact:true}).fill('Independent second title');
 await page.getByRole('button',{name:'Hide PR bodies'}).click();await page.getByRole('button',{name:'Show PR bodies'}).click();
 await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Unsent PR title');await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Review twelve stays');await expect(second.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Independent second title');
 await page.reload();await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Unsent PR title');await expect(panel.getByRole('textbox',{name:'Description',exact:true})).toHaveValue('Unsent PR description');await expect(panel.getByRole('textbox',{name:'Base branch',exact:true})).toHaveValue('release');await expect(panel.getByRole('checkbox',{name:'Push this reviewed branch to GitHub'})).toBeChecked();await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Review twelve stays');
});

test('linked PR surface reads its saved-link query and labels cached status truthfully',async({page})=>{
 const{panel,lists}=await pullRequestFixture(page,{kind:'linked'});expect(lists.length).toBeGreaterThan(0);expect(lists.every(url=>new URL(url).searchParams.get('linked')==='1')).toBe(true);await expect(panel).toContainText('Saved link');
 await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await expect(panel.locator('.pr-review')).toContainText('GitHub revision');
});

for(const mode of ['false','missing'] as const)test('PR mutations require explicit writable capability: '+mode,async({page})=>{
 const{panel,actions}=await pullRequestFixture(page,{gitWrite:false,missingWrite:mode==='missing'});await expect(panel.getByRole('button',{name:'New draft PR',exact:true})).toBeDisabled();await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await expect(panel.getByRole('button',{name:'Approve',exact:true})).toBeDisabled();
 await expect(panel.getByRole('button',{name:'Sign in to GitHub',exact:true})).toBeEnabled();await expect(panel.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled();expect(actions.filter(action=>['create-pr','review-pr'].includes(action.type))).toHaveLength(0);
});

test('late PR acknowledgments preserve newer create and review edits',async({page})=>{
 const host=await pullRequestFixture(page),{panel}=host;await panel.getByRole('button',{name:'New draft PR',exact:true}).click();await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Submitted title');host.holdCreate();await panel.getByRole('button',{name:'Create draft PR',exact:true}).click();await expect.poll(()=>host.actions.some(action=>action.type==='create-pr')).toBe(true);await page.getByRole('button',{name:'Prepare PR handoff'}).click();await expect(page.getByRole('alert')).toContainText('Wait for the pull request action');await expect(page.getByText('PR handoff ready',{exact:true})).toHaveCount(0);await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Newer unsent title');await host.releaseCreate();await expect(panel.getByRole('button',{name:'New draft PR',exact:true})).toBeEnabled();await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Newer unsent title');
 await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Submitted comment');host.holdReview();await panel.getByRole('button',{name:'Comment',exact:true}).click();await expect.poll(()=>host.actions.some(action=>action.type==='review-pr')).toBe(true);await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Newer unsent comment');await host.releaseReview();await expect(panel.getByRole('button',{name:'Comment',exact:true})).toBeEnabled();await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Newer unsent comment');await page.getByRole('button',{name:'Prepare PR handoff'}).click();await expect(page.getByText('PR handoff ready',{exact:true})).toBeVisible();
});

test('saved PR drafts retain their original revision and refuse stale submission',async({page})=>{
 const{panel,state,actions}=await pullRequestFixture(page);await panel.getByRole('button',{name:'New draft PR',exact:true}).click();await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Keep my old draft');await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Comment on old revision');
 state.head='b'.repeat(40);state.remoteHead=state.head;state.revision='d'.repeat(64);await page.getByRole('button',{name:'Hide PR bodies'}).click();await page.getByRole('button',{name:'Show PR bodies'}).click();
 await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep my old draft');await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Comment on old revision');await expect(panel.getByRole('button',{name:'Create draft PR',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Approve',exact:true})).toBeDisabled();expect(actions).toHaveLength(0);
});

test('a failed PR journal save blocks the existing layout handoff',async({page})=>{
 const{panel}=await pullRequestFixture(page);await panel.getByRole('button',{name:'New draft PR',exact:true}).click();
 await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){if(args[1]==='readwrite')throw Error('Synthetic journal write refused');return original.apply(this,args);};});
 await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Keep this unsaved title');await page.getByRole('button',{name:'Prepare PR handoff'}).click();await expect(page.getByRole('alert').filter({hasText:'Synthetic journal write refused'}).first()).toBeVisible();await expect(page.getByText('PR handoff ready',{exact:true})).toHaveCount(0);await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep this unsaved title');
});

test('PR handoff refuses an action started while the draft flush is pending',async({page})=>{
 const host=await pullRequestFixture(page),{panel}=host;
 await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();
 await page.evaluate(async()=>{const path='/src/journal.ts',journal=await import(path);await journal.journalFlush();});
 await page.evaluate(()=>{
  const w=window as any,original=IDBDatabase.prototype.transaction,setComplete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!.set!;
  w.__heldJournalCompletions=[];
  w.__restoreJournalTransactions=()=>{IDBDatabase.prototype.transaction=original;};
  IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const transaction=original.apply(this,args);if(args[1]==='readwrite')Object.defineProperty(transaction,'oncomplete',{set(callback){setComplete.call(transaction,(event:Event)=>w.__heldJournalCompletions.push(()=>callback.call(transaction,event)));}});return transaction;};
 });
 await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Keep this review during handoff');
 await expect.poll(()=>page.evaluate(()=>(window as any).__heldJournalCompletions.length)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Prepare PR handoff'}).click();host.holdReview();
 await panel.getByRole('button',{name:'Comment',exact:true}).click();
 await expect.poll(()=>host.actions.some(action=>action.type==='review-pr')).toBe(true);
 try{
  await page.evaluate(()=>{for(const complete of (window as any).__heldJournalCompletions.splice(0))complete();});
  await expect(page.getByRole('alert')).toContainText('Wait for the pull request action');
  await expect(page.getByText('PR handoff ready',{exact:true})).toHaveCount(0);
 }finally{await page.evaluate(()=>(window as any).__restoreJournalTransactions());await host.releaseReview();}
});

test('Diff actions reject false and missing write capability while writable worktrees still stage',async({page})=>{
 for(const missingWrite of [false,true]){const{panel,actions}=await pullRequestFixture(page,{kind:'diff',dirty:true,gitWrite:false,missingWrite});await expect(panel.getByRole('button',{name:'Stage',exact:true})).toBeDisabled();expect(actions).toHaveLength(0);}
 const{panel,actions}=await pullRequestFixture(page,{kind:'diff',dirty:true,gitWrite:true});await expect(panel.getByRole('button',{name:'Stage',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Stage',exact:true}).click();await expect.poll(()=>actions.filter(action=>action.type==='stage').length).toBe(1);expect(actions[0].payload).toMatchObject({paths:['source.ts'],expectedHead:'a'.repeat(40),revision:'c'.repeat(64)});
});

test('PR submission rechecks the worktree before creating or reviewing',async({page})=>{
 const{panel,state,actions}=await pullRequestFixture(page);await panel.getByRole('button',{name:'New draft PR',exact:true}).click();await panel.getByRole('textbox',{name:'Title',exact:true}).fill('Stale before submit');state.revision='d'.repeat(64);await panel.getByRole('button',{name:'Create draft PR',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('changed');expect(actions).toHaveLength(0);
 state.revision='c'.repeat(64);await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();await panel.getByRole('textbox',{name:'Review comment',exact:true}).fill('Stale review');state.gitWrite=false;await panel.getByRole('button',{name:'Approve',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('writable');expect(actions).toHaveLength(0);await expect(panel.getByRole('textbox',{name:'Review comment',exact:true})).toHaveValue('Stale review');
});

test('failed PR recovery never overwrites the saved draft and can retry safely',async({page})=>{
 await page.evaluate(()=>new Promise<void>((accept,reject)=>{const opening=indexedDB.open('generative-harness-journal',1);opening.onupgradeneeded=()=>opening.result.createObjectStore('entries');opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result,transaction=db.transaction('entries','readwrite'),key='pr-panel:'+JSON.stringify(['local','project-one','task-thread','pull-request','pr-first']);transaction.objectStore('entries').put({generation:'saved-before-failure',updatedAt:Date.now(),value:{version:1,draft:true,title:'Saved before read failure',body:'Saved description',baseBranch:'main',push:false,link:'',basis:{head:'a'.repeat(40),revision:'c'.repeat(64),branch:'gen/review',files:0},selected:null,comments:{}}},key);transaction.oncomplete=()=>{db.close();accept();};transaction.onerror=()=>reject(transaction.error);};}));
 await page.addInitScript(()=>{const w=window as any;w.__failPRRead=true;const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){if(w.__failPRRead&&(args[1]===undefined||args[1]==='readonly'))throw Error('Synthetic draft read unavailable');return original.apply(this,args);};});
 const{panel}=await pullRequestFixture(page);await expect(panel.getByRole('button',{name:'New draft PR',exact:true})).toBeDisabled();await expect(panel.getByRole('alert')).toContainText('draft read unavailable');await page.evaluate(()=>(window as any).__failPRRead=false);await panel.getByRole('button',{name:'Retry draft recovery',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Saved before read failure');
});

async function profileAuthFixture(page:Page){
 const actions:{action:string;payload:Record<string,unknown>}[]=[];let heldStart:Route|undefined,heldPoll:Route|undefined,holdStart=false,holdPoll=false,starts=0;
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{csrfToken:'fixture'}}));
 const flow=(n:number)=>({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,userCode:n===1?'ABCD-EFGH':'NEXT-CODE',url:'https://github.com/login/device',expiresAt:Date.now()+60000,interval:1000});
 await page.route('**/api/github/auth/*',async route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1)!;actions.push({action,payload:route.request().postDataJSON()});if(action==='start'){starts++;if(holdStart){heldStart=route;return;}await route.fulfill({json:flow(starts)});}else if(action==='poll'){if(holdPoll){heldPoll=route;return;}await route.fulfill({json:{status:'pending'}});}else await route.fulfill({json:{status:'cancelled'}});});
 await page.goto('/shared-panels-check');const panel=page.getByRole('complementary',{name:'Workspace panel'});await panel.getByRole('tab',{name:'Artifact',exact:true}).click();await panel.getByRole('button',{name:'Pull request',exact:true}).click();
 return{panel,actions,flow,holdStart:()=>{holdStart=true;},holdPoll:()=>{holdPoll=true;},releaseStart:async()=>{await expect.poll(()=>!!heldStart).toBe(true);await heldStart!.fulfill({json:flow(1)});},releasePoll:async()=>{await expect.poll(()=>!!heldPoll).toBe(true);await heldPoll!.fulfill({json:{status:'authenticated',login:'stale-user'}});}};
}
test('profile sign-in works without a project and leaves the Terminal project gate intact',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);const{panel,actions}=await profileAuthFixture(page);await expect(panel.getByRole('button',{name:'Sign in to GitHub',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();
 await expect(panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await expect(panel.getByRole('link',{name:'https://github.com/login/device',exact:true})).toHaveAttribute('href','https://github.com/login/device');await expect(panel).toContainText('Waiting for GitHub');await expect(panel).toContainText('Expires');
 await panel.getByRole('button',{name:'Copy code',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('ABCD-EFGH');await expect(panel.getByRole('status')).toContainText('Copied');await panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect.poll(()=>actions.some(item=>item.action==='cancel')).toBe(true);await expect(panel).toContainText('Sign-in cancelled');
 await panel.getByRole('tab',{name:'Terminal',exact:true}).click();await expect(panel).toContainText('Connect and select a project to use terminal');
});
test('cancelled profile sign-in ignores an authenticated stale poll response',async({page})=>{
 const host=await profileAuthFixture(page);host.holdPoll();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect.poll(()=>host.actions.some(item=>item.action==='poll')).toBe(true);await host.panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await host.releasePoll();await expect(host.panel).toContainText('Sign-in cancelled');await expect(host.panel).not.toContainText('stale-user');
});
test('cancel during start cancels the returned host flow without polling it',async({page})=>{
 const host=await profileAuthFixture(page);host.holdStart();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await host.panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await host.releaseStart();await expect.poll(()=>host.actions.some(item=>item.action==='cancel')).toBe(true);expect(host.actions.filter(item=>item.action==='poll')).toEqual([]);await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toHaveCount(0);
});
test('profile sign-in expires locally and cancels the host flow',async({page})=>{
 const host=await profileAuthFixture(page);await page.clock.install();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await page.clock.fastForward(61000);await expect(host.panel).toContainText('Sign-in expired');await expect.poll(()=>host.actions.some(item=>item.action==='cancel')).toBe(true);
});
test('profile sign-in reports start and cancellation failures with a retry',async({page})=>{
 const host=await profileAuthFixture(page);await page.route('**/api/github/auth/start',route=>route.fulfill({status:400,json:{error:{message:'GitHub unavailable'}}}));await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByRole('alert')).toContainText('GitHub unavailable');await page.unroute('**/api/github/auth/start');await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();
 await page.route('**/api/github/auth/cancel',route=>route.fulfill({status:500,json:{error:{message:'Cancel not confirmed'}}}));await host.panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(host.panel.getByRole('alert')).toContainText('Cancel not confirmed');await page.unroute('**/api/github/auth/cancel');await host.panel.getByRole('button',{name:'Retry cancellation',exact:true}).click();await expect(host.panel).toContainText('Sign-in cancelled');
});

test('profile sign-in expires while a poll is still in flight and ignores its late success',async({page})=>{
 const host=await profileAuthFixture(page);await page.clock.install();host.holdPoll();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();await page.clock.fastForward(1100);await expect.poll(()=>host.actions.some(item=>item.action==='poll')).toBe(true);await page.clock.fastForward(61000);await expect(host.panel).toContainText('Sign-in expired');await host.releasePoll();await expect(host.panel).not.toContainText('stale-user');await expect.poll(()=>host.actions.some(item=>item.action==='cancel')).toBe(true);
});

test('replacement profile sign-in ignores the old poll without clearing the new code',async({page})=>{
 const host=await profileAuthFixture(page);host.holdPoll();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect.poll(()=>host.actions.some(item=>item.action==='poll')).toBe(true);await host.panel.getByRole('button',{name:'Start new sign-in',exact:true}).click();await expect(host.panel.getByText('NEXT-CODE',{exact:true})).toBeVisible();await host.releasePoll();await expect(host.panel.getByText('NEXT-CODE',{exact:true})).toBeVisible();await expect(host.panel).not.toContainText('stale-user');
});
test('a stale cancelled start response cannot replace or clear a newer sign-in',async({page})=>{
 const host=await profileAuthFixture(page);host.holdStart();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await host.panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
 await page.route('**/api/github/auth/start',route=>route.fulfill({json:host.flow(2)}));await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByText('NEXT-CODE',{exact:true})).toBeVisible();await host.releaseStart();await expect.poll(()=>host.actions.some(item=>item.action==='cancel'&&item.payload.flowId===host.flow(1).id)).toBe(true);await expect(host.panel.getByText('NEXT-CODE',{exact:true})).toBeVisible();await expect(host.panel).toContainText('Waiting for GitHub');
});
test('a disconnected project can still sign in through the profile route',async({page})=>{
 const host=await profileAuthFixture(page);await page.route('**/api/projects/project-one/**',route=>route.fulfill({status:400,json:{error:{code:'PROJECT_NOT_CONNECTED',message:'Project folder unavailable'}}}));await page.goto('/shared-panels-check?project=1');await host.panel.getByRole('tab',{name:'Pull request',exact:true}).click();await expect(host.panel.getByRole('alert').first()).toContainText('Project folder unavailable');await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();expect(host.actions.find(item=>item.action==='start')?.payload).toEqual({});
});
test('invalid profile sign-in responses show one actionable error and never expose an arbitrary opener',async({page})=>{
 const host=await profileAuthFixture(page);await page.route('**/api/github/auth/start',route=>route.fulfill({json:{...host.flow(1),url:'https://evil.example/device'}}));await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect(host.panel.getByRole('alert')).toHaveText('GitHub returned an invalid sign-in response. Start a new sign-in.');await expect(host.panel.locator('a[href="https://evil.example/device"]')).toHaveCount(0);
});

test('profile sign-in wraps within narrow tools in both themes and keeps keyboard actions reachable',async({page})=>{
 const host=await profileAuthFixture(page);await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).focus();await page.keyboard.press('Enter');await expect(host.panel.getByText('ABCD-EFGH',{exact:true})).toBeVisible();const leaf=host.panel.getByRole('region',{name:'GitHub sign-in',exact:true});
 for(const theme of ['light','dark'])for(const width of [240,400]){
  await page.evaluate(({theme,width})=>{document.documentElement.dataset.theme=theme;(document.querySelector('.github-sign-in') as HTMLElement).style.width=width+'px';},{theme,width});
  expect(await leaf.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);const bounds=await leaf.boundingBox();expect(bounds).not.toBeNull();
  for(const control of await leaf.locator('button,a').all()){const rect=await control.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x+12);expect(rect!.x+rect!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width-12);}
  if(process.env.AUTH_EVIDENCE_DIR)await leaf.screenshot({path:process.env.AUTH_EVIDENCE_DIR+`/sign-in-${theme}-${width}.png`});
 }
});

test('profile cancellation reports sign-in completion when the host commit already won',async({page})=>{
 const host=await profileAuthFixture(page);host.holdPoll();await host.panel.getByRole('button',{name:'Sign in to GitHub',exact:true}).click();await expect.poll(()=>host.actions.some(item=>item.action==='poll')).toBe(true);await page.route('**/api/github/auth/cancel',route=>route.fulfill({json:{status:'authenticated',login:'completed-user'}}));await host.panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(host.panel).toContainText('Sign-in completed as completed-user before cancellation.');await host.releasePoll();await expect(host.panel).not.toContainText('stale-user');await expect(host.panel).not.toContainText('Sign-in cancelled');
});
