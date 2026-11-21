import {createHash} from 'node:crypto';
import {test,expect,type Locator,type Page} from '@playwright/test';
import type {HostCommand,Snapshot} from '../../packages/contracts';
import type {ProjectContext} from '../../packages/contracts/workspace';
import {memoryPreparedRequestSchema,memorySourceDetailSchema,projectMemoryViewSchema,type MemoryItemV1,type MemoryPreparedRequest,type MemoryScope,type ProjectMemoryView} from '../../packages/contracts/project-memory';
import {taskFixture,serveTaskFixture,serveTaskSplitLayout} from './task-interface-fixture';
import {serveWorkbenchNativeReturnFixture} from './workbench-native-return-fixture';
import type {CapturedSourceV1,LogicalOwnerV1,SelectedSourceV1,SourceRefV1,WorkbenchInputV1} from '../../packages/contracts/source-selection';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Production App, API client, journal and composer. Only host HTTP is a labeled
 * deterministic fixture; host authorization is exercised in the separate host suite. */
async function fixture(page:Page,enabled=true,setup:{configure?:(snapshot:Snapshot)=>void;routes?:(snapshot:Snapshot)=>Promise<void>}={}){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'unused'}}}});
 snapshot.artifacts=[];snapshot.data=[];snapshot.userStates=[];snapshot.settings.preferences={showUsageFooter:true,showComposerContext:true};
 snapshot.messages[0].content='Visible exact source sentence for the workbench.';
 setup.configure?.(snapshot);
 const host=await serveTaskFixture(page,snapshot), captures=new Map<string,CapturedSourceV1>();
 await serveTaskSplitLayout(page, snapshot);
 let pause:Promise<void>|undefined;
 const recoveries:Record<string,unknown>[]=[];
 const state={enabled,denied:false,omitMessage:false,captureCount:0,inputs:[] as WorkbenchInputV1[],dropRecovery:false,dropAcceptedRecovery:false,descriptionPause:()=>pause,pauseDescriptions:(value?:Promise<void>)=>{pause=value;}};
 const owner=():LogicalOwnerV1=>({threadId:'task-thread',projectId:snapshot.threads[0].projectId??null,workspaceId:snapshot.threads[0].workspaceId??null});
 await page.route('**/api/workbench/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().method()==='POST'?route.request().postDataJSON():undefined;
  const reply=(value:unknown)=>route.fulfill({json:value});
  if(state.denied)return route.fulfill({status:503,json:{error:{code:'FIXTURE_OFFLINE',message:'Synthetic host disconnected. Draft retained.'}}});
  if(path.endsWith('/inputs'))return reply({logicalOwner:owner(),inputs:state.inputs});
  if(path.endsWith('/inputs/recover')){recoveries.push(body);if(state.dropRecovery){state.dropRecovery=false;return route.abort('failed');}if(body.action==='CANCEL')state.inputs=state.inputs.filter(input=>input.inputId!==body.inputId);else state.inputs=state.inputs.map(input=>input.inputId===body.inputId?{...input,state:'BLOCKED',reason:'Retained capture selected. Explicit run resume is required.'}:input);if(state.dropAcceptedRecovery){state.dropAcceptedRecovery=false;return route.abort('failed');}return reply({commandId:body.commandId,eventSeq:++snapshot.seq,result:{inputId:body.inputId,action:body.action,resumeRequired:body.action==='KEEP_CAPTURED'}});}
  if(path.endsWith('/evidence'))return reply({logicalOwner:owner(),items:[{id:'claim',kind:'CLAIM',label:'Fixture reported claim',grade:'REPORTED',freshness:'UNKNOWN',outcome:null,sourceRevision:null,command:null,logRefs:[],screenshotRefs:[]},{id:'check',kind:'CHECK',label:'Fixture recorded check',grade:'OBSERVED',freshness:'STALE',outcome:'FAIL',sourceRevision:'old-revision',command:['node','check.mjs'],logRefs:['retained-check.log'],screenshotRefs:[],parentId:'claim'}],modules:[{id:'M14',title:'Delegation',state:'UNSUPPORTED',reason:'No public contract in this fixture.',href:null,readOnly:true}]});
  if(path.endsWith('/task-thread'))return reply({logicalOwner:owner(),enabled:state.enabled,sources:state.enabled&&!state.omitMessage?[{locator:{kind:'MESSAGE',sourceId:'reply'},label:'Assistant message'}]:[],sourceCapabilities:[{kind:'MESSAGE',state:'AVAILABLE',reason:null},{kind:'FILE_RANGE',state:'UNSUPPORTED',reason:'No native file reader in this fixture.'},{kind:'DIFF_HUNK',state:'UNSUPPORTED',reason:'No native diff reader in this fixture.'},{kind:'ARTIFACT_REGION',state:'AVAILABLE',reason:null}]});
  if(path.endsWith('/context'))return reply({logicalOwner:owner(),state:'EMPTY',requestContext:null});
  if(path.endsWith('/output/read')){const messages=(body.messageIds as string[]).map(id=>snapshot.messages.find(message=>message.id===id)!);const revision=digest(JSON.stringify(messages.map(({id,content})=>({id,content}))));if(revision!==body.sourceRevision)return route.fulfill({status:409,json:{error:{code:'STALE_SOURCE',message:'The output changed.'}}});return reply({logicalOwner:owner(),sourceId:messages[0].id,sourceRevision:revision,rows:messages.flatMap(message=>message.content.split('\n').map((text,index)=>({id:`${message.id}:${index}`,text}))),complete:true});}
  if(path.endsWith('/describe')){const capturedOwner=owner(),text=snapshot.messages[0].content;if(pause)await pause;return reply({logicalOwner:capturedOwner,locator:body.locator,label:'Assistant message',text,sourceRevision:digest(text),contentDigest:digest(text)});}
  if(path.endsWith('/capture')){
   state.captureCount++;const source=body.source as SelectedSourceV1;
   const captured:CapturedSourceV1={ref:{captureId:`capture-${state.captureCount}`,source,keepCaptured:false},label:'Assistant message',preview:source.kind==='MESSAGE'?snapshot.messages[0].content.slice(source.range.start,source.range.end):'',previewTruncated:false,selectedBytes:source.kind==='MESSAGE'?source.range.end-source.range.start:0,retained:true,state:'CURRENT'};
   captures.set(captured.ref.captureId,captured);return reply(captured);
  }
  if(path.endsWith('/open')){const captured=captures.get((body.ref as SourceRefV1).captureId);if(!captured)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Fixture capture unavailable'}}});return reply({...captured,ref:body.ref,text:captured.preview,state:captured.ref.source.sourceRevision===digest(snapshot.messages[0].content)?'CURRENT':'STALE'});}
  if(path.endsWith('/refresh')){const old=captures.get(body.ref.captureId)!;state.captureCount++;const text=snapshot.messages[0].content;const ref={...old.ref,captureId:`capture-${state.captureCount}`,source:{...old.ref.source,sourceRevision:digest(text),contentDigest:digest(text)},keepCaptured:false};const next={...old,ref};captures.set(ref.captureId,next);return reply(next);}
  return route.fulfill({status:404});
 });
 await setup.routes?.(snapshot);
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:15000});
 return {...host,state,captures,owner,recoveries};
}
const editor=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
const delivery=(page:Page)=>page.getByRole('combobox',{name:'Source delivery mode',exact:true});
async function setDelivery(page:Page,mode:'NOW'|'AFTER_CURRENT'){
 await delivery(page).click();
 await page.getByRole('listbox',{name:'Source delivery mode',exact:true}).getByRole('option',{name:mode==='NOW'?'Now':'After current run',exact:true}).click();
}
async function select(page:Page){
 const text=page.locator('[data-message-id="reply"] .source-selection-text');await text.focus();
 await text.evaluate(element=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);const node=walker.nextNode()!;const range=document.createRange();range.setStart(node,0);range.setEnd(node,20);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await expect(page.getByRole('toolbar',{name:'Selected source'})).toBeVisible();
}
async function attach(page:Page){await select(page);await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toBeVisible();}
test('real keyboard selection reaches source actions in the app',async({page})=>{
 await fixture(page);const source=page.locator('[data-message-id="reply"] .source-selection-text'),toolbar=page.getByRole('toolbar',{name:'Selected source'});
 await source.focus();for(let i=0;i<7;i++)await page.keyboard.press('Shift+ArrowRight');
 await expect(toolbar).toBeVisible();await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toBe('Visible');
 await page.keyboard.press('Tab');await expect(toolbar.getByRole('button',{name:'Ask about this',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(toolbar).toHaveCount(0);await expect(source).toBeFocused();
 await page.keyboard.press('Control+a');await expect(toolbar).toBeVisible();await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toBe('Visible exact source sentence for the workbench.');
});
test('default-off App retains its ordinary composer and hides source actions',async({page})=>{
 const optionalRequests:string[]=[];
 page.on('request',request=>{if(/\/Workbench(?:PanelContent|Panels|InputsPanel|Output|Activity)\.tsx(?:\?|$)/.test(new URL(request.url()).pathname))optionalRequests.push(request.url());});
 const h=await fixture(page,false);await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toHaveCount(0);await editor(page).fill('Ordinary input');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(c=>c.type==='message.send').length).toBe(1);expect(h.commands.find(c=>c.type==='message.send')?.payload).not.toHaveProperty('sourceRefs');expect(optionalRequests).toEqual([]);
});
test('selection attaches bounded immutable context, survives reload and uses the existing durable send',async({page})=>{
 const h=await fixture(page);await editor(page).fill('Keep this prompt');await attach(page);expect(h.commands.filter(c=>c.type==='message.send')).toHaveLength(0);await expect(editor(page)).toHaveValue('Keep this prompt');await page.reload();await expect(editor(page)).toHaveValue('Keep this prompt');await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toBeVisible();await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(c=>c.type==='message.send').length).toBe(1);
 const command=h.commands.find(c=>c.type==='message.send')!;expect(command.payload.content).toBe('Keep this prompt');expect(command.payload.sourceRefs).toEqual([h.captures.get('capture-1')!.ref]);expect(command.payload.sendMode).toBe('NOW');await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toHaveCount(0);
});
test('ask supplies a question only for an empty draft and never dispatches',async({page})=>{
 const h=await fixture(page);await select(page);await page.getByRole('button',{name:'Ask about this',exact:true}).click();await expect(editor(page)).toHaveValue('Explain this selected source.');expect(h.commands.filter(c=>c.type==='message.send')).toHaveLength(0);
});
test('stale capture remains exact until explicit keep or refresh and opens retained output',async({page},info)=>{
 const h=await fixture(page);await attach(page);const captured=h.captures.get('capture-1')!;h.snapshot.messages[0].content+=' A later revision.';await h.publish();await page.reload();await expect(page.getByText('The source has changed.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Keep captured source',exact:true}).click();await expect(page.getByText('Using the retained capture.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Open source',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Sources and evidence'});await expect(dialog).toContainText('exact retained capture');await expect(dialog).toContainText(captured.ref.source.sourceRevision);await expect(dialog.locator('[data-output-row-id]').first()).toContainText(captured.preview);
 await page.screenshot({path:info.outputPath('retained-source.png'),fullPage:true});
});
test('late source descriptions cannot attach to a replacement workspace',async({page})=>{
 const h=await fixture(page);let release=()=>{};h.state.pauseDescriptions(new Promise<void>(resolve=>{release=resolve;}));await select(page);await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();h.snapshot.threads[0].workspaceId='replacement';await h.publish();await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toBeVisible();release();await expect.poll(()=>h.state.captureCount).toBe(0);await expect(page.getByRole('article',{name:/Selected source/})).toHaveCount(0);
});
test('after-current mode is explicit and queues through message.send while the task is working',async({page})=>{
 const h=await fixture(page);await attach(page);await editor(page).fill('Continue after the current run');
 h.snapshot.threads[0].runId='active-run';h.snapshot.threads[0].status='working';await h.publish();
 const hint=page.locator('.composer-hint');await expect(hint).toBeVisible();await expect(hint).toContainText('/btw');
 await expect(page.getByRole('button',{name:'Queue after current',exact:true})).toHaveCount(0);
 await setDelivery(page,'AFTER_CURRENT');await expect(hint).toHaveCount(0);
 await expect(editor(page)).toHaveValue('Continue after the current run');
 expect(h.commands.filter(c=>c.type==='message.send')).toHaveLength(0);
 await page.getByRole('button',{name:'Queue after current',exact:true}).click();
 await expect.poll(()=>h.commands.filter(c=>c.type==='message.send').length).toBe(1);
 const command=h.commands.find(c=>c.type==='message.send')!;
 expect(command.threadId).toBe('task-thread');expect(command.payload.content).toBe('Continue after the current run');
 expect(command.payload.sourceRefs).toEqual([h.captures.get('capture-1')!.ref]);expect(command.payload.sendMode).toBe('AFTER_CURRENT');
 expect(h.commands.filter(c=>c.type==='run.stop')).toHaveLength(0);expect(h.commands.filter(c=>c.type==='thread.create')).toHaveLength(0);
 await expect(editor(page)).toHaveValue('');await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toHaveCount(0);
 expect(h.commands.filter(c=>c.type==='message.send')).toHaveLength(1);
});
test('evidence preserves reported and observed grades, freshness and unsupported module state',async({page},info)=>{
 await fixture(page);await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Sources and evidence'});await dialog.getByRole('button',{name:'Evidence',exact:true}).click();await expect(dialog).toContainText('REPORTED');await expect(dialog).toContainText('OBSERVED');await expect(dialog).toContainText('STALE');await expect(dialog).toContainText('retained-check.log');await expect(dialog).toContainText('UNSUPPORTED');await expect(dialog).not.toContainText('VERIFIED');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();await page.getByRole('dialog',{name:'Sources and evidence'}).getByRole('button',{name:'Evidence',exact:true}).click();await page.screenshot({path:info.outputPath('evidence-drawer.png'),fullPage:true});
});
test('source candidates are a named group of source buttons',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sources and evidence'}),group=dialog.getByRole('group',{name:'Available sources'});
 await expect(group).toBeVisible();await expect(group.getByRole('button',{name:'MESSAGE: Assistant message',exact:true})).toBeVisible();
});
test('rollback leaves retained source inspection and removal reachable',async({page})=>{
 const h=await fixture(page);await attach(page);h.state.enabled=false;h.snapshot.threads[0].epoch++;await h.publish();await expect(page.getByText('New source actions are disabled.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Open source',exact:true}).click();await expect(page.getByRole('dialog',{name:'Sources and evidence'})).toBeVisible();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Remove source',exact:true}).click();await expect(page.getByRole('article',{name:/Selected source/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toHaveCount(0);
});

test('context and run views use recorded or explicit unavailable states without invented metrics',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Inspect context usage',exact:true}).click();await page.getByRole('dialog',{name:'Context inspector'}).getByRole('button',{name:'Last request',exact:true}).click();const panel=page.getByRole('dialog',{name:'Sources and evidence'});await expect(panel).toContainText('No prepared request has been recorded');await panel.getByRole('button',{name:'Run',exact:true}).click();await expect(panel.getByRole('region',{name:'Current run'})).toContainText('Not reported');await expect(panel).toContainText('No queue position reported');await expect(panel).toContainText('Unsupported:');
});
test('real activity integration bounds mounted rows and searches the authorized full read',async({page})=>{
 const h=await fixture(page);h.snapshot.messages.push({id:'activity',threadId:'task-thread',role:'activity',content:Array.from({length:1200},(_,index)=>`retained line ${index+1}`).join('\n'),createdAt:'2026-11-15T00:00:00.000Z',runId:null});await h.publish();await page.locator('details.activity summary').click();const output=page.getByRole('region',{name:'Retained work activity',exact:true});await expect(output.getByRole('button',{name:'Copy full result',exact:true})).toBeEnabled();expect(await output.locator('[data-output-row-id]').count()).toBeLessThanOrEqual(300);await output.getByRole('searchbox',{name:'Search full result',exact:true}).fill('retained line 1199');await output.getByRole('button',{name:'Search full result',exact:true}).click();await expect(output).toContainText('1 of 1 matching lines');await expect(output.locator('[data-output-row-id="activity:1198"]')).toBeVisible();
 await output.getByRole('searchbox',{name:'Search full result',exact:true}).fill('retained line 1200');await output.getByRole('button',{name:'Search full result',exact:true}).click();await expect(output.locator('[data-output-row-id="activity:1199"]')).toBeVisible();
 h.snapshot.threads.push({...h.snapshot.threads[0],id:'other',title:'Other task'});await h.publish();await page.getByRole('button',{name:'Other task',exact:false}).first().click();
 await expect(page.getByRole('tab',{name:'Other task',exact:true})).toHaveAttribute('aria-selected','true');
 const [returned]=await Promise.all([
  page.waitForResponse(response=>{const request=response.request();if(request.method()!=='POST'||new URL(response.url()).pathname!=='/api/split-workspace/commands')return false;const command=request.postDataJSON();return command.type==='split-workspace.view.open'&&command.payload.view?.id==='thread:task-thread';},{timeout:5000}),
  page.getByRole('button',{name:'Source-bound task fixture',exact:false}).first().click(),
 ]);
 expect(returned.status()).toBe(200);const receipt=await returned.json();expect(receipt.result.panes[receipt.result.focusedPaneId].activeViewId).toBe('thread:task-thread');
 await expect(page.getByRole('tab',{name:'Source-bound task fixture',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('[data-split-view="thread:task-thread"]')).toBeVisible();
 await page.reload();await expect(editor(page)).toBeEnabled();await page.locator('details.activity summary').click();await expect(page.locator('[data-output-row-id="activity:1199"]')).toBeVisible();
});
test('source-aware navigation waits for journal handoff and preserves text on reload',async({page})=>{
 const h=await fixture(page);h.snapshot.threads.push({...h.snapshot.threads[0],id:'other',title:'Other task'});await h.publish();await editor(page).fill('Retain this source-aware draft');await attach(page);await page.getByRole('button',{name:'Other task',exact:false}).first().click();await expect(editor(page)).toHaveValue('');await page.getByRole('button',{name:'Source-bound task fixture',exact:false}).first().click();await expect(editor(page)).toHaveValue('Retain this source-aware draft');await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toBeVisible();await page.reload();await expect(editor(page)).toBeEnabled({timeout:15000});await expect(editor(page)).toHaveValue('Retain this source-aware draft');
});

test('pointing mode does not consume another pane focus or Escape',async({page})=>{
 const h=await fixture(page);await select(page);await editor(page).focus();await expect(page.getByRole('toolbar',{name:'Selected source'})).toBeHidden();await page.keyboard.press('Escape');await expect(editor(page)).toBeFocused();expect(h.state.captureCount).toBe(0);expect(h.commands.filter(c=>c.type==='message.send')).toHaveLength(0);
});
test('selection inside the source dialog stays keyboard reachable and Escape dismisses only the toolbar',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Sources and evidence'});await dialog.getByRole('button',{name:'MESSAGE: Assistant message',exact:true}).click();const content=dialog.locator('.source-selection-text');await content.focus();await content.evaluate(element=>{const text=element.querySelector('pre')!.firstChild!,range=document.createRange();range.setStart(text,0);range.setEnd(text,12);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});const toolbar=dialog.getByRole('toolbar',{name:'Selected source'});await expect(toolbar).toBeVisible();await page.keyboard.press('Shift+F10');await expect(toolbar.getByRole('button',{name:'Ask about this',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(toolbar).toHaveCount(0);await expect(dialog).toBeVisible();
});

test('rollback retains a mode-only draft and permits returning to ordinary delivery',async({page})=>{
 const h=await fixture(page);await editor(page).fill('Ordinary after rollback');await setDelivery(page,'AFTER_CURRENT');h.state.enabled=false;h.snapshot.threads[0].epoch++;await h.publish();await expect(delivery(page)).toHaveText('After current run');await delivery(page).click();const options=page.getByRole('listbox',{name:'Source delivery mode',exact:true});await expect(options.getByRole('option',{name:'After current run',exact:true})).toHaveAttribute('aria-selected','true');await expect(options.getByRole('option',{name:'After current run',exact:true})).toBeDisabled();await options.getByRole('option',{name:'Now',exact:true}).click();await expect(delivery(page)).toHaveCount(0);await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(c=>c.type==='message.send').length).toBe(1);expect(h.commands.find(c=>c.type==='message.send')?.payload).not.toHaveProperty('sendMode');
});

test('accepted stale input exposes explicit keep and retains its recovery command across an uncertain acknowledgment',async({page})=>{
 const h=await fixture(page);await attach(page);await editor(page).fill('Accepted source input');await setDelivery(page,'AFTER_CURRENT');
 h.state.inputs=[{inputId:'accepted-input',state:'BLOCKED',sourceCount:1,canKeepCaptured:true,canCancel:true,reason:'The captured source changed before dispatch.',sourceRefs:[h.captures.get('capture-1')!.ref]}];
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('article',{name:/Selected source/})).toHaveCount(0);
 await page.getByRole('button',{name:'Inspect queued source inputs',exact:true}).click();const panel=page.getByRole('dialog',{name:'Sources and evidence'});await expect(panel).toContainText('captured source changed');
 h.state.dropRecovery=true;await panel.getByRole('button',{name:'Keep captured sources',exact:true}).click();await expect(panel.getByRole('alert')).toContainText(/fetch|network/i);await page.reload();
 await page.getByRole('button',{name:'Inspect queued source inputs',exact:true}).click();await page.getByRole('dialog',{name:'Sources and evidence'}).getByRole('button',{name:'Keep captured sources',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Sources and evidence'})).toContainText('Resume the run explicitly');expect(h.recoveries).toHaveLength(2);expect(h.recoveries[1]).toEqual(h.recoveries[0]);expect(h.commands.filter(command=>command.type==='run.resume')).toHaveLength(0);
});
test('rollback permits cancellation of an undispatched accepted input without exposing revoked sources',async({page})=>{
 const h=await fixture(page,false);h.state.inputs=[{inputId:'blocked-input',state:'BLOCKED',sourceCount:1,canKeepCaptured:false,canCancel:true,reason:'Retained sources cannot be authorized.'}];h.snapshot.threads[0].epoch++;await h.publish();
 await page.getByRole('button',{name:'Inspect queued source inputs',exact:true}).click();const panel=page.getByRole('dialog',{name:'Sources and evidence'});await expect(panel.getByRole('button',{name:'Keep captured sources',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:/Inspect retained source/})).toHaveCount(0);await panel.getByRole('button',{name:'Cancel undispatched input',exact:true}).click();await expect(panel).toContainText('Cancelled the undispatched input');expect(h.recoveries[0]).toMatchObject({inputId:'blocked-input',action:'CANCEL'});expect(h.commands.filter(command=>command.type==='run.resume')).toHaveLength(0);
});
test('definitive precommit source rejection unlocks removal and ordinary resubmission',async({page})=>{
 const h=await fixture(page);await attach(page);await editor(page).fill('Retain rejected text');let reject=true;
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(reject&&command.type==='message.send'){reject=false;return route.fulfill({status:409,json:{error:{code:'STALE_SOURCE',message:'Source changed before admission.',details:{sendAccepted:false}}}});}return route.fallback();});
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Remove source',exact:true})).toBeEnabled();await expect(editor(page)).toHaveValue('Retain rejected text');await page.getByRole('button',{name:'Remove source',exact:true}).click();await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);expect(h.commands.find(command=>command.type==='message.send')?.payload).not.toHaveProperty('sourceRefs');
});

