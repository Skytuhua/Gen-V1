import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture,serveTaskSplitLayout} from './task-interface-fixture';
import {EMPTY_USAGE} from '../../packages/contracts';
import {planDataId,PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import {CHAT_LAYOUT_KEY} from '../../packages/ui-shell/chat-layout';
const fixture=()=>{const s=taskFixture({root:'field',elements:{field:{type:'Input',props:{stateKey:'name',label:'Review name'}}}});s.usage['task-thread']={...EMPTY_USAGE,inputTokens:1234};s.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-10-30T00:00:00Z',value:{version:1,title:'Repair checkout failures',steps:[{id:'inspect',title:'Inspect the task boundary',status:'working',requirements:[],agentIds:[]}],agents:[]}});return s;};
async function bridge(page:Page,surface:Record<string,unknown>={kind:'main'}){
 await page.addInitScript(value=>{
  const w=window as unknown as Record<string,any>,windowId=value.kind==='main'?'main':'satellite';
  let windows:any[]=[{id:'main',surface:{kind:'main'},ready:true,minimized:false},...(windowId==='main'?[]:[{id:windowId,surface:value,ready:true,minimized:false}])];
  const context=()=>({windowId,surface:value,windows});w.__desktopCalls=[];w.__detachSeq=0;
  w.harnessDesktop={getContext:async()=>context(),ready:async()=>context(),list:async()=>windows,
   onState:(fn:(state:any)=>void)=>{w.__desktopState=(state:any)=>{windows=state.windows;fn(state);};return()=>{};},
   onCloseRequested:(fn:()=>Promise<boolean>)=>{w.__closeDesktop=fn;return()=>{};},
   detach:async(next:unknown)=>{w.__desktopCalls.push(['detach',next]);const info={id:'detached-'+String(++w.__detachSeq),surface:next,ready:true,minimized:false};windows=[...windows,info];w.__desktopState?.({windows});return info;},
   reattach:async()=>{w.__desktopCalls.push(['reattach']);},minimize:async()=>{w.__desktopCalls.push(['minimize']);},resetBounds:async()=>{},
   focus:async(id:string)=>{w.__desktopCalls.push(['focus',id]);},browser:async(command:unknown)=>{w.__desktopCalls.push(['browser',command]);if(w.__desktopFail)throw Error('Native browser action failed');}};
 },surface);
}
test('desktop context and usage minimize in the workspace while thread detachment stays available',async({page})=>{
 await bridge(page);
 await serveTaskFixture(page,fixture());
 await serveTaskSplitLayout(page);
 await page.goto('/');
 await page.getByRole('button',{name:/^Source-bound task fixture, Ready/}).click();
 const overview=page.getByRole('region',{name:'Project overview window',exact:true});
 await expect(overview).toBeVisible({timeout:15000});
 const toggle=overview.locator('.docked-summary-toggle');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await expect(overview.getByRole('region',{name:'Plan summary',exact:true})).toContainText('Repair checkout failures');
 await page.getByRole('button',{name:'Collapse Project overview',exact:true}).click();
 await expect(toggle).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Show live usage',exact:true}).click();
 await page.getByRole('button',{name:'Inspect live usage',exact:true}).click();
 await expect(page.getByRole('region',{name:'Runtime usage details',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Minimize live usage',exact:true}).click();
 await expect(page.getByRole('region',{name:'Runtime usage details',exact:true})).toBeHidden();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:/^Detach (thread|artifact|workspace|plan|navigation|browser)|^Minimize chat window$/})).toHaveCount(0);
 await page.getByRole('button',{name:'Options for Source-bound task fixture',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'Detach thread',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>['detach','minimize'].includes(call[0])))).toEqual([]);
});
test('authoritative detached plan ignores URL descriptors and restores its owning thread',async({page})=>{await bridge(page,{kind:'plan',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/?desktopWindow=ignored&threadId=wrong');await expect(page.getByRole('region',{name:'Plan summary',exact:true})).toContainText('Repair checkout failures');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Return to workspace',exact:true}).click();expect(await page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['reattach']);});
test('an artifact stays editable in the main window with no new-detachment entry',async({page})=>{await bridge(page);await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Ada');await expect(page.getByRole('button',{name:'Detach artifact',exact:true})).toHaveCount(0);await expect(input).toBeEnabled();await expect(input).toHaveValue('Ada');expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});
test('browser clients expose no native window controls',async({page})=>{await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('button',{name:'Minimize chat window',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Detach artifact',exact:true})).toHaveCount(0);});

test('native workspace notifications refresh authenticated state without opening renderer event streams',async({page})=>{
 await bridge(page);const snapshot=fixture();await serveTaskFixture(page,snapshot);
 await page.addInitScript(()=>{const w=window as any;w.__eventStreams=0;const Original=EventSource;Object.defineProperty(window,'EventSource',{value:class extends Original{constructor(...args:ConstructorParameters<typeof EventSource>){super(...args);w.__eventStreams++;}}});w.harnessDesktop.onWorkspaceChanged=(listener:unknown)=>{w.__workspaceChanged=listener;return()=>{w.__workspaceChanged=undefined;};};});
 await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await expect(input).toBeEnabled();expect(await page.evaluate(()=>(window as any).__eventStreams)).toBe(0);
 snapshot.seq++;snapshot.userStates[0]={...snapshot.userStates[0],revision:1,values:{name:'Accepted from another native window'}};
 await page.evaluate(sequence=>(window as any).__workspaceChanged({connected:true,sequence}),snapshot.seq);await expect(input).toHaveValue('Accepted from another native window');
 await page.evaluate(sequence=>(window as any).__workspaceChanged({connected:false,sequence}),snapshot.seq);await expect(page.getByText('Reconnecting',{exact:true})).toBeVisible();
 snapshot.seq++;snapshot.userStates[0]={...snapshot.userStates[0],revision:2,values:{name:'Recovered after native host reconnect'}};
 await page.evaluate(sequence=>(window as any).__workspaceChanged({connected:true,sequence}),snapshot.seq);await expect(input).toHaveValue('Recovered after native host reconnect');await expect(page.getByText('Reconnecting',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__eventStreams)).toBe(0);
});

test('close acknowledgment freezes editing until native cancellation resumes the same draft',async({page})=>{await bridge(page);const s=fixture();const host=await serveTaskFixture(page,s);await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Before close');expect(await page.evaluate(()=>(window as any).__closeDesktop())).toBe(true);await expect.poll(()=>input.evaluate(node=>Boolean(node.closest('[inert]')))).toBe(true);await page.evaluate(()=>(window as any).__desktopState({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}],closeCancelled:true}));await expect.poll(()=>input.evaluate(node=>Boolean(node.closest('[inert]')))).toBe(false);await expect(input).toHaveValue('Before close');expect(host.commands.some(command=>command.type==='state.save')).toBe(true);});
test('desktop draft import preserves collisions and blocks stale artifact revisions',async({page})=>{await bridge(page);await serveTaskFixture(page,fixture());await page.goto('/');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this local text');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();const backup={app:'generative-harness-drafts',version:1,entries:[{key:'draft:task-thread',record:{value:'Old imported text',generation:'old',updatedAt:1}},{key:'state:task-state',record:{value:{baseRevision:999,values:{name:'stale'}},generation:'state',updatedAt:1}},{key:'draft:missing-thread',record:{value:'Unowned text',generation:'missing',updatedAt:1}}]};await page.getByLabel('Draft backup file',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.locator('.draft-transfer [role="status"]')).toContainText('0 drafts imported');await page.getByText('Import results',{exact:true}).click();await expect(page.getByText(/A local entry already exists/)).toBeVisible();await expect(page.getByText(/Artifact revision changed/)).toBeVisible();await expect(page.getByText(/Conversation is unavailable/)).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this local text');});
test('browser draft export is explicit and does not clear the source',async({page})=>{await serveTaskFixture(page,fixture());await page.goto('/');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Take this draft to desktop');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export local drafts',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe('harness-drafts.json');await expect(page.getByRole('button',{name:'Import browser drafts',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Take this draft to desktop');});

test('native close saves the latest edit and lease before acknowledgment, retaining source DOM',async({page})=>{await bridge(page);const host=await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Final acknowledged value');const node=await input.elementHandle();expect(await page.evaluate(()=>(window as any).__closeDesktop())).toBe(true);expect(host.snapshot.userStates[0].values.name).toBe('Final acknowledged value');expect(await node!.evaluate(element=>Boolean(element.closest('[inert]')))).toBe(true);expect(await node!.evaluate(element=>element.isConnected)).toBe(true);const saved=host.commands.findIndex(command=>command.type==='state.save'),ended=host.commands.findIndex((command,index)=>index>saved&&command.type==='edit.end');expect(saved).toBeGreaterThanOrEqual(0);expect(ended).toBeGreaterThan(saved);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});
test('native close freezes the same workspace editor alias after acknowledged saving',async({page})=>{await bridge(page);const host=await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Workspace edit');const node=await input.elementHandle();await page.getByRole('button',{name:'Open artifact in workspace',exact:true}).click();await expect(page.getByRole('button',{name:'Detach workspace',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__closeDesktop())).toBe(true);await expect.poll(()=>node!.evaluate(element=>Boolean(element.closest('[inert]')))).toBe(true);expect(await node!.evaluate(element=>element.isConnected)).toBe(true);expect(host.commands.some(command=>command.type==='state.save'&&(command.payload.values as any).name==='Workspace edit')).toBe(true);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});
test('sidebar detaches a thread into its own window and the main workspace stays usable',async({page})=>{
 await bridge(page);
 const s=fixture();s.threads.push({...s.threads[0],id:'second-thread',title:'Second conversation'});
 await serveTaskFixture(page,s);
 await serveTaskSplitLayout(page);
 await page.goto('/');
 await page.getByRole('button',{name:/^Source-bound task fixture, Ready/}).click();
 const input=page.getByRole('textbox',{name:'Review name',exact:true});
 await input.fill('Sidebar edit');
 await page.getByRole('button',{name:'Options for Source-bound task fixture',exact:true}).click();
 await page.getByRole('menuitem',{name:'Detach thread',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['detach',{kind:'thread',threadId:'task-thread'}]);
 await expect(page.locator('.notice',{hasText:'Conversation open in another window.'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Focus chat',exact:true})).toBeVisible();
 const heldComposer=page.getByRole('textbox',{name:'Message',exact:true});
 await expect.poll(()=>heldComposer.evaluate(node=>Boolean(node.closest('[inert]')))).toBe(true);
 await expect.poll(()=>input.evaluate(node=>Boolean(node.closest('[inert]')))).toBe(true);
 await page.getByRole('button',{name:/^Source-bound task fixture, Ready/}).click();
 expect(await page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['focus','detached-1']);
 await page.getByRole('button',{name:/^Second conversation, Ready/}).click();
 await expect(page.locator('.breadcrumb:visible').filter({hasText:'Second conversation'})).toHaveCount(1);
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.evaluate(()=>(window as any).__desktopState({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}],focusSurface:{kind:'thread',threadId:'task-thread'}}));
 await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toHaveValue('Sidebar edit');
 await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toBeEnabled();
});
test('detached workspace selection does not acquire an unacknowledged second artifact editor',async({page})=>{await bridge(page,{kind:'workspace',threadId:'task-thread',tab:'artifact',artifactId:'task-surface'});const s=fixture();s.artifacts.push({...s.artifacts[0],id:'second-artifact',stateId:'second-state',title:'Second artifact'});s.userStates.push({...s.userStates[0],id:'second-state'});await serveTaskFixture(page,s);await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Keep the owning editor');await page.getByRole('combobox',{name:'Workspace artifact',exact:true}).click();await page.getByRole('option',{name:'Second artifact',exact:true}).click();await expect(page.getByRole('alert').filter({hasText: 'Open this artifact from the main workspace. Your current editor is kept open.'})).toBeVisible();await expect(page.locator('[data-artifact-id="second-artifact"]')).toHaveCount(0);await expect(input).toBeEnabled();await expect(input).toHaveValue('Keep the owning editor');expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});
test('navigation windows never mount hidden editable artifacts or a composer',async({page})=>{await bridge(page,{kind:'navigation'});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('complementary',{name:'Thread navigation',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();expect(await page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['reattach']);});

test('native close acknowledges an unrecovered composer workspace without detaching',async({page})=>{await bridge(page);await page.addInitScript(()=>{Object.defineProperty(indexedDB,'open',{value:()=>{throw Error('IDB unavailable');}});const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('harness:journal-pending:'))throw Error('Staging unavailable');return original.call(this,key,value);};});await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Message',exact:true});await expect(input).toBeDisabled();await expect(page.getByRole('alert').filter({hasText:'Draft recovery failed. Reopen this workspace to retry.'})).toBeVisible();expect(await page.evaluate(()=>(window as any).__closeDesktop())).toBe(true);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});
test('upload preprocessing blocks native close before the canonical PNG is journaled',async({page})=>{await bridge(page);await page.addInitScript(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const file=this;return new Promise<ArrayBuffer>(resolve=>{(window as any).__releaseUpload=()=>void original.call(file).then(resolve);});};});const s=fixture();s.artifacts[0].spec={root:'signature',elements:{signature:{type:'SignaturePad',props:{stateKey:'signature',initialMode:'upload'}}}};await serveTaskFixture(page,s);await page.goto('/');await page.getByLabel('Upload PNG signature',{exact:true}).setInputFiles({name:'mark.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});expect(await page.evaluate(()=>(window as any).__closeDesktop())).toBe(false);await expect(page.getByRole('alert')).toContainText('signature mark');expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach').length)).toBe(0);await expect(page.getByLabel('Upload PNG signature',{exact:true})).toBeEnabled();});

test('compatible browser draft import restores the live composer and survives reload',async({page})=>{await bridge(page);await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();const backup={app:'generative-harness-drafts',version:1,entries:[{key:'draft:task-thread',record:{value:'Continue from browser backup',generation:'browser-original',updatedAt:1}}]};await page.getByLabel('Draft backup file',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.locator('.draft-transfer [role="status"]')).toContainText('1 drafts imported');await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Continue from browser backup');await page.reload();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Continue from browser backup');});

test('imported artifact draft updates the already mounted editor before another edit',async({page})=>{await bridge(page);await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toHaveValue('');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();const backup={app:'generative-harness-drafts',version:1,entries:[{key:'state:task-state',record:{value:{baseRevision:0,values:{name:'Imported artifact value'}},generation:'browser-state',updatedAt:1}}]};await page.getByLabel('Draft backup file',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.locator('.draft-transfer [role="status"]')).toContainText('1 drafts imported');await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toHaveValue('Imported artifact value');});

test('export refuses pending signature assets instead of silently omitting the mark',async({page})=>{await bridge(page);await page.addInitScript(()=>{File.prototype.arrayBuffer=function(){return new Promise<ArrayBuffer>(()=>{});};});const value=fixture();value.artifacts[0].spec={root:'signature',elements:{signature:{type:'SignaturePad',props:{stateKey:'signature',initialMode:'upload'}}}};await serveTaskFixture(page,value);await page.goto('/');await page.getByLabel('Upload PNG signature',{exact:true}).setInputFiles({name:'mark.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));await page.getByRole('button',{name:'Export local drafts',exact:true}).click();await expect(page.getByRole('region',{name:'Browser draft transfer'}).getByRole('alert')).toContainText('Save or clear the pending signature mark');expect(downloads).toEqual([]);});

test('source editor recovers a durable satellite draft when editing ownership returns',async({page})=>{await bridge(page);await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await expect(input).toBeEnabled();const node=await input.elementHandle();await page.evaluate(()=>(window as any).__desktopState({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false},{id:'existing-artifact',surface:{kind:'artifact',threadId:'task-thread',artifactId:'task-surface'},ready:true,minimized:false}]}));await expect(page.getByText('Editing in a detached window.',{exact:true})).toBeVisible();await expect.poll(()=>node!.evaluate(element=>Boolean(element.closest('[inert]')))).toBe(true);await page.evaluate(async()=>{const path='/src/journal.ts',journal=await import(path);await journal.journalWrite('state:task-state',{baseRevision:0,values:{name:'Recovered after satellite failure'}});(window as any).__desktopState({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false}]});});await expect(input).toHaveValue('Recovered after satellite failure');await expect(input).toBeEnabled();expect(await node!.evaluate(element=>element.isConnected)).toBe(true);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);});

test('desktop sign-in uses the fixed native launcher without requiring pnpm',async({page})=>{await bridge(page);await page.addInitScript(()=>{window.harnessDesktop!.signIn=async()=>{(window as any).__desktopCalls.push(['signIn']);};});await serveTaskFixture(page,fixture());await page.route('**/api/composer-prediction/cancel',route=>route.fulfill({json:{cancelled:true}}));await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Models & Accounts',exact:true}).click();await page.getByRole('button',{name:'Connect ChatGPT / Codex',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['signIn']);await expect(page.getByText('Connection console opened. Complete setup in that console, then check connection status.',{exact:true})).toBeVisible();await expect(page.locator('.terminal-command')).toHaveCount(0);});

test('desktop readiness does not wait for slow model discovery',async({page})=>{await bridge(page);await page.addInitScript(()=>{const desktop=window.harnessDesktop!;desktop.ready=async()=>{(window as any).__desktopCalls.push(['ready']);return desktop.getContext();};});await serveTaskFixture(page,fixture());let release!:()=>void;const pending=new Promise<void>(accept=>{release=accept;});await page.route('**/api/models*',async route=>{await pending;await route.fulfill({json:{models:[]}});});try{await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).__desktopCalls.some((call:any)=>call[0]==='ready'))).toBe(true);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();}finally{release();}});

test('review: startup does not expose an ownerless composer before the initial snapshot',async({page})=>{
 await bridge(page);await page.addInitScript(()=>localStorage.setItem('harness:selected-thread','task-thread'));
 const host=await serveTaskFixture(page,fixture());let release!:()=>void,requested=false;
 const pending=new Promise<void>(accept=>{release=accept;});
 await page.route('**/api/snapshot',async route=>{requested=true;await pending;await route.fulfill({json:host.snapshot});});
 try{await page.goto('/');await expect.poll(()=>requested).toBe(true);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Attach files',exact:true})).toHaveCount(0);}
 finally{release();}
 const composer=page.getByRole('textbox',{name:'Message',exact:true});await expect(composer).toBeEnabled();await composer.fill('Owned from the first editable frame');
 await expect.poll(()=>page.evaluate(async()=>{const path='/src/journal.ts';const journal=await import(path);return journal.journalRead('draft:task-thread');})).toBe('Owned from the first editable frame');
});

for(const required of [false,true])test(`review: clearing an enum ${required?'retains required validation':'omits the optional response'}`,async({page})=>{
 await bridge(page);const snapshot=fixture();snapshot.requests=[{id:'enum-choice',threadId:'task-thread',artifactId:null,revision:1,title:'Choose a delivery route',prompt:'Choose a route if needed.',responseSchema:{type:'object',properties:{choice:{type:'string',title:'Delivery route',enum:['alpha','beta']}},...(required?{required:['choice']}:{})},basis:[],status:'pending'}];
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const select=page.getByRole('combobox',{name:'Delivery route',exact:true});await select.click();await page.getByRole('option',{name:'beta',exact:true}).click();await select.click();await page.getByRole('option',{name:'Choose…',exact:true}).click();await expect(select).toHaveText('Choose…');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 if(required){await expect(select).toHaveAttribute('aria-invalid','true');await expect(select).toBeFocused();expect(host.commands.filter(command=>command.type==='request.respond')).toHaveLength(0);}
 else{await expect.poll(()=>host.commands.filter(command=>command.type==='request.respond').length).toBe(1);expect(host.commands.find(command=>command.type==='request.respond')?.payload.response).toEqual({});}
});

test('review: an existing native browser action remains visible and retryable',async({page})=>{
 await bridge(page,{kind:'browser',browserId:'retry-existing'});await serveTaskFixture(page,fixture());const unhandled:string[]=[];page.on('pageerror',error=>unhandled.push(error.message));await page.goto('/');
 await page.evaluate(()=>(window as any).__desktopFail=true);const reload=page.getByRole('button',{name:'Reload browser',exact:true});await reload.click();
 await expect(page.getByRole('alert')).toContainText('Native browser action failed');expect(unhandled).toEqual([]);await expect(reload).toBeEnabled();await page.evaluate(()=>(window as any).__desktopFail=false);await reload.click();await expect(page.getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='browser'&&call[1].type==='reload').length)).toBe(2);expect(await page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='detach'))).toEqual([]);
});

test('review: a failed detached workspace close retains the editable surface',async({page})=>{
 await bridge(page,{kind:'workspace',threadId:'task-thread',tab:'artifact',artifactId:'task-surface'});await page.addInitScript(()=>{window.harnessDesktop!.reattach=async()=>{throw Error('Dock destination is unavailable');};});await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Keep this workspace edit');await page.getByRole('button',{name:'Close workspace panel',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText: 'Dock destination is unavailable'})).toBeVisible();await expect(input).toHaveValue('Keep this workspace edit');await expect(input).toBeEnabled();
});

test('review: standalone workspace uses native sizing instead of inactive panel maximize controls',async({page})=>{
 await bridge(page,{kind:'workspace',threadId:'task-thread',tab:'files'});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('complementary',{name:'Workspace panel',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Maximize workspace panel',exact:true})).toHaveCount(0);await expect(page.getByRole('separator',{name:'Resize workspace panel',exact:true})).toHaveCount(0);
});

test('review: detached browser follows saved theme and subsequent system changes',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await bridge(page,{kind:'browser',browserId:'theme-review'});const snapshot=fixture();snapshot.settings.theme='dark';const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.locator('.desktop-browser-toolbar')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 snapshot.settings.theme='light';await host.publish();await expect(page.locator('html')).toHaveAttribute('data-theme','light');snapshot.settings.theme='system';await page.emulateMedia({colorScheme:'dark'});await host.publish();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

async function checkSinglePanelOpener(page:Page,draft:string){
 const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill(draft);
 await expect(composer).toHaveCount(1);const retained=await composer.elementHandle();
 const opener=page.getByRole('button',{name:'Open workspace panel',exact:true});await expect(opener).toHaveCount(1);await opener.click();
 const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true});await expect(panel).toBeVisible();
 const close=page.getByRole('button',{name:'Hide workspace panel',exact:true});await expect(close).toHaveCount(1);await close.click();await expect(panel).toBeHidden();
 await expect(opener).toBeFocused();await expect(composer).toHaveValue(draft);await expect(composer).toHaveCount(1);
 expect(await retained!.evaluate(element=>element.isConnected&&element===document.querySelector('textarea[aria-label="Message"]'))).toBe(true);
}

test('M15 panel opener: an ordinary new conversation has one reachable workspace control',async({page})=>{
 const snapshot=fixture();snapshot.activeThreadId=null;snapshot.threads=[];snapshot.messages=[];snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];snapshot.usage={};
 const host=await serveTaskFixture(page,snapshot);await serveTaskSplitLayout(page,snapshot);await page.goto('/');
 await checkSinglePanelOpener(page,'Retain the ordinary new-conversation draft');
 expect(host.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toEqual([]);
});

test('M15 panel opener: a pinned native thread retains its workspace control',async({page})=>{
 // Scripted native bridge with real App; this does not launch an installed desktop.
 await bridge(page,{kind:'thread',threadId:'task-thread'});const host=await serveTaskFixture(page,fixture());await page.goto('/');
 await checkSinglePanelOpener(page,'Retain the pinned native-thread draft');await expect(page.locator('.workspace-controls')).toHaveCount(0);
 expect(host.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toEqual([]);
 expect(await page.evaluate(()=>(window as any).__desktopCalls)).toEqual([]);
});

test('native close waits for a source backup to finish parsing and retains a failed import until retry',async({page})=>{
 // Real App, journal, import, and editor registry. The native bridge and host
 // HTTP are scripted; this does not launch an installed desktop or grant sources.
 await bridge(page);
 await page.addInitScript(()=>{
  const state=window as unknown as {__holdSourceImport?:boolean;__releaseSourceImport?:()=>void;__failSourceImport?:boolean};
  state.__holdSourceImport=true;
  const read=File.prototype.text,put=IDBObjectStore.prototype.put;
  File.prototype.text=function(this:File){
   if(this.name!=='source-bundle.json'||!state.__holdSourceImport)return read.call(this);
   const file=this;return new Promise<string>((resolve,reject)=>{state.__releaseSourceImport=()=>{state.__releaseSourceImport=undefined;void read.call(file).then(resolve,reject);};});
  };
  IDBObjectStore.prototype.put=function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
   if(state.__failSourceImport&&typeof key==='string'&&key.startsWith('source-context:'))throw new DOMException('Scripted source import commit failed','QuotaExceededError');
   return put.call(this,value,key);
  };
 });
 const snapshot=fixture();snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];
 const host=await serveTaskFixture(page,snapshot);await serveTaskSplitLayout(page,snapshot);
 const owner={threadId:'task-thread',projectId:null,workspaceId:null};
 const key='source-context:task-thread::';
 const sourceRef={captureId:'backup-capture',keepCaptured:true,source:{kind:'MESSAGE',sourceId:'reply',sourceRevision:'backup-revision',logicalOwner:owner,contentDigest:'a'.repeat(64),capturedAt:'2026-11-15T10:00:00.000Z',range:{encoding:'UTF16',start:0,end:9,selectedTextDigest:'b'.repeat(64)}}};
 const source={draftId:'backup-draft',logicalOwner:owner,revision:7,sourceRefs:[sourceRef],sendMode:'AFTER_CURRENT',conflictState:'NONE'};
 const backup={app:'generative-harness-drafts',version:2,entries:[{key:'draft:task-thread',record:{value:'Preserve the imported source prompt',generation:'backup-text',updatedAt:1}},{key,record:{value:source,generation:'backup-source',updatedAt:1}}]};
 const file={name:'source-bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))};
 await page.route('**/api/workbench/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/workbench/threads/task-thread')return route.fulfill({json:{logicalOwner:owner,enabled:false,sources:[],sourceCapabilities:[]}});
  if(path.endsWith('/inputs'))return route.fulfill({json:{logicalOwner:owner,inputs:[]}});
  return route.fulfill({status:503,json:{error:{code:'FIXTURE_READ_UNAVAILABLE',message:'Retained host source reads are outside this storage fixture.'}}});
 });
 await page.route('**/api/shell/draft-references',route=>route.fulfill({json:{threads:[{id:'task-thread'}],skills:[],userStates:[],requests:[]}}));
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:15000});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Data & Recovery',exact:true}).click();
 const input=page.getByLabel('Draft backup file',{exact:true}),retained=await input.elementHandle();
 await input.setInputFiles(file);
 await expect.poll(()=>page.evaluate(()=>typeof(window as unknown as {__releaseSourceImport?:unknown}).__releaseSourceImport)).toBe('function');
 await expect(page.getByRole('button',{name:'Import browser drafts',exact:true})).toBeDisabled();
 // Observe the actual pre-key recovery barrier rather than depending on a sleep.
 const pending=await page.evaluate(async key=>{const path='/src/journal.ts',journal=await import(path);return journal.journalHandoffState([key,'draft:task-thread','agents-pending:task-thread']).map((value:{pending:boolean})=>value.pending);},key);
 expect(pending).toEqual([true,true,true]);
 await page.evaluate(()=>{
  const state=window as unknown as {__closeDesktop?:()=>Promise<boolean>;__sourceImportClose?:boolean};
  if(!state.__closeDesktop)throw Error('Native close fixture is unavailable.');
  void state.__closeDesktop().then(value=>{state.__sourceImportClose=value;});
 });
 expect(await page.evaluate(()=>(window as unknown as {__sourceImportClose?:boolean}).__sourceImportClose)).toBeUndefined();
 await page.evaluate(()=>{
  const state=window as unknown as {__releaseSourceImport?:()=>void;__failSourceImport?:boolean};
  if(!state.__releaseSourceImport)throw Error('The source file was not held before parsing.');
  state.__failSourceImport=true;state.__releaseSourceImport();
 });
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {__sourceImportClose?:boolean}).__sourceImportClose)).toBe(false);
 await expect(page.locator('.draft-transfer [role="alert"]')).toContainText('Scripted source import commit failed');
 await expect(page.getByRole('button',{name:'Import browser drafts',exact:true})).toBeEnabled();
 expect(await retained!.evaluate(element=>element.isConnected)).toBe(true);
 const failedRows=await page.evaluate(async key=>{const path='/src/journal.ts',journal=await import(path);return Promise.all([journal.journalReadRecord(key),journal.journalReadRecord('draft:task-thread')]);},key);
 expect(failedRows).toEqual([undefined,undefined]);
 expect(await page.evaluate(()=>(window as unknown as {__closeDesktop:()=>Promise<boolean>}).__closeDesktop())).toBe(false);
 // Only a new explicit import retries the failed source transaction.
 await page.evaluate(()=>{const state=window as unknown as {__holdSourceImport?:boolean;__failSourceImport?:boolean};state.__holdSourceImport=false;state.__failSourceImport=false;});
 await input.setInputFiles(file);
 await expect(page.locator('.draft-transfer [role="status"]')).toContainText('2 drafts imported');
 const restored=await page.evaluate(async owner=>{const path='/src/workbench-recovery.ts',recovery=await import(path);return recovery.composeDraftContext(owner);},owner);
 expect(restored).toMatchObject({draftId:source.draftId,logicalOwner:owner,sourceRefs:[sourceRef],sendMode:'AFTER_CURRENT',conflictState:'NONE',text:'Preserve the imported source prompt'});
 expect(await page.evaluate(()=>(window as unknown as {__closeDesktop:()=>Promise<boolean>}).__closeDesktop())).toBe(true);
 expect(host.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toEqual([]);
 expect(await page.evaluate(()=>(window as unknown as {__desktopCalls:unknown[][]}).__desktopCalls.filter(call=>call[0]==='detach'))).toEqual([]);
});
test('retained native thread header cancels a move on blur',async({page})=>{
 await bridge(page,{kind:'thread',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Detach chat',exact:true}).click();const handle=page.getByRole('button',{name:'Move chat panel',exact:true});await handle.hover();await page.mouse.down();
 try{const chat=page.getByRole('main',{name:'Chat',exact:true});await expect(chat).toHaveAttribute('data-tracking','true');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(chat).toHaveAttribute('data-tracking','false');}finally{await page.mouse.up();}
});
for(const resize of [{edge:'left',dx:-80,dy:0,cancel:false},{edge:'top',dx:0,dy:-80,cancel:true}])test(`retained native thread reflows during ${resize.edge} resize and ${resize.cancel?'rolls back':'persists'} the result`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await bridge(page,{kind:'thread',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/');
 const input=page.getByRole('textbox',{name:'Message',exact:true}),chat=page.getByRole('main',{name:'Chat',exact:true});await expect(input).toBeEnabled();await input.fill('Keep this draft and selection');await input.evaluate(element=>(element as HTMLTextAreaElement).setSelectionRange(5,9));
 await page.getByRole('button',{name:'Detach chat',exact:true}).click();const node=await input.elementHandle();
 const measure=()=>chat.evaluate(element=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(element).transform),text=element.querySelector('.message .markdown')!,walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT),range=document.createRange();const first=walker.nextNode()!;range.setStart(first,0);range.setEnd(first,Math.min(5,first.textContent!.length));const glyph=range.getBoundingClientRect();return {width:element.clientWidth,height:element.clientHeight,x:matrix.a,y:matrix.d,glyphWidth:glyph.width,glyphHeight:glyph.height};});
 const before=await measure(),saved=await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY),handle=page.getByRole('button',{name:`Resize chat ${resize.edge}`,exact:true}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 try{
  await page.mouse.move(box.x+box.width/2+resize.dx,box.y+box.height/2+resize.dy,{steps:6});await expect(chat).toHaveAttribute('data-tracking','true');
  await expect.poll(async()=>{const current=await measure();return resize.dx?current.width-before.width:current.height-before.height;}).toBeGreaterThan(40);
  const during=await measure();expect(during.x).toBeCloseTo(1,5);expect(during.y).toBeCloseTo(1,5);expect(during.glyphWidth).toBeCloseTo(before.glyphWidth,1);expect(during.glyphHeight).toBeCloseTo(before.glyphHeight,1);
  expect(await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY)).toBe(saved);
  if(resize.cancel)await page.keyboard.press('Escape');
 }finally{await page.mouse.up();}
 await expect(chat).toHaveAttribute('data-tracking','false');const after=await measure();
 if(resize.cancel){expect(after.width).toBe(before.width);expect(after.height).toBe(before.height);expect(await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY)).toBe(saved);}
 else{expect(after.width).toBeGreaterThan(before.width+40);expect(JSON.parse((await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY))!).popup.width).toBeGreaterThan(before.width+40);}
 expect(await node!.evaluate(element=>element===document.querySelector('textarea[aria-label="Message"]'))).toBe(true);await expect(input).toHaveCount(1);await expect(input).toHaveValue('Keep this draft and selection');expect(await input.evaluate(element=>[(element as HTMLTextAreaElement).selectionStart,(element as HTMLTextAreaElement).selectionEnd])).toEqual([5,9]);
});
test('retained native thread placement animation never scales readable content',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await bridge(page,{kind:'thread',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.evaluate(()=>{document.documentElement.dataset.motion='full';const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const animation=animate.call(this,frames,options);if(this.matches('.chat-view-surface'))animation.pause();return animation;};});
 await page.getByRole('button',{name:'Detach chat',exact:true}).click();const chat=page.getByRole('main',{name:'Chat',exact:true});
 const scales=await chat.evaluate(element=>{const animations=element.getAnimations();return animations.flatMap(animation=>{const duration=Number(animation.effect!.getTiming().duration),scales=[0,.5].map(progress=>{animation.currentTime=duration*progress;const matrix=new DOMMatrixReadOnly(getComputedStyle(element).transform);return [matrix.a,matrix.d];});animation.finish();return scales;});});
 expect(scales).toHaveLength(2);for(const [x,y]of scales){expect(x).toBeCloseTo(1,5);expect(y).toBeCloseTo(1,5);}
});
test('retained native thread has no retired switch-layout control',async({page})=>{
 await bridge(page,{kind:'thread',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Switch layout',exact:true})).toHaveCount(0);
});
test('retained native thread ignores the retired layout-cycle shortcut',async({page})=>{
 await bridge(page,{kind:'thread',threadId:'task-thread'});await serveTaskFixture(page,fixture());await page.goto('/');
 const input=page.getByRole('textbox',{name:'Message',exact:true}),chat=page.getByRole('main',{name:'Chat',exact:true});await expect(input).toBeEnabled();await input.focus();await expect(chat).toHaveAttribute('data-chat-mode','full');await page.keyboard.press('Control+Shift+L');await expect(chat).toHaveAttribute('data-chat-mode','full');
});
