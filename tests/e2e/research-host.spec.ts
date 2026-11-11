import {test, expect, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import type {PanelPlacement} from '../../packages/contracts/workspace';
import {scopedContext} from '../scoped-conversation-fixture';
import type {AgentSummary} from '../../packages/contracts/agent-inventory';
import type {ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import {serveTaskFixture, taskFixture} from './task-interface-fixture';

async function fixture(page: Page, {native = false, delayed = false, unavailable = false, invalidOwner = false, working = true, pinned = false, archiveConfirmation = true, unbound = false, wrongProject = false, reasoning = false, legacyTools = false} = {}) {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Synthetic host fixture'}}}});
  snapshot.threads[0] = {...snapshot.threads[0], id: 'parent-a', title: 'Project investigation', projectId: 'project-a', projectName: 'Alpha', status: working ? 'working' : 'ready', runId: working ? 'run-a' : null};
  snapshot.activeThreadId = 'parent-a'; snapshot.artifacts = []; snapshot.userStates = []; snapshot.data = []; snapshot.messages = [];
  snapshot.settings = {theme: 'dark', modelId: 'test/model', preferences: {showUsageFooter: false, archiveConfirmation, unpinConfirmation: true}};
  if (pinned) snapshot.threads[0].presentation = {pinned: true};
  const emptyDraft = {...snapshot.threads[0], id: 'empty-draft', title: 'Empty draft stays in navigation', status: 'ready' as const, runId: null};
  snapshot.threads.push(emptyDraft);
  const {commands} = await serveTaskFixture(page, snapshot);
  await page.addInitScript(({native}) => {
    localStorage.setItem('harness:selected-thread', 'empty-draft');
    localStorage.setItem('harness:shell-layout:v1', JSON.stringify({sidebarCollapsed: false}));
    const calls = {subscriptions: 0, ready: 0};
    const callbacks = new Set<(change: {connected: boolean; sequence: number}) => void>();
    const attention = new Set<(id: string) => void>();
    Object.assign(window, {hostFixtureCalls: calls, publishNativeProgress: () => callbacks.forEach(callback => callback({connected: true, sequence: 11})), publishAttention: (id: string) => attention.forEach(callback => callback(id))});
    if (native) {
      const context = {windowId: 'main', surface: {kind: 'main'}, windows: [], nativeTitleBar: true};
      Object.assign(window, {harnessDesktop: {
        getContext: async () => context, ready: async () => {calls.ready++; return context;}, setTheme: async () => {},
        onState: (notify: (state: unknown) => void) => {Object.assign(window,{publishResearchOwner:(away:boolean,threadId='parent-a')=>notify({windows:away?[{id:'other',surface:{kind:'thread',threadId},title:'Owning conversation'}]:[]})});return()=>{};}, onCloseRequested: () => () => {}, list: async () => [], browser: async () => {},
        onAttentionOpen: (callback: (id: string) => void) => {attention.add(callback); return () => attention.delete(callback);},
        onWorkspaceChanged: (callback: (change: {connected: boolean; sequence: number}) => void) => {calls.subscriptions++; callbacks.add(callback); return () => callbacks.delete(callback);},
      }});
    }
  }, {native});
  const requests: string[] = [];
  page.on('request', request => {const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(url.pathname + url.search);});
  const rows: ThreadNavigationRow[] = snapshot.threads.map(({id, title, projectId, projectName, createdAt, updatedAt, status, runId, presentation}) => ({id, title, projectId, projectName, createdAt, updatedAt, status, runId, presentation}));
  let failed = unavailable, release!: () => void;
  const gate = delayed ? new Promise<void>(resolve => {release = resolve;}) : Promise.resolve();
  const projects = [{id: 'project-a', name: 'Alpha', authority: {kind: 'local'}, rootPath: 'C:/synthetic/alpha'}];
  const binding = {authority: {kind: 'local' as const}, threadId: 'parent-a', projectId: wrongProject ? 'another-project' : 'project-a'};
  const panel: PanelPlacement = {id:'research-owner',canvasId:'research',kind:'thread',binding,placement:'canvas',visible:true,collapsed:false,bounds:{x:0,y:0,width:600,height:500},order:0,alwaysOnTop:false};
  const canvases = ['workspace', 'all-agents', 'code-review', 'research', 'custom'].map(preset => ({id: preset, name: preset, preset, panels: preset === 'research' && !unbound ? [panel,...(legacyTools?[{...panel,id:'old-files',kind:'files' as const},{...panel,id:'old-notes',kind:'notes' as const}]:[])] : [], viewport: {x: 0, y: 0, zoom: 1}}));
  const envelope = {projects, state: {version: 1, revision: 1, activeCanvasId: invalidOwner ? 'missing' : 'research', canvases, profiles: [], disabledKinds: [], integrations: {}}};
  await page.route('**/api/workspace', async route => {await gate; return failed ? route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Workspace unavailable'}}}) : route.fulfill({json: envelope});});
  await page.route('**/api/workspace/commands', route => {
    const input = route.request().postDataJSON();
    if (input.type === 'workspace.canvas.select') envelope.state.activeCanvasId = input.payload.canvasId;
    if(input.type==='workspace.panel.update'){for(const canvas of envelope.state.canvases){const target=canvas.panels.find(panel=>panel.id===input.payload.panelId);if(target)Object.assign(target,input.payload.patch);}}
    if(input.type==='workspace.panel.add'){const canvas=envelope.state.canvases.find(canvas=>canvas.id===input.payload.canvasId);if(canvas)canvas.panels.push({...panel,...input.payload.panel,canvasId:canvas.id});}
    envelope.state.revision++; return route.fulfill({json: {commandId: input.id, seq: 1, result: envelope}});
  });
  await page.route('**/api/shell-settings', route => route.fulfill({json: snapshot.settings}));
  await page.route('**/api/shell/settings', route => route.fulfill({json: {sequence: 1, settings: snapshot.settings, accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [{id: 'project-a', name: 'Alpha'}], resources: [], resourcePage: {total: 0, nextCursor: null}, counts: {threads: 2, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0}}}));
  await page.route('**/api/shell/archive?*', route => route.fulfill({json: {sequence: 1, total: 0, items: [], nextCursor: null}}));
  await page.route('**/api/shell/navigation?*', route => {const archived = new URL(route.request().url()).searchParams.get('archived') === 'true'; return route.fulfill({json: {sequence: 1, total: archived ? 0 : rows.length, items: archived ? [] : rows, nextCursor: null, order: 'created-desc', stats: {pinned: 0, working: 1, waiting: 0, settled: 0, minOrder: 0, maxOrder: 0}}});});
  await page.route('**/api/shell/navigation/*', route => route.fulfill({json: rows.find(row => row.id === new URL(route.request().url()).pathname.split('/').at(-1))}));
  await page.route('**/api/plugins', route => route.fulfill({json: {plugins: []}}));
  const agent: AgentSummary = {agentId: 'thread:parent-a', parentId: null, rootId: 'thread:parent-a', jobId: null, threadId: 'parent-a', projectId: 'project-a', projectName: 'Alpha', title: 'Project investigation', status: working ? 'working' : 'ready', modelId: 'test/model', currentAction: 'Reviewing sources', reportedPercent: null, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: 'a', revision: 1, archived: false, readOnly: false, metadata: 'thread'};
  await page.route(url => url.pathname.startsWith('/api/agents'), route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/agents') return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', sequence: 10, items: [agent], ancestors: [], nextCursor: null}});
    if (url.pathname.endsWith('/updates')) return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', fromSequence: Number(url.searchParams.get('after')), sequence: 10, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []}});
    if (url.pathname.endsWith('/events')) return route.fulfill({contentType: 'text/event-stream', body: ': connected\n\n'});
    if (url.pathname.endsWith('/history')) return route.fulfill({json: {authority: 'personal', agentId: agent.agentId, threadId: agent.threadId, sequence: 10, nextCursor: null, messages: [{id: 'reply-a', threadId: agent.threadId, role: 'assistant', createdAt: '2026-11-06', runId: 'run-a', content: 'Bound live transcript', contentOffset: 0, contentLength: 21, nextContentCursor: null}]}});
    return route.fulfill({status: 404});
  });
  const context = {...scopedContext,owner:{...scopedContext.owner,threadId:'parent-a',title:'Project investigation',projectId:'project-a',projectName:'Alpha',modelId:'test/model'},sequence:10};
  await page.route('**/api/conversations/**',route=>{
    const url=new URL(route.request().url()),id=url.pathname.split('/')[3],selected=id==='parent-a'?context:{...context,scopeKey:'e'.repeat(64),owner:{...context.owner,threadId:id,title:rows.find(row=>row.id===id)?.title??id}},owner={authority:'personal',threadId:id,scopeKey:selected.scopeKey,sequence:selected.sequence};
    if(url.pathname.endsWith('/updates'))return route.fulfill({json:{...owner,fromSequence:context.sequence,owner:null,transcriptChanged:false,checkpoint:context.checkpoint}});
    if(url.pathname.endsWith('/transcript'))return route.fulfill({json:{...owner,messages:[],nextCursor:null}});
    return route.fulfill({json:selected});
  });
  const source={authority:{kind:'personal'},threadId:'parent-a',projectId:'project-a',id:'evidence',revision:1,title:'Reference notes',identity:{kind:'text'},status:'captured',capturedAt:'2026-11-06T00:00:00Z',sha256:'c'.repeat(64),bytes:21,materialId:'material-evidence'};
  await page.route('**/api/research?*',route=>route.fulfill({json:{items:new URL(route.request().url()).searchParams.get('kind')==='sources'?[source]:[],nextCursor:null}}));
  await page.route('**/api/shell/resources?*',route=>route.fulfill({json:{sequence:10,total:0,items:[],nextCursor:null}}));
  if(reasoning)await page.route('**/api/models?*',route=>route.fulfill({json:{models:[{id:'test/model',provider:'test',name:'Reasoning model',thinkingLevels:['high']},{id:'test/other',provider:'test',name:'Other model',thinkingLevels:['low']}]}}));
  const module = '/@fs/' + encodeURI(fileURLToPath(new URL('./workspace-app-fixture.tsx', import.meta.url)).replaceAll('\\', '/'));
  await page.route('**/workspace-host-check', route => route.fulfill({contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
  await page.goto('/workspace-host-check');
  return {requests, commands, snapshot, release: () => release?.(), recover: () => {failed = false; envelope.state.activeCanvasId = 'all-agents';}};
}

test('cold Research is a dedicated bound source workspace without conversation snapshot reads',async({page})=>{
 const h=await fixture(page,{working:false});
 await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Research sources and documents'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Reference notes/})).toBeVisible();
 expect(h.requests.filter(path=>path==='/api/snapshot'||path.startsWith('/api/events'))).toEqual([]);
 expect(h.requests.some(path=>path.startsWith('/api/conversations/parent-a?'))).toBe(true);
 expect(h.requests.some(path=>path.includes('/api/conversations/empty-draft'))).toBe(false);
});

test('unbound Research asks for an explicit owner without creating or choosing a conversation',async({page})=>{
 const h=await fixture(page,{working:false,unbound:true});
 await expect(page.getByRole('combobox',{name:'Research conversation'})).toBeVisible();
 expect(h.commands.filter(command=>command.type==='thread.create')).toEqual([]);
 expect(h.requests.filter(path=>path==='/api/snapshot'||path.startsWith('/api/conversations/')||path.startsWith('/api/research'))).toEqual([]);
});

test('a bound Research project mismatch holds sources and requests a new explicit owner',async({page})=>{
 const h=await fixture(page,{working:false,wrongProject:true});
 await expect(page.getByRole('alert').filter({hasText:'The saved project no longer matches this conversation.'})).toBeVisible();
 expect(h.requests.filter(path=>path.startsWith('/api/research'))).toEqual([]);
 expect(h.requests.filter(path=>path==='/api/snapshot')).toEqual([]);
});

test('optional Research chat keeps the actual shared draft and sends to the exact owner',async({page})=>{
 const h=await fixture(page,{working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show chat',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Message',exact:true});await expect(input).toBeEnabled();
 await input.fill('Retain scoped research draft');const retained=await input.elementHandle();await page.getByRole('button',{name:'Hide chat',exact:true}).click();
 await expect(input).toBeHidden();expect(await retained!.evaluate(node=>node.isConnected)).toBe(true);
 await page.getByRole('button',{name:'Show chat',exact:true}).click();await expect(input).toHaveValue('Retain scoped research draft');
 await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});expect(h.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);
 expect(h.commands.find(command=>command.type==='message.send')).toMatchObject({threadId:'parent-a',payload:{content:'Retain scoped research draft',modelId:'test/model'}});
 expect(h.requests.filter(path=>path==='/api/snapshot'||path.startsWith('/api/events'))).toEqual([]);
});

test('Research draft follows an explicit return to its ordinary conversation',async({page})=>{
 await fixture(page,{working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show chat',exact:true}).click();const input=page.getByRole('textbox',{name:'Message',exact:true});await expect(input).toBeEnabled();await input.fill('Same shared owner');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Same shared owner');
 await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toHaveCount(0);
});

test('only exact-owner granted files are offered, with explicit complete metadata paging',async({page})=>{
 await fixture(page,{working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
 await page.route('**/api/shell/resources?*',route=>{
  const next=new URL(route.request().url()).searchParams.get('cursor')==='next-files';
  return route.fulfill({json:{sequence:10,total:3,items:next?[{id:'second-file',threadId:'parent-a',kind:'attachment',label:'Second evidence',path:'C:/synthetic/second',writable:false}]:[{id:'foreign-file',threadId:'another-thread',kind:'file',label:'Other owner secret',path:'C:/synthetic/foreign',writable:false},{id:'owner-file',threadId:'parent-a',kind:'file',label:'Owner evidence',path:'C:/synthetic/owner',writable:false}],nextCursor:next?null:'next-files'}});
 });
 await page.getByRole('button',{name:'Add source',exact:true}).click();await page.getByRole('combobox',{name:'Source type'}).click();await page.getByRole('option',{name:'Granted file',exact:true}).click();
 await expect(page.getByRole('button',{name:'More granted files',exact:true})).toBeVisible();await page.getByRole('button',{name:'More granted files',exact:true}).click();
 await page.getByRole('combobox',{name:'Granted file',exact:true}).click();
 await expect(page.getByRole('option',{name:'Owner evidence',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'Second evidence',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'Other owner secret',exact:true})).toHaveCount(0);
});

test('hidden chat still invalidates Research before delayed scope reacquisition',async({page})=>{
 const h=await fixture(page,{working:false});await expect(page.getByRole('button',{name:/Reference notes/})).toBeVisible();
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let renewing=false;
 await page.route('**/api/conversations/parent-a?*',async route=>{await gate;return route.fulfill({json:{...scopedContext,owner:{...scopedContext.owner,threadId:'parent-a',title:'Project investigation',projectId:'project-a',epoch:38,modelId:'test/model'},scopeKey:'d'.repeat(64),sequence:11,checkpoint:'new-checkpoint'}});});
 await page.route('**/api/conversations/parent-a/transcript?*',route=>route.fulfill({json:{authority:'personal',threadId:'parent-a',scopeKey:'d'.repeat(64),sequence:11,messages:[],nextCursor:null}}));
 await page.route('**/api/conversations/parent-a/updates?*',route=>{renewing=true;return route.fulfill({status:409,json:{error:{code:'RESYNC_REQUIRED'}}});});
 await expect.poll(()=>renewing).toBe(true);await expect(page.getByRole('button',{name:/Reference notes/})).toHaveCount(0);await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toHaveCount(0);
 release();await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();expect(h.requests.filter(path=>path==='/api/snapshot')).toEqual([]);
});


for (const kind of ['capture','bookmark','save'] as const) {
 test(`Research ${kind} cannot retry after synchronous native ownership moves away and returns`,async({page})=>{
  await fixture(page,{native:true,working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let attempts=0;
  const type=kind==='save'?'research.document.save':kind==='bookmark'?'research.source.bookmark':'research.source.capture';
  await page.route('**/api/commands',async route=>{
   const command=route.request().postDataJSON();if(command.type!==type)return route.fallback();attempts++;
   if(attempts===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});}
   return route.fulfill({json:{commandId:command.id,seq:11,result:{documentId:command.payload.documentId,revision:1,sha256:'c'.repeat(64)}}});
  });
  if(kind==='save'){
   await page.getByRole('button',{name:'Start findings',exact:true}).click();await page.getByRole('textbox',{name:'Document body',exact:true}).fill('Preserve this finding');await page.getByRole('button',{name:'Save document',exact:true}).click();
  }else{
   await page.getByRole('button',{name:'Add source',exact:true}).click();
   if(kind==='bookmark'){await page.getByRole('combobox',{name:'Source type'}).click();await page.getByRole('option',{name:'URL bookmark',exact:true}).click();await page.getByRole('textbox',{name:'Source URL',exact:true}).fill('https://example.com/evidence');}
   else await page.getByRole('textbox',{name:'Source text',exact:true}).fill('Preserve this evidence');
   await page.getByRole('textbox',{name:'Source title',exact:true}).fill('Retained source');await page.getByRole('button',{name:kind==='bookmark'?'Save bookmark':'Capture source',exact:true}).click();
  }
  await expect.poll(()=>attempts).toBe(1);
  await page.evaluate(()=>{Reflect.get(window,'publishResearchOwner')(true);Reflect.get(window,'publishResearchOwner')(false);});release();
  await expect(page.getByRole('alert').filter({hasText:'Could not reach research'})).toBeVisible();
  expect(attempts).toBe(1);
  await expect(page.getByRole('textbox',{name:kind==='save'?'Document body':'Source title',exact:true})).toHaveValue(kind==='save'?'Preserve this finding':'Retained source');
 });
}

test('Research owner selection cannot retry a layout write after a synchronous native ownership round trip',async({page})=>{
 await fixture(page,{native:true,working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
 let attempts=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/workspace/commands',async route=>{attempts++;if(attempts===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});}return route.fulfill({status:403,json:{error:{code:'FORBIDDEN'}}});});
 await page.getByRole('combobox',{name:'Research conversation',exact:true}).click();await page.getByRole('option',{name:'Empty draft stays in navigation',exact:true}).click();await expect.poll(()=>attempts).toBe(1);
 await page.evaluate(()=>{Reflect.get(window,'publishResearchOwner')(true);Reflect.get(window,'publishResearchOwner')(false);});release();
 await expect(page.getByRole('alert')).toBeVisible();expect(attempts).toBe(1);
});


test('same-scope resync preserves unfinished source import text',async({page})=>{
 await fixture(page,{working:false});await page.getByRole('button',{name:'Add source',exact:true}).click();
 await page.getByRole('textbox',{name:'Source title',exact:true}).fill('Retained import');await page.getByRole('textbox',{name:'Source text',exact:true}).fill('Unsaved evidence');
 let refreshed=false;await page.route('**/api/conversations/parent-a/updates?*',route=>{if(refreshed)return route.fallback();refreshed=true;return route.fulfill({status:409,json:{error:{code:'RESYNC_REQUIRED'}}});});
 await expect.poll(()=>refreshed).toBe(true);await expect(page.getByRole('dialog',{name:'Add source',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Add source',exact:true}).click();await expect(page.getByRole('textbox',{name:'Source title',exact:true})).toHaveValue('Retained import');await expect(page.getByRole('textbox',{name:'Source text',exact:true})).toHaveValue('Unsaved evidence');
});

test('reopening source import refreshes granted files for its unchanged owner',async({page})=>{
 await fixture(page,{working:false});let changed=false;
 await page.route('**/api/shell/resources?*',route=>route.fulfill({json:{sequence:10,total:1,items:[{id:changed?'new-file':'old-file',threadId:'parent-a',kind:'file',label:changed?'New grant':'Original grant',path:'C:/synthetic/file',writable:false}],nextCursor:null}}));
 await page.getByRole('button',{name:'Add source',exact:true}).click();await page.getByRole('combobox',{name:'Source type'}).click();await page.getByRole('option',{name:'Granted file',exact:true}).click();await expect(page.getByRole('combobox',{name:'Granted file',exact:true})).toHaveText(/Original grant/);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();changed=true;await page.getByRole('button',{name:'Add source',exact:true}).click();await expect(page.getByRole('combobox',{name:'Granted file',exact:true})).toHaveText(/New grant/);
});


test('committing a different model clears unsupported reasoning before Research sends',async({page})=>{
 const h=await fixture(page,{working:false,reasoning:true});await page.getByRole('button',{name:'Show chat',exact:true}).click();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();await page.getByRole('button',{name:'Reasoning: Default',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'High',exact:true}).click();
 await page.getByRole('combobox',{name:'Model',exact:true}).click();await page.getByRole('option',{name:'Other model',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Use the selected model');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);
 expect(h.commands.find(command=>command.type==='message.send')).toMatchObject({threadId:'parent-a',payload:{modelId:'test/other',thinkingLevel:null}});
});


test('an unbound Research workspace saves only an explicitly selected conversation owner',async({page})=>{
 const h=await fixture(page,{working:false,unbound:true});await page.getByRole('combobox',{name:'Research conversation',exact:true}).click();await page.getByRole('option',{name:'Project investigation',exact:true}).click();
 await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();expect(h.commands.filter(command=>command.type==='thread.create')).toEqual([]);expect(h.requests.some(path=>path.startsWith('/api/conversations/parent-a?'))).toBe(true);
});

for(const action of ['capture','save'] as const){
 test(`unmounting Research cancels stale ${action} retries`,async({page})=>{
  await fixture(page,{working:false});let attempts=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type!==(action==='save'?'research.document.save':'research.source.capture'))return route.fallback();attempts++;if(attempts===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});}return route.fulfill({json:{commandId:command.id,seq:11,result:{}}});});
  if(action==='save'){await page.getByRole('button',{name:'Start findings',exact:true}).click();await page.getByRole('textbox',{name:'Document body',exact:true}).fill('Retained finding');await page.getByRole('button',{name:'Save document',exact:true}).click();}
  else {await page.getByRole('button',{name:'Add source',exact:true}).click();await page.getByRole('textbox',{name:'Source title',exact:true}).fill('Retained evidence');await page.getByRole('textbox',{name:'Source text',exact:true}).fill('Evidence content');await page.getByRole('button',{name:'Capture source',exact:true}).click();}
  await expect.poll(()=>attempts).toBe(1);
  // Keyboard workspace navigation remains available outside the modal's content.
  await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='All Agents');button?.click();});
  await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toHaveCount(0);release();
  await page.waitForTimeout(250);expect(attempts).toBe(1);
 });
}

for(const theme of ['dark','light'] as const){
 for(const size of [{width:1440,height:900},{width:1000,height:600},{width:800,height:480}]){
  test(`Research cold geometry ${theme} ${size.width}x${size.height}`,async({page})=>{
   await page.setViewportSize(size);await fixture(page,{native:true,working:false});await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();
   await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
   await page.getByRole('button',{name:'Show chat',exact:true}).click();const send=page.getByRole('button',{name:'Send message',exact:true});await send.scrollIntoViewIfNeeded();
   const rects=await page.evaluate(()=>{const region=document.querySelector('.research-workspace')!.getBoundingClientRect(),toolbar=document.querySelector('.research-toolbar')!.getBoundingClientRect(),send=document.querySelector('.scoped-owner-composer .send-button')!.getBoundingClientRect();return {region:{x:region.x,y:region.y,right:region.right,bottom:region.bottom},toolbar:{x:toolbar.x,y:toolbar.y,right:toolbar.right,bottom:toolbar.bottom},send:{x:send.x,y:send.y,right:send.right,bottom:send.bottom},width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth};});
   expect(rects.region.x).toBeGreaterThanOrEqual(0);expect(rects.region.right).toBeLessThanOrEqual(rects.width+1);expect(rects.region.bottom).toBeLessThanOrEqual(rects.height+1);expect(rects.toolbar.x).toBeGreaterThanOrEqual(rects.region.x);expect(rects.toolbar.right).toBeLessThanOrEqual(rects.region.right+1);expect(rects.send.right).toBeLessThanOrEqual(rects.region.right+1);expect(rects.send.bottom).toBeLessThanOrEqual(rects.region.bottom+1);expect(rects.scroll).toBeLessThanOrEqual(rects.width+1);
  });
 }
}


test('selecting a Research owner updates one conversation binding and retains legacy tool records',async({page})=>{
 await fixture(page,{working:false,legacyTools:true});const mutations:unknown[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/workspace/commands')mutations.push(request.postDataJSON());});
 await page.getByRole('combobox',{name:'Research conversation',exact:true}).click();await page.getByRole('option',{name:'Empty draft stays in navigation',exact:true}).click();
 await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'Research conversation',exact:true})).toHaveText(/Empty draft/);await expect(page.getByRole('alert')).toHaveCount(0);
 expect(mutations).toHaveLength(1);expect(mutations[0]).toMatchObject({type:'workspace.panel.update',payload:{panelId:'research-owner',patch:{binding:{threadId:'empty-draft'}}}});
});

for(const unrelated of [false,true])test(`Research mode ${unrelated?'preserves unrelated':'fences synchronous'} native owner retry`,async({page})=>{
 await fixture(page,{native:true,working:false});await page.getByRole('button',{name:'Show chat',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Message',exact:true});
 const sent:{id:string;type:string;threadId:string;payload:unknown}[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type!=='thread.mode')return route.fallback();sent.push(command);if(sent.length===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});}return route.fulfill({json:{commandId:command.id,seq:11,result:{}}});});
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();await input.press('Enter');await expect.poll(()=>sent.length).toBe(1);
 await page.evaluate(threadId=>{Reflect.get(window,'publishResearchOwner')(true,threadId);Reflect.get(window,'publishResearchOwner')(false,threadId);},unrelated?'empty-draft':'parent-a');release();
 if(unrelated){await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);}
 else {await expect(page.getByRole('alert').filter({hasText:'The command owner changed'})).toBeVisible();expect(sent).toHaveLength(1);}
});