test('lost cancellation receipt stays retryable after its input disappears and the App reloads',async({page})=>{
 const h=await fixture(page,false);h.state.inputs=[{inputId:'cancelled-input',state:'BLOCKED',sourceCount:1,canKeepCaptured:false,canCancel:true,reason:'Undispatched input.'}];h.snapshot.threads[0].epoch++;await h.publish();h.state.dropAcceptedRecovery=true;
 await page.getByRole('button',{name:'Inspect queued source inputs',exact:true}).click();await page.getByRole('button',{name:'Cancel undispatched input',exact:true}).click();await expect(page.getByRole('button',{name:'Retry CANCEL',exact:true})).toBeEnabled();await page.reload();await page.getByRole('button',{name:'Inspect queued source inputs',exact:true}).click();await page.getByRole('button',{name:'Retry CANCEL',exact:true}).click();await expect(page.getByRole('dialog',{name:'Sources and evidence'})).toContainText('Cancelled the undispatched input');expect(h.recoveries).toHaveLength(2);expect(h.recoveries[1]).toEqual(h.recoveries[0]);await expect(page.getByRole('button',{name:'Retry CANCEL',exact:true})).toHaveCount(0);
});

test('formatted assistant text opens its exact canonical source even outside the bounded catalogue',async({page})=>{
 const h=await fixture(page);const canonical='| Column |\n| --- |\n| left\\|right |\n\nPlain later left|right';h.snapshot.messages[0].content=canonical;h.state.omitMessage=true;h.snapshot.threads[0].epoch++;await h.publish();
 await page.getByRole('button',{name:'Select canonical source',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Sources and evidence'});await expect(dialog).toContainText('No supported sources are available');const content=dialog.locator('.source-selection-text');await expect(content).toHaveText(canonical);await content.focus();await content.evaluate((element,text)=>{const node=element.querySelector('pre')!.firstChild!,range=document.createRange(),start=text.indexOf('left\\|right');range.setStart(node,start);range.setEnd(node,start+'left\\|right'.length);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));},canonical);await dialog.getByRole('toolbar',{name:'Selected source'}).getByRole('button',{name:'Attach to prompt',exact:true}).click();await expect(page.getByRole('article',{name:'Selected source Assistant message'})).toContainText('left\\|right');expect(h.captures.get('capture-1')?.ref.source.range).toMatchObject({encoding:'UTF16',start:canonical.indexOf('left\\|right'),end:canonical.indexOf('left\\|right')+'left\\|right'.length});expect(h.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
});


test('deferred source view failure retains the mounted composer and restores focus',async({page})=>{
 const h=await fixture(page);await editor(page).fill('Retain this prompt when source views cannot load');
 const original=await editor(page).elementHandle();expect(original).not.toBeNull();
 await page.route('**/WorkbenchPanelContent.tsx*',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Sources and evidence'});
 await expect(panel.getByRole('alert')).toContainText('The source views could not be loaded.');
 await expect(panel.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toBeFocused();
 expect(await original!.evaluate(element=>element.isConnected)).toBe(true);
 await expect(editor(page)).toHaveValue('Retain this prompt when source views cannot load');
 expect(h.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
 await page.reload();await expect(editor(page)).toHaveValue('Retain this prompt when source views cannot load');
});

test('actual source modal and shared controls remain within the viewport at 200 percent zoom',async({page},info)=>{
 await page.setViewportSize({width:1280,height:800});await page.emulateMedia({reducedMotion:'reduce'});
 const h=await fixture(page);await editor(page).fill('Retain the authored draft at 200 percent zoom');
 await page.evaluate(()=>{document.body.style.zoom='2';});
 await setDelivery(page,'AFTER_CURRENT');await expect(delivery(page)).toHaveText('After current run');
 const withinViewport=async(locator:Locator)=>{
  await locator.scrollIntoViewIfNeeded();await expect(locator).toBeVisible();const bounds=await locator.boundingBox();expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(1280);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(800);
 };
 const opener=page.getByRole('button',{name:'Sources and evidence',exact:true});await opener.click();
 const panel=page.getByRole('dialog',{name:'Sources and evidence',exact:true}),close=panel.getByRole('button',{name:'Close dialog',exact:true});
 await withinViewport(panel);await withinViewport(close);
 const navigation=panel.getByRole('navigation',{name:'Workbench views',exact:true});
 const geometry=()=>panel.evaluate(element=>{const bounds=(target:Element)=>target.getBoundingClientRect().toJSON();const style=getComputedStyle(element);return {viewport:{width:innerWidth,height:innerHeight},zoom:getComputedStyle(document.body).zoom,panel:bounds(element),close:bounds(element.querySelector('[aria-label="Close dialog"]')!),navigation:bounds(element.querySelector('[aria-label="Workbench views"]')!),height:style.height,maxHeight:style.maxHeight,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop};});
 await withinViewport(navigation);const sourcesGeometry=await geometry();await navigation.getByRole('button',{name:'Evidence',exact:true}).click();await expect(panel).toContainText('Fixture reported claim');
 await info.attach('source-modal-zoom-geometry.json',{body:Buffer.from(JSON.stringify({sources:sourcesGeometry,evidence:await geometry()},null,2)),contentType:'application/json'});
 await withinViewport(panel);await withinViewport(close);await withinViewport(navigation);
 await navigation.getByRole('button',{name:'Sources',exact:true}).click();await withinViewport(panel.getByRole('button',{name:'MESSAGE: Assistant message',exact:true}));
 await close.click();await expect(panel).toHaveCount(0);await expect(opener).toBeFocused();await expect(editor(page)).toHaveValue('Retain the authored draft at 200 percent zoom');
 await opener.click();await panel.getByRole('button',{name:'MESSAGE: Assistant message',exact:true}).click();
 const attachSource=panel.getByRole('button',{name:'Attach to prompt',exact:true});await withinViewport(attachSource);await attachSource.click();
 await expect(panel).toHaveCount(0);await expect(opener).toBeFocused();await expect(editor(page)).toHaveValue('Retain the authored draft at 200 percent zoom');
 expect(h.state.captureCount).toBe(1);expect(h.captures.get('capture-1')?.ref.source).toMatchObject({kind:'MESSAGE',range:{encoding:'UTF16',start:0,end:h.snapshot.messages[0].content.length}});
 expect(h.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
});

test('native return waits for canonical placement and keeps delayed source work isolated between owners',async({page},info)=>{
 const h=await serveWorkbenchNativeReturnFixture(page);
 const view=(threadId:string)=>page.locator(`[data-split-view="thread:${threadId}"]`);
 const input=(threadId:string)=>view(threadId).getByRole('textbox',{name:'Message',exact:true});
 const selectSource=async(threadId:string,messageId:string)=>{
  const source=view(threadId).locator(`[data-message-id="${messageId}"] .source-selection-text`);await source.focus();
  await source.evaluate(element=>{const node=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode()!,range=document.createRange();range.setStart(node,0);range.setEnd(node,20);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await expect(page.getByRole('toolbar',{name:'Selected source',exact:true})).toBeVisible();
 };
 const readDrafts=()=>page.evaluate(async owners=>{const path='/src/workbench-recovery.ts',recovery=await import(/* @vite-ignore */ path);return Promise.all([recovery.composeDraftContext(owners.a),recovery.composeDraftContext(owners.b)]);},h.owners);
 const expectDrafts=async()=>{
  const drafts=await readDrafts();
  expect(drafts[0]).toMatchObject({logicalOwner:h.owners.a,text:'Authored draft owned by A',sourceRefs:[h.captures.get('native-capture-1')!.ref],sendMode:'NOW'});
  expect(drafts[1]).toMatchObject({logicalOwner:h.owners.b,text:'Different authored draft owned by B',sourceRefs:[h.captures.get('native-capture-2')!.ref],sendMode:'NOW'});
  expect(drafts[0].sourceRefs).toHaveLength(1);expect(drafts[1].sourceRefs).toHaveLength(1);return drafts;
 };
 try{
  await page.goto('/');await expect(input(h.owners.a.threadId)).toBeEnabled({timeout:15000});
  await input(h.owners.a.threadId).fill('Authored draft owned by A');await selectSource(h.owners.a.threadId,'reply');
  await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();
  await expect(view(h.owners.a.threadId).getByRole('article',{name:'Selected source Owner A message',exact:true})).toBeVisible();
  const delayed=h.holdNextDescription(h.owners.a.threadId);await selectSource(h.owners.a.threadId,'reply');
  await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();await delayed.arrived;
  await page.getByRole('button',{name:'Options for Native return A',exact:true}).click();
  await page.getByRole('menuitem',{name:'Detach thread',exact:true}).click();
  await expect.poll(h.nativeCalls).toContainEqual({type:'detach',surface:{kind:'thread',threadId:h.owners.a.threadId}});
  await expect.poll(()=>input(h.owners.a.threadId).evaluate(element=>Boolean(element.closest('[inert]')))).toBe(true);
  await page.getByRole('button',{name:/^Native return B, Ready/}).click();
  await expect(page.getByRole('tab',{name:'Native return B',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(input(h.owners.b.threadId)).toBeVisible();await input(h.owners.b.threadId).fill('Different authored draft owned by B');
  await selectSource(h.owners.b.threadId,'reply-b');await page.getByRole('button',{name:'Attach to prompt',exact:true}).click();
  await expect(view(h.owners.b.threadId).getByRole('article',{name:'Selected source Owner B message',exact:true})).toBeVisible();
  delayed.release();await delayed.completed;
  expect(h.captures.size).toBe(2);const beforeReturn=await expectDrafts();
  await expect(view(h.owners.b.threadId).getByRole('article',{name:'Selected source Owner A message',exact:true})).toHaveCount(0);
  const layout=h.holdLayoutReads(),commandsBeforeReturn=h.splitCommands.length;
  await page.reload({waitUntil:'domcontentloaded'});await layout.arrived;
  await h.returnThread(h.owners.a.threadId);
  expect(h.splitCommands).toHaveLength(commandsBeforeReturn);
  layout.release();
  await expect(page.getByRole('tab',{name:'Native return A',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(input(h.owners.a.threadId)).toHaveValue('Authored draft owned by A');
  await expect.poll(()=>input(h.owners.a.threadId).evaluate(element=>Boolean(element.closest('[inert]')))).toBe(false);
  await expect(view(h.owners.a.threadId).getByRole('article',{name:'Selected source Owner A message',exact:true})).toBeVisible();
  await expect(view(h.owners.a.threadId).getByRole('article',{name:'Selected source Owner B message',exact:true})).toHaveCount(0);
  expect(h.splitCommands.slice(commandsBeforeReturn)).toContainEqual(expect.objectContaining({type:'split-workspace.view.open',payload:expect.objectContaining({view:expect.objectContaining({kind:'thread',binding:expect.objectContaining({threadId:h.owners.a.threadId})})})}));
  const afterReturn=await expectDrafts();expect(h.captures.size).toBe(2);
  await page.getByRole('button',{name:/^Native return B, Ready/}).click();
  await expect(input(h.owners.b.threadId)).toHaveValue('Different authored draft owned by B');
  await expect(view(h.owners.b.threadId).getByRole('article',{name:'Selected source Owner B message',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(1);
  const finalDrafts=await expectDrafts();
  expect(h.commands.filter(command=>['message.send','thread.create','run.stop','run.resume'].includes(command.type))).toHaveLength(0);
  await info.attach('native-return-source-isolation.json',{body:Buffer.from(JSON.stringify({scope:'Real App with scripted browser desktop bridge and owner-bound source HTTP; no installed desktop execution',delayedDescriptionOutcome:delayed.outcome(),beforeReturn,afterReturn,finalDrafts,captures:[...h.captures.values()],events:h.events,commands:h.commands},null,2)),contentType:'application/json'});
 }finally{h.releaseAll();}
});

// Real App and existing M05 HTTP client. These typed host responses are fixture
// data; host admission, memory selection and source custody have separate tests.
async function memoryFixture(page:Page){
 const stamp='2026-11-16T00:00:00.000Z',projectId='memory-project',projectIdentity='a'.repeat(64);
 let snapshot!:Snapshot;
 const scope=():MemoryScope=>({projectId,projectIdentity,threadId:'task-thread',accountId:snapshot.threads[0].accountId??null,bindingDigest:'b'.repeat(64)});
 const sourceText=(id:string,revision:number)=>`<script>window.m15MemoryExecuted=true</script>\nPinned fixture source ${id} revision ${revision}.`;
 const item=(id:string,state:MemoryItemV1['state'],revision=1):MemoryItemV1=>({id,projectIdentity,scope:'PROJECT',kind:'CONSTRAINT',text:`Fixture ${id} memory revision ${revision}.`,revision,state,sourceRefs:[{ownerThreadId:'task-thread',sourceKind:'MESSAGE',sourceId:`memory-source-${id}`,sourceRevision:`memory-r${revision}`,capturedSeq:4,digest:digest(sourceText(id,revision)),observedStatus:'REPORTED'}],assertedBy:{kind:'AGENT',id:'fixture-agent'},observedAt:stamp,expiresAt:null,supersedes:[],sensitivity:'NORMAL',reviewDecision:null});
 const accepted=item('accepted','ACCEPTED'),proposal=item('proposal','PROPOSED'),conflict=item('conflict','CONFLICT',3),olderConflict=item('conflict','CONFLICT',2);
 const rows:ProjectMemoryView['items']=[{item:accepted,lastUsedAt:stamp,conflictRevisions:[]},{item:proposal,lastUsedAt:null,conflictRevisions:[]},{item:conflict,lastUsedAt:null,conflictRevisions:[olderConflict,conflict]}];
 const memory={moduleState:'AVAILABLE' as 'AVAILABLE'|'DISABLED'|'EMPTY',available:true,enabled:true,empty:false,nextView:undefined as ProjectMemoryView|undefined,actions:[] as unknown[],reads:[] as string[],sources:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],preparations:[] as {body:Record<string,unknown>;request:MemoryPreparedRequest}[]};
 const view=():ProjectMemoryView=>projectMemoryViewSchema.parse({scope:scope(),projectName:'Fixture memory project',available:memory.available,disabledReason:memory.available?null:'Project memory is disabled by the fixture host.',enabled:memory.enabled,configRevision:1,sourceThreadIds:memory.enabled?['task-thread']:[],eligibleThreads:[{id:'task-thread',title:'Owning source conversation'}],items:memory.empty?[]:rows,tombstones:[]});
 const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(accept=>{resolve=accept;});return {promise,resolve};};
 type Hold={arrived:ReturnType<typeof deferred>;released:ReturnType<typeof deferred>;completed:ReturnType<typeof deferred>};
 let sourceHold:Hold|undefined,preparationHold:Hold|undefined;
 const held=new Set<()=>void>();
 const hold=(kind:'source'|'preparation')=>{
  if(kind==='source'?sourceHold:preparationHold)throw Error('That memory request is already held.');
  const value={arrived:deferred(),released:deferred(),completed:deferred()};held.add(value.released.resolve);
  if(kind==='source')sourceHold=value;else preparationHold=value;
  return {arrived:value.arrived.promise,completed:value.completed.promise,release:value.released.resolve};
 };
 const h=await fixture(page,true,{
  configure(value){snapshot=value;Object.assign(value.threads[0],{projectId,projectName:'Fixture memory project',workspaceId:'memory-working-copy',accountId:'memory-account-a'});},
  async routes(){
   await page.route('**/api/workbench/threads/task-thread/evidence',route=>route.fulfill({json:{logicalOwner:{threadId:'task-thread',projectId,workspaceId:'memory-working-copy'},items:[],modules:[{id:'M05',title:'Memory review',state:memory.moduleState,reason:memory.moduleState==='DISABLED'?'The module is disabled; retained reads remain available.':memory.moduleState==='EMPTY'?'No memory is recorded.':null,href:`/api/projects/${projectId}/memory?threadId=task-thread`,readOnly:true}]}}));
   await page.route(`**/api/projects/${projectId}/**`,async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/context')){
     const context:ProjectContext={project:{id:projectId,name:'Fixture memory project',rootPath:'/synthetic/memory-project',authority:{kind:'local'},createdAt:stamp},workingCopy:{id:'memory-working-copy',path:'/synthetic/memory-project-copy'},threadId:'task-thread',machineName:'Fixture',editor:{available:false,label:'Editor'},branch:null,head:null,changes:{added:null,removed:null,files:null},lineage:[],scripts:[],capabilities:{git:false,terminal:false,pullRequests:false}};
     return route.fulfill({json:context});
    }
    if(!url.pathname.includes('/memory'))return route.fulfill({status:404});
    memory.reads.push(url.pathname+url.search);
    if(url.pathname.endsWith('/memory')){const value=memory.nextView??view();memory.nextView=undefined;return route.fulfill({json:value});}
    if(url.pathname.endsWith('/source')){
     const requestedId=url.searchParams.get('itemId'),revision=Number(url.searchParams.get('revision'));
     const requested=[accepted,proposal,conflict,olderConflict].find(value=>value.id===requestedId&&value.revision===revision);
     if(!requested)return route.fulfill({status:404});
     const ref=JSON.parse(url.searchParams.get('sourceRef')??'null') as unknown;
     expect(url.searchParams.get('threadId')).toBe('task-thread');expect(ref).toEqual(requested.sourceRefs[0]);expect(url.searchParams.get('sourceDigest')).toBe(requested.sourceRefs[0].digest);
     memory.sources.push({threadId:'task-thread',itemId:requested.id,revision,sourceDigest:url.searchParams.get('sourceDigest'),sourceRef:ref});
     const response=memorySourceDetailSchema.parse({scope:scope(),ref,content:sourceText(requested.id,requested.revision),label:'Exact pinned fixture memory source'});
     const waiting=sourceHold;if(waiting){sourceHold=undefined;waiting.arrived.resolve();await waiting.released.promise;}
     try{await route.fulfill({json:response});}
     catch(cause){if(!waiting||!route.request().failure())throw cause;}
     finally{if(waiting){memory.events.push({kind:'source-response-settled',scope:response.scope,requestFailure:route.request().failure()});waiting.completed.resolve();}}
     return;
    }
    if(url.pathname.endsWith('/requests/prepare')){
     expect(route.request().headers()['x-harness-csrf']).toBe('fixture-csrf');const body=route.request().postDataJSON() as Record<string,unknown>;
     const requestId=`prepared-source-queue-${memory.preparations.length+1}`,contextGeneration=memory.preparations.length+1;
     const request=memoryPreparedRequestSchema.parse({scope:scope(),requestId,contextGeneration,phase:'PREPARING',items:[accepted],injectedBytes:240,expiresAt:new Date(Date.now()+60000).toISOString(),recall:{requestId,contextGeneration,projectIdentity,queryDigest:digest(String(body.prompt)),candidateIds:[accepted.id],selectedRevisions:[{itemId:accepted.id,revision:accepted.revision}],scores:[],exclusions:[],budgetBytes:4096,producedAt:stamp,status:'COMPLETE'}});
     memory.preparations.push({body,request});const waiting=preparationHold;
     if(waiting){preparationHold=undefined;waiting.arrived.resolve();await waiting.released.promise;}
     try{return await route.fulfill({json:request});}finally{waiting?.completed.resolve();}
    }
    if(url.pathname.endsWith('/requests/latest'))return route.fulfill({json:null});
    if(route.request().method()!=='GET'){memory.actions.push({path:url.pathname,body:route.request().postDataJSON()});return route.fulfill({status:403,json:{error:{code:'FIXTURE_READ_ONLY',message:'This read-only fixture does not accept memory changes.'}}});}
    return route.fulfill({status:404});
   });
  },
 });
 await expect(page.getByRole('button',{name:'Saved drafts',exact:true})).toBeEnabled();
 return {...h,memory,scope,view,accepted,proposal,conflict,olderConflict,sourceText,holdSource:()=>hold('source'),holdPreparation:()=>hold('preparation'),releaseAll:()=>{for(const release of held)release();}};
}
const memoryPanel=(page:Page)=>page.getByRole('dialog',{name:'Project memory',exact:true});
async function openMemory(page:Page){
 await page.getByRole('button',{name:'Sources and evidence',exact:true}).click();
 const workbench=page.getByRole('dialog',{name:'Sources and evidence',exact:true});
 await workbench.getByRole('navigation',{name:'Workbench views',exact:true}).getByRole('button',{name:'Evidence',exact:true}).click();
 const launch=workbench.getByRole('button',{name:'Open memory review',exact:true});await expect(launch).toBeEnabled();await launch.click();
 await expect(memoryPanel(page)).toBeVisible();return {workbench,launch};
}
const readDraftContext=(page:Page,owner:LogicalOwnerV1)=>page.evaluate(async logicalOwner=>{const path='/src/workbench-recovery.ts',recovery=await import(/* @vite-ignore */ path);return recovery.composeDraftContext(logicalOwner);},owner);

test('prepared memory and selected sources queue together while working and clear only after acknowledgment',async({page},info)=>{
 const h=await memoryFixture(page),preparation=h.holdPreparation();let releaseSend=()=>{};
 const acknowledgment=new Promise<void>(resolve=>{releaseSend=resolve;}),attempts:HostCommand[]=[];
 try{
  await attach(page);await editor(page).fill('Use this source after the current run');await setDelivery(page,'AFTER_CURRENT');
  await page.getByRole('button',{name:'Inspect context usage',exact:true}).click();await preparation.arrived;
  const inspector=page.getByRole('dialog',{name:'Context inspector',exact:true});await expect(inspector).toContainText('Preparing project memory');
  h.snapshot.threads[0].runId='memory-active-run';h.snapshot.threads[0].status='working';await h.publish();
  const queue=page.getByRole('button',{name:'Queue after current',exact:true});await expect(queue).toBeVisible();await expect(queue).toBeDisabled();
  preparation.release();await preparation.completed;
  await expect(inspector).toContainText('Prepared for the current draft.');await expect(inspector).toContainText(h.accepted.text);await expect(inspector.getByRole('navigation',{name:'Context views',exact:true}).getByRole('button',{name:'Sources',exact:true})).toBeEnabled();
  await expect(queue).toBeEnabled();await page.keyboard.press('Escape');
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type==='message.send'){attempts.push(command);await acknowledgment;}return route.fallback();});
  expect(h.commands).toHaveLength(0);await queue.click();await expect.poll(()=>attempts.length).toBe(1);
  const sent=attempts[0];expect(sent.threadId).toBe('task-thread');expect(sent.payload).toMatchObject({content:'Use this source after the current run',modelId:'test/model',requestContextId:h.memory.preparations[0].request.requestId,sourceRefs:[h.captures.get('capture-1')!.ref],sendMode:'AFTER_CURRENT'});
  expect(h.memory.preparations).toHaveLength(1);expect(h.memory.preparations[0].body).toEqual({threadId:'task-thread',prompt:'Use this source after the current run',modelId:'test/model',thinkingLevel:null});
  await expect(editor(page)).toHaveValue('Use this source after the current run');await expect(page.getByRole('article',{name:'Selected source Assistant message',exact:true})).toBeVisible();expect(h.commands).toHaveLength(0);
  releaseSend();await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);
  await expect(editor(page)).toHaveValue('');await expect(page.getByRole('article',{name:'Selected source Assistant message',exact:true})).toHaveCount(0);
  expect(attempts).toHaveLength(1);expect(h.commands).toEqual([sent]);expect(h.memory.actions).toEqual([]);
  await expect(page.getByRole('button',{name:'Stop agent',exact:true})).toBeVisible();
  await info.attach('memory-source-queued-command.json',{body:Buffer.from(JSON.stringify({scope:'Real App and typed deterministic source/memory HTTP; host admission is separate',preparation:h.memory.preparations[0],captured:h.captures.get('capture-1'),command:sent},null,2)),contentType:'application/json'});
 }finally{releaseSend();h.releaseAll();}
});

test('M15 memory review keeps pinned source reads available and all mutations disabled without changing the draft',async({page},info)=>{
 const h=await memoryFixture(page);await attach(page);await editor(page).fill('Retain authored text while reviewing memory');const before=await readDraftContext(page,h.owner());
 const {workbench,launch}=await openMemory(page),panel=memoryPanel(page);
 await expect(panel).toContainText(h.accepted.text);
 await panel.getByText('Source conversations (1)',{exact:true}).click();
 await expect(panel.getByRole('checkbox',{name:'Owning source conversation',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Save source scope',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Disable for this project',exact:true})).toBeDisabled();
 for(const name of ['Edit accepted','Expire accepted','Forget accepted'])await expect(panel.getByRole('button',{name,exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'View source accepted 1',exact:true}).click();
 await expect(panel.getByRole('region',{name:'Supporting source',exact:true})).toContainText(h.sourceText('accepted',1));
 expect(h.memory.sources[0]).toEqual({threadId:'task-thread',itemId:'accepted',revision:1,sourceDigest:h.accepted.sourceRefs[0].digest,sourceRef:h.accepted.sourceRefs[0]});
 expect(await page.evaluate(()=>(window as unknown as {m15MemoryExecuted?:boolean}).m15MemoryExecuted)).toBeUndefined();
 await panel.getByRole('tab',{name:'Proposals',exact:true}).click();await expect(panel).toContainText(h.proposal.text);
 for(const name of ['Accept proposal','Edit proposal','Reject proposal','Forget proposal'])await expect(panel.getByRole('button',{name,exact:true})).toBeDisabled();
 await expect(panel.getByRole('button',{name:'View source proposal 1',exact:true})).toBeEnabled();
 await panel.getByRole('tab',{name:'Conflicts',exact:true}).click();await expect(panel).toContainText(h.conflict.text);await expect(panel).toContainText(h.olderConflict.text);
 for(const revision of [2,3])await expect(panel.getByRole('checkbox',{name:`Keep revision ${revision}`,exact:true})).toBeDisabled();
 await expect(panel.getByRole('textbox',{name:'Resolution note',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Resolve conflict',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Forget conflict',exact:true})).toBeDisabled();
 const oldSource=panel.getByRole('button',{name:'View source for revision 2',exact:true});await expect(oldSource).toBeEnabled();await oldSource.click();
 await expect(panel.getByRole('region',{name:'Supporting source',exact:true})).toContainText(h.sourceText('conflict',2));expect(h.memory.sources[1]).toMatchObject({itemId:'conflict',revision:2,sourceRef:h.olderConflict.sourceRefs[0]});
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(workbench).toBeVisible();await expect(launch).toBeFocused();
 await page.keyboard.press('Escape');await expect(workbench).toHaveCount(0);await expect(page.getByRole('button',{name:'Sources and evidence',exact:true})).toBeFocused();
 await expect(editor(page)).toHaveValue('Retain authored text while reviewing memory');expect(await readDraftContext(page,h.owner())).toEqual(before);expect(h.state.captureCount).toBe(1);expect(h.commands).toEqual([]);expect(h.memory.actions).toEqual([]);
 await info.attach('memory-read-only-review.json',{body:Buffer.from(JSON.stringify({scope:'Real App with typed fixture memory and source HTTP; no host authorization claim',before,after:await readDraftContext(page,h.owner()),sourceRequests:h.memory.sources,memoryActions:h.memory.actions,ordinaryCommands:h.commands},null,2)),contentType:'application/json'});
});

test('M15 memory review opens retained disabled records and an empty current-owner module',async({page})=>{
 const h=await memoryFixture(page);await editor(page).fill('Retain this draft across module states');
 for(const state of ['DISABLED','EMPTY'] as const){
  h.memory.moduleState=state;h.memory.available=state!=='DISABLED';h.memory.enabled=state!=='DISABLED';h.memory.empty=state==='EMPTY';
  const {workbench,launch}=await openMemory(page),panel=memoryPanel(page);await expect(panel).toContainText('Fixture memory project');
  if(state==='DISABLED'){
   await expect(panel).toContainText(h.accepted.text);await expect(panel.getByRole('button',{name:'Enable for this project',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'View source accepted 1',exact:true})).toBeEnabled();
  }else await expect(panel).toContainText('No accepted memories.');
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(launch).toBeFocused();await page.keyboard.press('Escape');await expect(workbench).toHaveCount(0);
 }
 await expect(editor(page)).toHaveValue('Retain this draft across module states');expect(h.commands).toEqual([]);expect(h.memory.actions).toEqual([]);
});

test('M15 memory review cancels old-account source reads and refuses an old-account envelope in the new owner',async({page},info)=>{
 const h=await memoryFixture(page);await attach(page);await editor(page).fill('Account transition retains my source and draft');const before=await readDraftContext(page,h.owner()),oldView=structuredClone(h.view());
 const held=h.holdSource();
 try{
  await openMemory(page);await memoryPanel(page).getByRole('button',{name:'View source accepted 1',exact:true}).click();await held.arrived;
  h.snapshot.threads[0].accountId='memory-account-b';await h.publish();
  await expect(memoryPanel(page)).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Sources and evidence',exact:true})).toHaveCount(0);await expect(editor(page)).toHaveValue('Account transition retains my source and draft');
  held.release();await held.completed;await expect(page.getByText(h.sourceText('accepted',1),{exact:true})).toHaveCount(0);
  h.memory.nextView=oldView;const {workbench,launch}=await openMemory(page),panel=memoryPanel(page);
  await expect(panel.getByRole('alert')).toContainText('Project memory changed owner, source or revision');await expect(panel.getByRole('article',{name:'Memory accepted',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(launch).toBeFocused();await page.keyboard.press('Escape');await expect(workbench).toHaveCount(0);
  expect(await readDraftContext(page,h.owner())).toEqual(before);expect(h.commands).toEqual([]);expect(h.memory.actions).toEqual([]);
  await info.attach('memory-owner-transition.json',{body:Buffer.from(JSON.stringify({scope:'Actual M05 client owner validation in real App with typed fixture HTTP; old in-flight cancellation is distinct from wrong-owner response rejection',oldOwner:oldView.scope,currentOwner:h.scope(),events:h.memory.events,before,after:await readDraftContext(page,h.owner()),sourceRequests:h.memory.sources,memoryActions:h.memory.actions,ordinaryCommands:h.commands},null,2)),contentType:'application/json'});
 }finally{h.releaseAll();}
});