test('Research immediate native takeover fences mode before render and initial dispatch',async({page})=>{
 const h=await fixture(page,{native:true,working:false});await page.getByRole('button',{name:'Show chat',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();
 await page.evaluate(()=>{const frame=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>frame(time=>{window.requestAnimationFrame=frame;Reflect.get(window,'publishResearchOwner')(true);Reflect.set(window,'ownerCallbackSawEnabled',!document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.disabled);callback(time);});});
 await input.press('Enter');await expect(page.getByRole('alert').filter({hasText:'The command owner changed'})).toBeVisible();expect(await page.evaluate(()=>Reflect.get(window,'ownerCallbackSawEnabled'))).toBe(true);expect(h.commands.filter(command=>command.type==='thread.mode')).toHaveLength(0);
});

test('Research immediate native takeover fences save before render and initial dispatch',async({page})=>{
 const h=await fixture(page,{native:true,working:false});await page.getByRole('button',{name:'Start findings',exact:true}).click();await page.getByRole('textbox',{name:'Document body',exact:true}).fill('Must remain local');
 await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Save document')!;Reflect.get(window,'publishResearchOwner')(true);Reflect.set(window,'ownerCallbackSawEnabled',!button.disabled);button.click();});
 await expect(page.getByText('This conversation is open in another window.',{exact:false})).toBeVisible();expect(await page.evaluate(()=>Reflect.get(window,'ownerCallbackSawEnabled'))).toBe(true);expect(h.commands.filter(command=>command.type==='research.document.save')).toHaveLength(0);
});

for(const outcome of ['accepted','INVALID_INPUT'] as const)test(`Research reconciles ${outcome} save after actual host navigation and unmount`,async({page})=>{
 await fixture(page,{working:false});await page.getByRole('button',{name:'Start findings',exact:true}).click();const body=page.getByRole('textbox',{name:'Document body',exact:true});await body.fill('Revision one');
 type Save={id:string;payload:{documentId:string;title:string;body:string;kind:string;citations:unknown[];expectedRevision:number}};
 const sent:Save[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let document:Record<string,unknown>|undefined;
 await page.route('**/api/research/documents/**',route=>route.fulfill({json:document}));
 await page.route('**/api/commands',async route=>{
  const command:Save & {type:string}=route.request().postDataJSON();if(command.type!=='research.document.save')return route.fallback();sent.push(command);
  if(sent.length===1){await gate;if(outcome==='INVALID_INPUT')return route.fulfill({status:400,json:{error:{code:'INVALID_INPUT'}}});}
  const revision=command.payload.expectedRevision+1;
  document={...command.payload,id:command.payload.documentId,authority:{kind:'personal'},threadId:'parent-a',projectId:'project-a',revision,sha256:'c'.repeat(64),savedAt:'2026-11-06T00:00:00Z'};
  return route.fulfill({json:{commandId:command.id,seq:11,result:{documentId:command.payload.documentId,revision,sha256:'c'.repeat(64)}}});
 });
 await page.getByRole('button',{name:'Save document',exact:true}).click();await expect.poll(()=>sent.length).toBe(1);
 await page.getByRole('button',{name:'All Agents',exact:true}).click();await expect(page.getByRole('region',{name:'Research workspace',exact:true})).toHaveCount(0);
 const response=page.waitForResponse(response=>response.url().endsWith('/api/commands')&&response.request().postDataJSON().id===sent[0].id);release();await response;
 await page.getByRole('button',{name:'Research',exact:true}).click();await page.getByRole('button',{name:/Untitled findings/}).click();await expect(body).toHaveValue('Revision one');
 await body.fill('Revision two');await page.getByRole('button',{name:'Save document',exact:true}).click();await expect.poll(()=>sent.length).toBe(2);
 expect(sent[1].id).not.toBe(sent[0].id);expect(sent[1].payload).toMatchObject({body:'Revision two',expectedRevision:outcome==='accepted'?1:0});
 await expect(page.locator('.research-document > p.research-meta')).toContainText(`Saved revision ${outcome==='accepted'?2:1}`);
});


test('Research capture preserves an unrelated synchronous native owner retry',async({page})=>{
 await fixture(page,{native:true,working:false});
 const sent:{id:string;type:string;threadId:string;payload:unknown}[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON();if(command.type!=='research.source.capture')return route.fallback();sent.push(command);if(sent.length===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED'}}});}return route.fulfill({status:400,json:{error:{code:'INVALID_INPUT'}}});});
 await page.getByRole('button',{name:'Add source',exact:true}).click();await page.getByRole('textbox',{name:'Source title',exact:true}).fill('Unrelated control');await page.getByRole('textbox',{name:'Source text',exact:true}).fill('Retain evidence');await page.getByRole('button',{name:'Capture source',exact:true}).click();await expect.poll(()=>sent.length).toBe(1);
 await page.evaluate(()=>{Reflect.get(window,'publishResearchOwner')(true,'empty-draft');Reflect.get(window,'publishResearchOwner')(false,'empty-draft');});release();await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);
});
