import {test, expect, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import type {AgentSummary} from '../../packages/contracts/agent-inventory';
import type {ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../../packages/core/split-workspace-layout';
import type {SplitWorkspaceLayout} from '../../packages/contracts/split-workspace';
import {serveTaskFixture, taskFixture} from './task-interface-fixture';
import type {DesktopState, DesktopWindowInfo} from '../../packages/desktop-contract/index.ts';

declare global { interface Window {
  publishOwner: (owned?: boolean, threadId?: string) => void;
  focusedOwner?: string;
  ownerCallbackSawEnabled?: boolean;
  failSettingsWrites?: boolean;
  releaseSettingsGuard?: () => void;
} }

async function fixture(page: Page, {native = false, delayed = false, unavailable = false, invalidOwner = false, working = true, pinned = false, archiveConfirmation = true, emptyAgents = false, retiredActive = '', retiredSelectionFailsOnce = false, plugins = {} as {fail?: boolean; manifests?: unknown[]}} = {}) {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Synthetic host fixture'}}}});
  snapshot.threads[0] = {...snapshot.threads[0], id: 'parent-a', title: 'Project investigation', projectId: 'project-a', projectName: 'Alpha', status: working ? 'working' : 'ready', runId: working ? 'run-a' : null};
  snapshot.activeThreadId = 'parent-a'; snapshot.artifacts = []; snapshot.userStates = []; snapshot.data = []; snapshot.messages = [];
  snapshot.settings = {theme: 'dark', modelId: 'test/model', preferences: {showUsageFooter: false, archiveConfirmation, unpinConfirmation: true}};
  if (pinned) snapshot.threads[0].presentation = {pinned: true};
  const emptyDraft = {...snapshot.threads[0], id: 'empty-draft', title: 'Empty draft stays in navigation', status: 'ready' as const, runId: null};
  snapshot.threads.push(emptyDraft);
  const {commands,publish} = await serveTaskFixture(page, snapshot);
  await page.addInitScript(({native}) => {
    localStorage.setItem('harness:selected-thread', 'empty-draft');
    if(!localStorage.getItem('harness:shell-layout:v1'))localStorage.setItem('harness:shell-layout:v1', JSON.stringify({sidebarCollapsed: false}));
    const calls = {subscriptions: 0, ready: 0};
    const callbacks = new Set<(change: {connected: boolean; sequence: number}) => void>();
    const attention = new Set<(id: string) => void>();
    Object.assign(window, {hostFixtureCalls: calls, publishNativeProgress: () => callbacks.forEach(callback => callback({connected: true, sequence: 11})), publishAttention: (id: string) => attention.forEach(callback => callback(id))});
    if (native) {
      const context = {windowId: 'main', surface: {kind: 'main'}, windows: [], nativeTitleBar: true};
      Object.assign(window, {harnessDesktop: {
        getContext: async () => context, ready: async () => {calls.ready++; return context;}, setTheme: async () => {},
        onState: () => () => {}, onCloseRequested: () => () => {}, list: async () => [], browser: async () => {},
        onAttentionOpen: (callback: (id: string) => void) => {attention.add(callback); return () => attention.delete(callback);},
        onWorkspaceChanged: (callback: (change: {connected: boolean; sequence: number}) => void) => {calls.subscriptions++; callbacks.add(callback); return () => callbacks.delete(callback);},
      }});
    }
  }, {native});
  const requests: string[] = [];
  page.on('request', request => {const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(url.pathname + url.search);});
  const rows: ThreadNavigationRow[] = snapshot.threads.map(({id, title, projectId, projectName, createdAt, updatedAt, status, runId, presentation}) => ({id, title, projectId, projectName, createdAt, updatedAt, status, runId, presentation, workspaceId: 'copy-a', threadRevision: 'rev-hover-1'}));
  let failed = unavailable, release!: () => void;
  const gate = delayed ? new Promise<void>(resolve => {release = resolve;}) : Promise.resolve();
  const projects = [{id: 'project-a', name: 'Alpha', authority: {kind: 'local'}, rootPath: 'C:/synthetic/alpha', createdAt: '2026-11-06T00:00:00.000Z'}];
  const canvases = ['workspace', 'all-agents', 'code-review', 'research', 'custom'].map(preset => ({id: preset, name: preset, preset, version: 1, panels: [], filter: 'all', projectIds: [], viewport: {x: 0, y: 0, zoom: 1}}));
  const envelope = {projects, state: {version: 1, revision: 1, activeCanvasId: invalidOwner ? 'missing' : retiredActive || 'all-agents', canvases, profiles: [], disabledKinds: [], integrations: {}}};
  await page.route('**/api/workspace', async route => {await gate; return failed ? route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Workspace unavailable'}}}) : route.fulfill({json: envelope});});
  await page.route('**/api/workspace/commands', route => {
    const input = route.request().postDataJSON();
    if (retiredSelectionFailsOnce && input.type === 'workspace.canvas.select') {
      retiredSelectionFailsOnce = false;
      return route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Could not open the replacement workspace'}}});
    }
    if (input.type === 'workspace.canvas.select') envelope.state.activeCanvasId = input.payload.canvasId;
    envelope.state.revision++; return route.fulfill({json: {commandId: input.id, seq: 1, result: envelope}});
  });
  const dockReads={failMetadata:false};
  const dockLayouts=new Map<string,SplitWorkspaceLayout>(),dockCommands:unknown[]=[],profiles=new Map<string,{id:string;name:string;updatedAt:string;layout:SplitWorkspaceLayout}>();
  const dock=(id:string)=>{if(!dockLayouts.has(id))dockLayouts.set(id,createSplitWorkspaceLayout(id));return dockLayouts.get(id)!;};
  await page.route('**/api/split-workspace?*',route=>route.fulfill({json:dock(new URL(route.request().url()).searchParams.get('workspaceId')!)}));
  await page.route('**/api/split-workspace/profiles?*',route=>{if(dockReads.failMetadata)return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Synthetic layout metadata unavailable'}}});const id=new URL(route.request().url()).searchParams.get('workspaceId');return route.fulfill({json:[...profiles.values()].filter(p=>p.layout.id===id).map(({layout,...p})=>p)});});
  await page.route('**/api/split-workspace/commands',route=>{
   const command=route.request().postDataJSON(),payload=command.payload,id=payload.workspaceId,current=dock(id);dockCommands.push(command);let result:unknown;
   if(command.type==='split-workspace.profile.save'){const profile={id:payload.profileId??'saved-'+profiles.size,name:payload.name,updatedAt:'2026-11-06T12:00:00.000Z',layout:structuredClone(current)};profiles.set(profile.id,profile);result={version:2,layout:current,profile:{id:profile.id,updatedAt:profile.updatedAt}};}
   else if(command.type==='split-workspace.profile.apply'){const next={...structuredClone(profiles.get(payload.profileId)!.layout),id,revision:current.revision+1};dockLayouts.set(id,next);result=next;}
   else{const next=applySplitWorkspaceCommand(current,command.type,payload);dockLayouts.set(id,next);result=next;}
   return route.fulfill({json:{commandId:command.id,seq:1,result}});
  });
  await page.route('**/api/shell-settings', route => route.fulfill({json: snapshot.settings}));
  await page.route('**/api/shell/settings', route => route.fulfill({json: {sequence: 1, settings: snapshot.settings, accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [{id: 'project-a', name: 'Alpha'}], resources: [], resourcePage: {total: 0, nextCursor: null}, counts: {threads: 2, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0}}}));
  await page.route('**/api/shell/archive?*', route => route.fulfill({json: {sequence: 1, total: 0, items: [], nextCursor: null}}));
  await page.route('**/api/shell/navigation?*', route => {const archived = new URL(route.request().url()).searchParams.get('archived') === 'true'; return route.fulfill({json: {sequence: 1, total: archived ? 0 : rows.length, items: archived ? [] : rows, nextCursor: null, order: 'created-desc', stats: {pinned: 0, working: 1, waiting: 0, settled: 0, minOrder: 0, maxOrder: 0}}});});
  await page.route('**/api/shell/navigation/*', route => route.fulfill({json: rows.find(row => row.id === new URL(route.request().url()).pathname.split('/').at(-1))}));
  await page.route('**/api/plugins', route => plugins.fail ? route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Plugin catalog unavailable'}}}) : route.fulfill({json: {plugins: plugins.manifests ?? []}}));
  const agent: AgentSummary = {agentId: 'thread:parent-a', parentId: null, rootId: 'thread:parent-a', jobId: null, threadId: 'parent-a', projectId: 'project-a', projectName: 'Alpha', title: 'Project investigation', status: working ? 'working' : 'ready', modelId: 'test/model', currentAction: 'Reviewing sources', reportedPercent: null, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: 'a', revision: 1, archived: false, readOnly: false, metadata: 'thread'};
  await page.route(url => url.pathname.startsWith('/api/agents'), route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/agents') return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', sequence: 10, items: emptyAgents ? [] : [agent], ancestors: [], nextCursor: null}});
    if (url.pathname.endsWith('/updates')) return route.fulfill({json: {authority: 'personal', scopeKey: 'scope', fromSequence: Number(url.searchParams.get('after')), sequence: 10, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []}});
    if (url.pathname.endsWith('/events')) return; // hold the SSE connection open so the controller settles on Live
    if (url.pathname.endsWith('/history')) return route.fulfill({json: {authority: 'personal', agentId: agent.agentId, threadId: agent.threadId, sequence: 10, nextCursor: null, messages: [{id: 'reply-a', threadId: agent.threadId, role: 'assistant', createdAt: '2026-11-06', runId: 'run-a', content: 'Bound live transcript', contentOffset: 0, contentLength: 21, nextContentCursor: null}]}});
    return route.fulfill({status: 404});
  });
  const module = '/@fs/' + encodeURI(fileURLToPath(new URL('./workspace-app-fixture.tsx', import.meta.url)).replaceAll('\\', '/'));
  await page.route('**/workspace-host-check', route => route.fulfill({contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
  // Start business assertions after the real app has loaded its modules and bootstrapped.
  const bootstrapped = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap' && response.ok());
  await page.goto('/workspace-host-check');
  await bootstrapped;
  return {requests, commands, snapshot, publish, envelope, dockLayouts, dockCommands, profiles, dockReads, release: () => release?.(), recover: () => {failed = false; envelope.state.activeCanvasId = 'all-agents';}};
}



test('cold restored monitor resolves its owner before any global conversation read', async ({page}) => {
  const h = await fixture(page, {delayed: true});
  await expect(page.getByRole('status').filter({hasText: 'Opening workspace'})).toBeVisible();
  await expect(page.locator('.loading-state-skeleton .sidebar')).toBeVisible();
  await expect(page.locator('.loading-state-skeleton .composer-dock .loading-composer')).toBeVisible();
  await expect.poll(() => h.requests.filter(path => path === '/api/workspace').length).toBe(1);
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  expect(h.requests.filter(path => path.startsWith('/api/models'))).toEqual([]);
  h.release();
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await expect(page.getByRole('log', {name: 'Project investigation messages', exact: true})).toContainText('Bound live transcript');
  await expect(page.getByRole('button', {name: /^Empty draft stays in navigation, Ready/})).toBeVisible();
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  expect(h.requests.filter(path => path.startsWith('/api/events'))).toEqual([]);
});

test('native progress never installs the legacy snapshot refresh subscription in the monitor', async ({page}) => {
  const h = await fixture(page, {native: true});
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await page.evaluate(() => Reflect.get(window, 'publishNativeProgress')());
  expect(await page.evaluate(() => Reflect.get(window, 'hostFixtureCalls').subscriptions)).toBe(0);
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'hostFixtureCalls').ready)).toBeGreaterThan(0);
});

test('explicit conversation navigation preserves its draft and returns to the project-row monitor', async ({page}) => {
  const h = await fixture(page);
  const input = page.getByRole('textbox', {name: 'Message to Project investigation', exact: true});
  await expect(input).toBeVisible(); await input.fill('Retain the same owner draft');
  expect(await page.evaluate(() => localStorage.getItem('harness:selected-thread'))).toBe('empty-draft');
  await page.getByRole('button', {name: 'Open conversation Project investigation', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Retain the same owner draft');
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toHaveCount(0);
  const count = h.requests.filter(path => path === '/api/snapshot').length;
  expect(count).toBeGreaterThan(0);
  await page.getByRole('button', {name: 'All Agents', exact: true}).click();
  await expect(input).toHaveValue('Retain the same owner draft');
  expect(h.requests.filter(path => path === '/api/snapshot').length).toBe(count);
});

test('a monitor model intent is scoped to its conversation and consumed once before another Composer mounts', async ({page}) => {
  await fixture(page,{working:false});
  await page.route('**/api/skill-catalog?*',route=>route.fulfill({json:{scope:{kind:'personal'},sources:[],skills:[],inventoryRevision:'a'.repeat(64),nextCursor:null}}));
  const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});await input.fill('/model');
  await expect(page.getByRole('listbox',{name:'Commands and skills'})).toBeVisible();await input.press('Enter');
  await expect(page.getByRole('searchbox',{name:'Search models'})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search models'}).press('Escape');
  await page.getByRole('button',{name:/Empty draft stays in navigation/}).first().click();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
  await expect(page.getByRole('searchbox',{name:'Search models'})).toHaveCount(0);
});

test('workspace resolution failure stays retryable without falling back to a global snapshot', async ({page}) => {
  const h = await fixture(page, {unavailable: true});
  await expect(page.getByRole('alert')).toContainText('Workspace unavailable');
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  h.recover(); await page.getByRole('button', {name: 'Retry workspace', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
});

test('compact Settings reserves sections while metadata loads and retains its search on refresh', async ({page}) => {
  await fixture(page);
  let release!: () => void;
  let gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/shell/settings', async route => {await gate; await route.fallback();});
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  try {
    await expect(dialog.getByRole('status').filter({hasText: 'Opening settings'})).toBeVisible();
    await expect(dialog.locator('.loading-state-skeleton .settings-navigation')).toBeVisible();
    release();
    const search = dialog.getByRole('searchbox', {name: 'Search all settings', exact: true});
    await dialog.getByRole('navigation', {name: 'Settings sections'}).getByRole('button', {name: 'Data & Recovery', exact: true}).click();
    const original = await search.elementHandle();
    gate = new Promise<void>(resolve => {release = resolve;});
    await dialog.getByRole('button', {name: 'Refresh settings', exact: true}).click();
    await expect(dialog.getByRole('status').filter({hasText: 'Opening settings'})).toBeVisible();
    // Search results navigate to the real controls; they do not contain duplicate controls.
    await search.fill('workspace diagnostics');
    await expect(dialog.locator('.loading-state-skeleton')).toHaveCount(0);
    await expect(search).toHaveValue('workspace diagnostics');
    expect(await search.evaluate((node, original) => node === original && document.activeElement === node, original)).toBe(true);
    release(); await expect(dialog.getByRole('status').filter({hasText: 'Opening settings'})).toHaveCount(0);
    await expect(search).toHaveValue('workspace diagnostics');
    expect(await search.evaluate((node, original) => node === original && document.activeElement === node, original)).toBe(true);
  } finally {release();}
});

test('Settings opens over the monitor with compact metadata and preserves the owner', async ({page}) => {
  const h = await fixture(page);
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  await expect(dialog.getByRole('navigation', {name: 'Settings sections'})).toBeVisible();
  await dialog.getByRole('button', {name: 'Appearance', exact: true}).click();
  await expect(dialog.getByRole('heading', {name: 'Appearance', exact: true})).toBeVisible();
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  expect(h.commands.filter(item => item.type === 'workspace.canvas.select')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
});

test('invalid restored owner reports recovery instead of an endless opening state', async ({page}) => {
  const h = await fixture(page, {invalidOwner: true});
  await expect(page.getByRole('alert')).toContainText('workspace layout');
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  h.recover(); await page.getByRole('button', {name: 'Retry workspace', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
});

test('one pending send owner survives opening the ordinary conversation and retains later text', async ({page}) => {
  await fixture(page, {working: false});
  let finish!: () => void;
  const gate = new Promise<void>(resolve => {finish = resolve;});
  const sends: unknown[] = [];
  await page.route('**/api/commands', async route => {
    const input = route.request().postDataJSON(); sends.push(input);
    await gate; await route.fulfill({json: {commandId: input.id, seq: 11, result: {}}});
  });
  await page.getByRole('textbox', {name: 'Message to Project investigation', exact: true}).fill('Original send');
  await page.getByRole('button', {name: 'Send to Project investigation', exact: true}).click();
  await expect.poll(() => sends.length).toBe(1);
  await page.getByRole('button', {name: 'Open conversation Project investigation', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Original send');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Later text');
  finish();
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeEnabled();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Later text');
  await page.getByRole('button', {name: 'All Agents', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message to Project investigation', exact: true})).toHaveValue('Later text');
  expect(sends).toHaveLength(1);
});

test('a native attention destination opens its exact conversation from the monitor', async ({page}) => {
  const h = await fixture(page, {native: true});
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await page.evaluate(() => Reflect.get(window, 'publishAttention')('parent-a'));
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('harness:selected-thread'))).toBe('parent-a');
  expect(h.requests).toContain('/api/shell/navigation/parent-a');
});

test('compact Settings Add resource opens the existing resource grant flow', async ({page}) => {
  await fixture(page);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const settings = page.getByRole('dialog', {name: 'Settings', exact: true});
  await settings.getByRole('button', {name: 'Projects & Working Copies', exact: true}).click();
  await settings.getByRole('button', {name: 'Add resource', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Add a resource', exact: true})).toBeVisible();
});

for(const [kind,label] of [['file','File'],['database','SQLite database'],['export','Export folder']])test(`resource kind ${kind} uses the modal-owned shared selector and preserves exact grant`,async({page})=>{
 const h=await fixture(page,{working:false});await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await settings.getByRole('button',{name:'Projects & Working Copies',exact:true}).click();await settings.getByRole('button',{name:'Add resource',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Add a resource',exact:true}),type=dialog.getByRole('combobox',{name:'Resource type',exact:true});
 await type.click();await expect(dialog.getByRole('listbox',{name:'Resource type',exact:true})).toBeVisible();
 await dialog.getByRole('option',{name:label,exact:true}).click();await expect(type).toContainText(label);
 await dialog.getByRole('textbox',{name:'Absolute local path',exact:true}).fill('C:/synthetic/granted-item');await dialog.getByRole('checkbox',{name:'Allow approved changes',exact:true}).check();
 expect(h.commands.filter(command=>command.type==='resource.grant')).toHaveLength(0);
 await dialog.getByRole('button',{name:'Add resource',exact:true}).click();await expect(dialog).toBeHidden();
 expect(h.commands.filter(command=>command.type==='resource.grant').map(({threadId,payload})=>({threadId,payload}))).toEqual([{threadId:'parent-a',payload:{path:'C:/synthetic/granted-item',kind,writable:true}}]);
});

test('a finished resource grant does not close a reopened picker', async ({page}) => {
 const h=await fixture(page,{working:false});
 let finish!:()=>void;
 const pending=new Promise<void>(resolve=>{finish=resolve;});
 await page.route('**/api/commands',async route=>{
  const input=route.request().postDataJSON();
  if(input.type!=='resource.grant')return route.fallback();
  h.commands.push(input);await pending;
  h.snapshot.resources.push({id:'granted-first',threadId:input.threadId,kind:'file',path:input.payload.path,label:'first-file',writable:false,createdAt:'2026-11-06T00:00:00.000Z'});
  return route.fulfill({json:{commandId:input.id,seq:++h.snapshot.seq,result:{}}});
 });
 const openPicker=async()=>{
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  await settings.getByRole('button',{name:'Projects & Working Copies',exact:true}).click();
  await settings.getByRole('button',{name:'Add resource',exact:true}).click();
 };
 await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await openPicker();
 const dialog=page.getByRole('dialog',{name:'Add a resource',exact:true}),path=dialog.getByRole('textbox',{name:'Absolute local path',exact:true});
 await dialog.getByRole('combobox',{name:'Resource type',exact:true}).click();
 await dialog.getByRole('option',{name:'File',exact:true}).click();
 await path.fill('C:/synthetic/first-file');
 await dialog.getByRole('button',{name:'Add resource',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Granting…',exact:true})).toBeDisabled();
 await expect.poll(()=>h.commands.filter(command=>command.type==='resource.grant').length).toBe(1);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog).toBeHidden();
 await openPicker();
 await path.fill('C:/synthetic/second-draft');
 const refreshed=page.waitForResponse(async response=>new URL(response.url()).pathname==='/api/snapshot'&&response.ok()&&(await response.json()).resources.some((item:{id:string})=>item.id==='granted-first'));
 finish();
 await refreshed;
 // Let the command's refresh and completion handlers commit before inspecting the new dialog.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(path).toBeFocused();
 await expect(path).toHaveValue('C:/synthetic/second-draft');
 expect(h.commands.filter(command=>command.type==='resource.grant').map(({threadId,payload})=>[threadId,payload.path])).toEqual([['parent-a','C:/synthetic/first-file']]);
});

test('monitor preserves unpin confirmation with a shared dialog and cancellation', async ({page}) => {
  const h = await fixture(page, {pinned: true});
  await page.getByRole('button', {name: 'Options for Project investigation', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Unpin thread', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Unpin thread', exact: true});
  await expect(dialog).toBeVisible();
  expect(h.commands.filter(command => command.type === 'thread.presentation')).toHaveLength(0);
  await dialog.getByRole('button', {name: 'Keep pinned', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  expect(h.commands.filter(command => command.type === 'thread.presentation')).toHaveLength(0);
});

test('monitor honors disabled archive confirmation without creating an extra dialog', async ({page}) => {
  const h = await fixture(page, {archiveConfirmation: false, working: false});
  await page.getByRole('button', {name: 'Options for Project investigation', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Archive thread', exact: true}).click();
  await expect.poll(() => h.commands.filter(command => command.type === 'thread.archive').length).toBe(1);
  await expect(page.getByRole('dialog', {name: 'Archive thread', exact: true})).toHaveCount(0);
});

test('a consumed New thread intent is not replayed after returning through the monitor', async ({page}) => {
  const h = await fixture(page);
  await page.getByRole('button', {name: 'New thread', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Select project', exact: true});
  await expect(picker).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'All Agents', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Workspace', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  await expect(picker).toHaveCount(0);
  expect(h.commands.filter(command => command.type === 'thread.create')).toHaveLength(0);
});

test('the Settings keyboard shortcut opens compact Settings in the monitor', async ({page}) => {
  const h = await fixture(page);
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('dialog', {name: 'Settings', exact: true})).toBeVisible();
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
});

test('a rejected overlapping handoff preserves the accepted New thread intent', async ({page}) => {
  const h = await fixture(page);
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/shell-settings', async route => {await gate; await route.fallback();});
  await page.getByRole('button', {name: 'New thread', exact: true}).click();
  await expect.poll(() => h.requests.filter(path => path === '/api/shell-settings').length).toBeGreaterThan(1);
  await page.getByRole('button', {name: 'Open conversation Project investigation', exact: true}).click();
  release();
  await expect(page.getByRole('dialog', {name: 'Select project', exact: true})).toBeVisible();
  expect(h.commands.filter(command => command.type === 'thread.create')).toHaveLength(0);
});

test('Settings close waits for an accepted preference save before applying monitor confirmation', async ({page}) => {
  const h = await fixture(page, {working: false, archiveConfirmation: false});
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  await dialog.getByRole('button', {name: 'General', exact: true}).click();
  let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/commands', async route => {if (route.request().postDataJSON().type === 'settings.update') {started = true; await gate;} await route.fallback();});
  await dialog.getByRole('switch', {name: 'Archive confirmation', exact: true}).click();
  await expect.poll(() => started).toBe(true);
  await page.keyboard.press('Escape');
  try {await expect(dialog).toBeVisible();} finally {release();}
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name: 'Options for Project investigation', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Archive thread', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Archive thread', exact: true})).toBeVisible();
  expect(h.commands.filter(command => command.type === 'thread.archive')).toHaveLength(0);
});

test('keyboard and status Stop share the ordinary composer pending owner', async ({page}) => {
  const h = await fixture(page);
  await page.getByRole('button', {name: 'Open conversation Project investigation', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/commands', async route => {if (route.request().postDataJSON().type === 'run.stop') {calls++; await gate;} await route.fallback();});
  await page.getByRole('button', {name: 'Stop agent', exact: true}).click();
  await expect.poll(() => calls).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => calls).toBe(1);
  release();
  await expect.poll(() => h.commands.filter(command => command.type === 'run.stop').length).toBe(1);
});

test('monitor Stop shortcut stops the focused working agent exactly once (AUD-06)', async ({page}) => {
  const h = await fixture(page);
  const stop = page.getByRole('button', {name: 'Stop Project investigation', exact: true});
  await stop.waitFor({state: 'visible'});
  await stop.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => h.commands.filter(command => command.type === 'run.stop').length).toBe(1);
  expect(h.commands.find(command => command.type === 'run.stop')?.threadId).toBe('parent-a');
});

test('review: returning through All Agents retains the latest conversation selection', async ({page}) => {
 await fixture(page, {working:false});
 await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Empty draft stays in navigation, Ready/}).click();
 await expect(page.getByRole('tab',{name:'Empty draft stays in navigation',exact:true})).toHaveAttribute('aria-selected','true');
 const draftB=page.locator('[data-split-view="thread:empty-draft"]').getByRole('textbox',{name:'Message',exact:true});
 await expect(draftB).toBeVisible();await expect(draftB).toBeEnabled();
 await draftB.fill('Draft belongs to latest B');
 await page.getByRole('button',{name:'All Agents',exact:true}).click();
 await expect(page.getByRole('region',{name:'Agent workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Workspace',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Draft belongs to latest B');
});

test('the workspace switcher offers only supported presets (T05/R12)', async ({page}) => {
  await fixture(page, {working: false});
  await expect(page.getByRole('button', {name: 'Workspace', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'All Agents', exact: true})).toBeVisible();
  for (const label of ['Code Review', 'Research', 'Custom']) await expect(page.getByRole('button', {name: label, exact: true})).toHaveCount(0);
});

for (const preset of ['code-review', 'custom'] as const) test(`a saved ${preset} canvas resolves to Workspace without rewriting the retired record (T05/R12)`, async ({page}) => {
  const h = await fixture(page, {working: false, retiredActive: preset});
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  expect(h.envelope.state.activeCanvasId).toBe('workspace');
  expect(h.envelope.state.canvases).toHaveLength(5);
  const retired = h.envelope.state.canvases.find(canvas => canvas.id === preset)!;
  expect(retired.preset).toBe(preset);
  for (const label of ['Code Review', 'Research', 'Custom']) await expect(page.getByRole('button', {name: label, exact: true})).toHaveCount(0);
});

test('Retry workspace reattempts a failed retired canvas transition at the same revision', async ({page}) => {
  const h = await fixture(page, {working: false, retiredActive: 'custom', retiredSelectionFailsOnce: true});
  await expect(page.getByRole('alert')).toContainText('Could not open the replacement workspace');
  expect(h.envelope.state.revision).toBe(1);
  await page.getByRole('button', {name: 'Retry workspace', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  expect(h.envelope.state.activeCanvasId).toBe('workspace');
  expect(h.envelope.state.revision).toBe(2);
  expect(h.envelope.state.canvases.find(canvas => canvas.id === 'custom')?.preset).toBe('custom');
});

test('explicit retained-canvas restoration still renders a saved retired canvas record (T05/R12)', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('harness:workspace-mode:v3', 'retained-canvas'));
  const h = await fixture(page, {working: false, retiredActive: 'custom'});
  await expect(page.getByRole('region', {name: 'custom canvas', exact: true})).toBeVisible();
  expect(h.envelope.state.activeCanvasId).toBe('custom');
  expect(h.envelope.state.canvases.find(canvas => canvas.id === 'custom')!.preset).toBe('custom');
});

test('PR hover opens the shared linked-pull-requests surface in Workspace, not a retired review canvas (T05/R12)', async ({page}) => {
  await page.addInitScript(() => {
    for (const thread of ['parent-a', 'empty-draft']) for (const panel of ['sidebar', 'linked-pull-requests:' + thread]) {
      const key = 'pr-panel:' + JSON.stringify(['local', 'project-a', thread, 'linked-pull-requests', panel]);
      const value = {version: 1, draft: false, title: '', body: '', baseBranch: 'main', push: false, link: '', basis: null, selected: 8, comments: {}};
      localStorage.setItem('harness:journal-pending:' + encodeURIComponent(key), JSON.stringify({value, updatedAt: Date.now(), generation: crypto.randomUUID()}));
    }
  });
  const h = await fixture(page, {working: false});
  await page.route('**/api/projects/project-a/context*', route => route.fulfill({json: {project: {id: 'project-a', name: 'Alpha', authority: {kind: 'local'}, rootPath: 'C:/synthetic/alpha', createdAt: '2026-11-06T00:00:00.000Z'}, threadId: 'parent-a', workingCopy: {id: 'copy-a', path: 'C:/synthetic/alpha'}, threadRevision: 'rev-hover-1', machineName: 'Synthetic host', editor: {available: false, label: 'Editor'}, branch: 'feature/fixture', head: null, changes: {added: 1, removed: 0, files: 1}, lineage: [], scripts: [], capabilities: {git: true, terminal: false, pullRequests: true}}}));
  await page.route('**/api/projects/project-a/pull-requests/**', route => {
    const number = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (number === 7 || number === 8) return route.fulfill({json: {item: {number, title: number === 7 ? 'Review me' : 'Saved selection', headRefOid: 'a'.repeat(40), state: 'open', files: [], statusCheckRollup: []}, head: 'a'.repeat(40), revision: 'b'.repeat(64), canReview: false}});
    return route.fulfill({json: {repo: 'synthetic/alpha', items: [{number: 7, title: 'Review me', state: 'open'}]}});
  });
  await page.route('**/api/projects/project-a/pull-requests?*', route => route.fulfill({json: {repo: 'synthetic/alpha', items: [{number: 7, title: 'Review me', state: 'open'}]}}));
  await page.route('**/api/projects/project-a/git*', route => route.fulfill({json: {branch: 'feature/fixture', head: 'abcdef1234', revision: 'rev-1', files: [], gitWrite: false, stagedDiff: '', diff: ''}}));
  await page.locator('[data-thread-id="parent-a"] .thread-item').hover();
  const action = page.getByRole('button', {name: /Open PR #7/});
  await action.waitFor({state: 'visible'});
  await action.click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  await expect(page.getByText('Linked pull requests', {exact: true}).first()).toBeVisible();
  await expect(page.locator('.pr-review').first()).toContainText('#7 Review me');
  expect(h.envelope.state.activeCanvasId).toBe('workspace');
  expect(h.envelope.state.canvases).toHaveLength(5);
  await expect(page.getByRole('button', {name: 'Code Review', exact: true})).toHaveCount(0);
});

test('review: restored archived conversation becomes available in monitor navigation', async ({page})=>{
 const h = await fixture(page,{working:false});
 const composer = page.getByRole('textbox', {name:'Message to Project investigation', exact:true});
 await composer.fill('Keep the monitor draft through restore');
 let restored=false;
 const row={id:'restored-thread',title:'Restored canonical conversation',status:'ready' as const,runId:null,projectId:null,projectName:null,createdAt:'2026-11-06',updatedAt:'2026-11-06'};
 await page.route('**/api/shell/settings',route=>route.fulfill({json:{sequence:1,settings:{theme:'dark'},accounts:[],skills:[],skillProposals:[],learning:{supported:true,status:'idle',lastReview:null},projects:[],resources:[],resourcePage:{total:0,nextCursor:null},counts:{threads:3,archivedThreads:restored?0:1,artifacts:0,resources:0,uncertainOperations:0}}}));
 await page.route('**/api/shell/archive?*',route=>route.fulfill({json:{sequence:1,total:restored?0:1,items:restored?[]:[row],nextCursor:null}}));
 await page.route('**/api/shell/navigation?*',route=>route.fulfill({json:{sequence:2,total:restored?1:0,items:restored?[row]:[],nextCursor:null,order:'created-desc',stats:{pinned:0,working:0,waiting:0,settled:1,minOrder:0,maxOrder:0}}}));
 await page.route('**/api/shell/navigation/restored-thread', route=>route.fulfill({json:row}));
 await page.route('**/api/commands',async route=>{if(route.request().postDataJSON().type==='thread.restore'){restored=true;h.snapshot.threads.push({...h.snapshot.threads[0],...row,projectId:undefined});}await route.fallback();});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
 await dialog.getByRole('button',{name:'Data & Recovery',exact:true}).click();
 await dialog.getByRole('button',{name:'Restore thread',exact:true}).click();
 await expect.poll(()=>restored).toBe(true);
 await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Restored canonical conversation, Ready/})).toBeVisible();
 await expect(composer).toHaveValue('Keep the monitor draft through restore');
 expect(h.requests.filter(path=>path==='/api/snapshot')).toEqual([]);
 await page.getByRole('button',{name:/^Restored canonical conversation, Ready/}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Open restored owner');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>h.commands.find(command=>command.type==='message.send')?.threadId).toBe('restored-thread');
});
test('review: restored native thread owner keeps the monitor composer inert', async ({page})=>{
 const originalInit=page.addInitScript.bind(page);
 page.addInitScript=async (fn: Parameters<typeof originalInit>[0], arg: unknown)=>{
  await originalInit(fn,arg as never);
  if((arg as {native?:boolean}|undefined)?.native)await originalInit(()=>{
   const bridge=window.harnessDesktop!, original=bridge.getContext;
   bridge.focus=async(id:string)=>{window.focusedOwner=id;};
   bridge.getContext=async()=>({...await original(),windows:[{id:'existing-child',surface:{kind:'thread',threadId:'parent-a'},title:'Restored thread'} as unknown as DesktopWindowInfo]});
  });
 };
 const {commands} = await fixture(page,{native:true,working:true});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 await expect(input).toBeVisible();
 expect(await input.evaluate(node=>Boolean(node.closest('[inert]'))||node.hasAttribute('disabled'))).toBe(true);
 await expect(page.getByRole('button', {name:'Stop Project investigation', exact:true})).toBeDisabled();
 await page.getByRole('button', {name:'Focus existing window', exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.focusedOwner)).toBe('existing-child');
 expect(commands.filter(command=>['message.send','run.stop'].includes(command.type))).toEqual([]);
});

test('desktop ownership updates hold monitor send and Stop then preserve the draft on return', async ({page}) => {
 const originalInit = page.addInitScript.bind(page);
 page.addInitScript = async (fn: Parameters<typeof originalInit>[0], arg: unknown) => {
  await originalInit(fn, arg as never);
  if ((arg as {native?:boolean}|undefined)?.native) await originalInit(() => {
   const bridge = window.harnessDesktop!;
   bridge.onState = (notify) => {
    window.publishOwner = (owned?: boolean) => notify({windows: owned ? [{id:'existing-child',surface:{kind:'thread',threadId:'parent-a'},title:'Restored thread'}] : []} as unknown as DesktopState);
    return () => {};
   };
   bridge.focus = async () => {};
  });
 };
 const h = await fixture(page, {native:true, working:true});
 const composer = page.getByRole('textbox', {name:'Message to Project investigation',exact:true});
 await page.route('**/api/skill-catalog?*',route=>route.fulfill({json:{scope:{kind:'personal'},sources:[],skills:[],inventoryRevision:'a'.repeat(64),nextCursor:null}}));
 await composer.fill('Keep across native ownership /model');
 await expect(page.getByRole('listbox', {name:'Commands and skills'})).toBeVisible();
 await page.evaluate(() => window.publishOwner(true));
 await expect(composer).toBeDisabled();
 await expect(page.getByRole('listbox', {name:'Commands and skills'})).toHaveCount(0);
 await expect(page.getByRole('button', {name:'Stop Project investigation',exact:true})).toBeDisabled();
 expect(h.commands.filter(command=>['message.send','run.stop'].includes(command.type))).toEqual([]);
 await page.evaluate(() => window.publishOwner(false));
 await expect(composer).toBeEnabled(); await expect(composer).toHaveValue('Keep across native ownership /model');
 await composer.fill('Keep across native ownership');
 await page.getByRole('button', {name:'Send to Project investigation',exact:true}).click();
 await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);
 expect(h.commands.find(command=>command.type==='message.send')).toMatchObject({threadId:'parent-a',payload:{content:'Keep across native ownership'}});
});


test('desktop ownership change prevents a slash mode retry after authentication renewal', async ({page}) => {
 const originalInit=page.addInitScript.bind(page);
 page.addInitScript=async(fn: Parameters<typeof originalInit>[0], arg: unknown)=>{
  await originalInit(fn,arg as never);
  if((arg as {native?:boolean}|undefined)?.native)await originalInit(()=>{
   window.harnessDesktop!.onState=(notify)=>{
    window.publishOwner=()=>notify({windows:[{id:'existing-child',surface:{kind:'thread',threadId:'parent-a'},title:'Restored thread'} as unknown as DesktopWindowInfo]} as unknown as DesktopState);
    return()=>{};
   };
  });
 };
 await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 let attempts=0;
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();
  if(command.type!=='thread.mode')return route.fallback();
  attempts++;
  if(attempts===1){
   await page.evaluate(()=>window.publishOwner());
   await expect(input).toBeDisabled();
   return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});
  }
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await input.fill('/plan');
 await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();
 await input.press('Enter');
 await expect(page.getByRole('status').filter({hasText:'The command owner changed'})).toBeVisible();
 expect(attempts).toBe(1);
});

async function installOwnerPublisher(page: Page) {
 const originalInit=page.addInitScript.bind(page);
 page.addInitScript=async(fn: Parameters<typeof originalInit>[0], arg: unknown)=>{
  await originalInit(fn,arg as never);
  if((arg as {native?:boolean}|undefined)?.native)await originalInit(()=>{
   window.harnessDesktop!.onState=(notify)=>{
    window.publishOwner=(away?:boolean,threadId='parent-a')=>notify({windows:away?[{id:'existing-child',surface:{kind:'thread',threadId},ready:true,minimized:false}]:[]} as DesktopState);
    return()=>{};
   };
  });
 };
}

test('a native owner roundtrip before auth retry still rejects the stale mode',async({page})=>{
 await installOwnerPublisher(page); await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 const sent:unknown[]=[];let attempts=0, release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();if(command.type!=='thread.mode')return route.fallback();attempts++;sent.push(command);
  if(attempts===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});}
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();await input.press('Enter');
 await expect.poll(()=>attempts).toBe(1);
 await page.evaluate(()=>window.publishOwner(true));await expect(input).toBeDisabled();
 await page.evaluate(()=>window.publishOwner(false));await expect(input).toBeEnabled();release();
 await expect(page.getByRole('status').filter({hasText:'The command owner changed'})).toBeVisible();expect(attempts).toBe(1);
});

test('unmounting the monitor before native takeover rejects a stale mode retry',async({page})=>{
 await installOwnerPublisher(page); await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 const sent:unknown[]=[];let attempts=0, release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();if(command.type!=='thread.mode')return route.fallback();attempts++;sent.push(command);
  if(attempts===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});}
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();await input.press('Enter');
 await expect.poll(()=>attempts).toBe(1);
 await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await expect(input).toHaveCount(0);
 await page.evaluate(()=>window.publishOwner(true));
 await expect(page.getByText('Conversation open in another window.',{exact:false})).toBeVisible();release();
 await expect.poll(()=>attempts,{timeout:1500}).toBe(1);
 console.log(JSON.stringify({scenario:'unmount-then-native-takeover',attempts,sent}));
 expect(attempts).toBe(1);
});

test('synchronous native owner roundtrip fences the pending mode retry and permits a later explicit attempt',async({page})=>{
 await installOwnerPublisher(page);await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 const sent:{id:string;type:string;threadId:string;payload:unknown}[]=[];
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();if(command.type!=='thread.mode')return route.fallback();sent.push(command);
  if(sent.length===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});}
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();await input.press('Enter');
 await expect.poll(()=>sent.length).toBe(1);
 // Both trusted callbacks run in one task: there is no DOM wait or React render between them.
 await page.evaluate(()=>{window.publishOwner(true);window.publishOwner(false);});
 release();
 await expect(page.getByRole('status').filter({hasText:'The command owner changed'})).toBeVisible();
 expect(sent).toHaveLength(1);expect(sent[0]).toMatchObject({type:'thread.mode',threadId:'parent-a',payload:{mode:'plan'}});
 await expect(input).toBeEnabled();await input.fill('/default');
 await expect(page.getByRole('option',{name:'/default Switch to Build'})).toBeVisible();await input.press('Enter');
 await expect.poll(()=>sent.length).toBe(2);
 expect(sent[1]).toMatchObject({type:'thread.mode',threadId:'parent-a',payload:{mode:'build'}});
 expect(sent[1].id).not.toBe(sent[0].id);
});

test('native takeover immediately before the mode callback prevents its initial dispatch',async({page})=>{
 await installOwnerPublisher(page);const h=await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();
 // ComposerCommands resumes onMode after this frame. Deliver the native callback
 // inside that frame, before its promise continuation and before a rendered hold.
 await page.evaluate(()=>{
  const frame=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>frame(time=>{
   window.requestAnimationFrame=frame;
   window.publishOwner(true);
   window.ownerCallbackSawEnabled=!document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message to Project investigation"]')!.disabled;
   callback(time);
  });
 });
 await input.press('Enter');
 await expect(page.getByRole('status').filter({hasText:'The command owner changed'})).toBeVisible();
 expect(await page.evaluate(()=>window.ownerCallbackSawEnabled)).toBe(true);
 expect(h.commands.filter(command=>command.type==='thread.mode')).toHaveLength(0);
 await expect(input).toBeDisabled();
});

test('unrelated native owner roundtrip preserves a pending mode retry and its command identity',async({page})=>{
 await installOwnerPublisher(page);await fixture(page,{native:true,working:false});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 const sent:unknown[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();if(command.type!=='thread.mode')return route.fallback();sent.push(command);
  if(sent.length===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});}
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await input.fill('/plan');await expect(page.getByRole('option',{name:'/plan Switch to Plan'})).toBeVisible();await input.press('Enter');
 await expect.poll(()=>sent.length).toBe(1);
 await page.evaluate(()=>{window.publishOwner(true,'empty-draft');window.publishOwner(false,'empty-draft');});release();
 await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);
 await expect(input).toBeEnabled();
});

for(const type of ['message.send','run.stop'] as const)test(`synchronous native owner roundtrip fences the pending ${type} auth retry`,async({page})=>{
 await installOwnerPublisher(page);await fixture(page,{native:true,working:type==='run.stop'});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 const sent:unknown[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON();if(command.type!==type)return route.fallback();sent.push(command);
  if(sent.length===1){await gate;return route.fulfill({status:401,json:{error:{code:'AUTH_REQUIRED',message:'Session renewed'}}});}
  return route.fulfill({json:{commandId:command.id,seq:1,result:{}}});
 });
 await expect(input).toBeEnabled();
 if(type==='message.send')await input.fill('Keep the pending owner message');
 await page.getByRole('button',{name:`${type==='message.send'?'Send to':'Stop'} Project investigation`,exact:true}).click();
 await expect.poll(()=>sent.length).toBe(1);
 await page.evaluate(()=>{window.publishOwner(true);window.publishOwner(false);});release();
 await expect(page.getByRole('alert').filter({hasText:'The command owner changed'})).toBeVisible();expect(sent).toHaveLength(1);
 if(type==='message.send'){
  await expect(input).toHaveValue('Keep the pending owner message');
  await page.getByRole('button',{name:'Retry send to Project investigation',exact:true}).click();
  await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);
  await expect(input).toHaveValue('');
 }
});







async function addCustomArtifacts(page:Page,h:Awaited<ReturnType<typeof fixture>>){
 const source=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic artifact contents'}}}}).artifacts[0];
 h.snapshot.artifacts.push({...source,id:'artifact-a',title:'Artifact A',threadId:'parent-a',stateId:'state-a'},{...source,id:'artifact-b',title:'Artifact B',threadId:'parent-a',stateId:'state-b'});
 await h.publish();await expect(page.locator('.workspace [data-artifact-id="artifact-a"]')).toBeVisible();
}

test('Workspace artifact uses the shared chooser and retains the anchored chat draft',async({page})=>{
 const h=await fixture(page,{working:false});await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await page.getByRole('button',{name:'Workspace',exact:true}).click();await addCustomArtifacts(page,h);
 const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Retain the conversation draft');const node=await draft.elementHandle();
 await page.locator('.workspace [data-artifact-id="artifact-a"]').getByRole('button',{name:'Open artifact in workspace',exact:true}).click();
 const chooser=page.getByRole('combobox',{name:'Workspace artifact',exact:true});
 await expect(page.locator('.artifact-in-workspace')).toBeVisible();
 const toolbar=await page.locator('.workspace-right .panel-toolbar').boundingBox(),artifact=await page.locator('.artifact-in-workspace').boundingBox();
 expect(artifact!.y).toBeGreaterThanOrEqual(toolbar!.y+toolbar!.height);
 await chooser.click();
 await expect(page.getByRole('listbox',{name:'Workspace artifact',exact:true})).toBeVisible();
 await page.getByRole('option',{name:'Artifact B',exact:true}).click();await expect(chooser).toContainText('Artifact B');
 await expect(page.locator('[data-artifact-id="artifact-b"].artifact-in-workspace')).toContainText('Synthetic artifact contents');
 await expect(draft).toHaveValue('Retain the conversation draft');expect(await draft.evaluate((element,original)=>element===original,node)).toBe(true);
 expect(h.commands.filter(command=>['message.send','thread.create'].includes(command.type))).toHaveLength(0);
});









test('monitor Settings code loads only on open and remains reusable after closing during loading',async({page})=>{
 let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),firstChunk=new Promise<void>(resolve=>requested=resolve),chunks:string[]=[];
 await page.route(/\/src\/(?:CompactSettings|Settings)\.tsx(?:\?|$)/,async route=>{chunks.push(new URL(route.request().url()).pathname);requested();await gate;await route.continue();});
 const opening=fixture(page),monitor=page.getByRole('region',{name:'Agent workspace',exact:true});
 try{
  await Promise.race([monitor.waitFor({state:'visible'}),firstChunk]);expect(chunks).toEqual([]);
  const h=await opening,opener=page.getByRole('button',{name:'Settings',exact:true}),dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await opener.click();await expect(dialog.getByRole('status').filter({hasText:'Opening settings'})).toBeVisible();expect(chunks).toEqual(['/src/CompactSettings.tsx']);
  await expect(dialog.locator('.loading-state-skeleton .settings-navigation')).toBeVisible();
  await expect(dialog.locator('.loading-state-skeleton .settings-row')).toHaveCount(3);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  await opener.click();await expect(dialog.getByRole('status').filter({hasText:'Opening settings'})).toBeVisible();expect(chunks).toEqual(['/src/CompactSettings.tsx']);
  release();await expect(dialog.getByRole('searchbox',{name:'Search all settings',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await opener.click();await expect(dialog.getByRole('searchbox',{name:'Search all settings',exact:true})).toBeVisible();
  expect(chunks).toEqual(['/src/CompactSettings.tsx','/src/Settings.tsx']);expect(h.requests.some(path=>path.startsWith('/api/snapshot'))).toBe(false);
 }finally{release();await opening.catch(()=>{});}
});

for(const blocker of ['assets','journal','handoff'] as const)test(`monitor Settings chunk recovery retains ${blocker} before reloading`,async({page})=>{
 if(blocker==='journal')await page.addInitScript(()=>{
  const transaction=IDBDatabase.prototype.transaction,setItem=Storage.prototype.setItem;
  IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){if(window.failSettingsWrites&&args[1]==='readwrite')throw Error('Synthetic journal unavailable');return transaction.apply(this,args);};
  Storage.prototype.setItem=function(key,value){if(window.failSettingsWrites&&key.startsWith('harness:journal-pending:'))throw Error('Synthetic staging unavailable');return setItem.call(this,key,value);};
 });
 await page.route('**/src/CompactSettings.tsx*',route=>route.abort('failed'));
 const h=await fixture(page);await expect(page.getByRole('region',{name:'Agent workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Settings',exact:true});await expect(dialog.getByRole('alert')).toContainText('Settings could not load');
 if(blocker==='assets')await page.evaluate(()=>localStorage.setItem('harness:signature-assets:v1:unmounted-owner:state',JSON.stringify([{id:'pending',stateKey:'signature',base64:'YQ=='}])));
 if(blocker==='handoff')await page.evaluate(async()=>{const path='/src/editor-handoff.ts';window.releaseSettingsGuard=(await import(path)).registerEditorHandoff('settings-reload',async()=>{throw Error('Synthetic handoff refused');});});
 if(blocker==='journal')expect(await page.evaluate(async()=>{window.failSettingsWrites=true;const path='/src/journal.ts';return (await import(path)).journalWrite('settings-reload-test',{draft:'Retain memory draft'}).then(()=>false,()=>true);})).toBe(true);
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await dialog.getByRole('button',{name:'Reload to retry',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText(blocker==='assets'?'signature mark':'Drafts could not be saved');expect(navigations).toBe(0);expect(h.requests.some(path=>path.startsWith('/api/snapshot'))).toBe(false);
 if(blocker==='journal')expect(await page.evaluate(async()=>{const path='/src/journal.ts';return (await import(path)).journalRead('settings-reload-test');})).toEqual({draft:'Retain memory draft'});
 await page.evaluate(()=>{localStorage.removeItem('harness:signature-assets:v1:unmounted-owner:state');window.failSettingsWrites=false;window.releaseSettingsGuard?.();});
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(dialog).toHaveCount(0);
});

const pluginWorkspaceManifest={id:'sample-plugin',name:'Sample',version:'1.0.0',apiVersion:1,compatibleGenVersions:'^0.6.5',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs',workspaces:[{id:'overview',title:'Overview',entryView:'overview-map'}]};

test('plugin workspace tabs stay reachable from All Agents and open through the conversation owner',async({page})=>{
 const h=await fixture(page,{working:false,plugins:{manifests:[pluginWorkspaceManifest]}});
 const tab=page.getByRole('button',{name:'Overview',exact:true});
 await expect(tab).toBeVisible();
 await expect(page.getByRole('button',{name:'All Agents',exact:true})).toHaveAttribute('aria-pressed','true');
 await tab.click();
 await expect(page.locator('section.plugin-workspace[aria-label="Overview"]')).toBeVisible();
 await expect(tab).toHaveAttribute('aria-pressed','true');
 expect(h.envelope.state.activeCanvasId).toBe('workspace');
 expect(h.commands.filter(command=>command.type==='thread.create')).toEqual([]);
});

test('a failed plug-in catalog keeps a dismissible toast and a persistent inline retry in All Agents',async({page})=>{
 const plugins:{fail?:boolean;manifests?:unknown[]}={fail:true};
 await fixture(page,{working:false,plugins});
 const inline=page.locator('.workspace-plugin-notice'),toast=page.locator('.shell-notice');
 await expect(inline).toContainText('Plug-ins could not be loaded.');
 await expect(toast).toContainText('Plug-ins could not be loaded.');
 await toast.hover();await toast.getByRole('button',{name:'Dismiss notification',exact:true}).click();
 await expect(toast).toHaveCount(0);await expect(inline).toBeVisible();
 plugins.fail=false;plugins.manifests=[pluginWorkspaceManifest];
 await inline.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('button',{name:'Overview',exact:true})).toBeVisible();
 await expect(inline).toHaveCount(0);
});

test('All Agents empty copy reconciles with existing conversations and shows a live status dot',async({page})=>{
 await fixture(page,{working:false,emptyAgents:true});
 const empty=page.locator('.agents-empty');
 await expect(empty).toContainText('No active agents.');
 await expect(empty).not.toContainText('Open a conversation to begin.');
 const connectivity=page.locator('.agents-connectivity');
 await expect(connectivity).toHaveAttribute('role','status');
 await expect(connectivity).toContainText('Live');
 await expect(connectivity.locator('.agents-connectivity-dot')).toHaveCount(1);
 await expect(connectivity).toHaveAttribute('data-connected','true');
});

test('an unavailable main layout gives the user a retry without reloading the page', async ({page}) => {
  await fixture(page, {working: false});
  let reads = 0;
  let unavailable = true;
  await page.route('**/api/split-workspace?*', route => {
    reads++;
    if (unavailable) return route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Workspace layout temporarily unavailable.'}}});
    return route.fallback();
  });
  await page.getByRole('button', {name: 'Workspace', exact: true}).click();
  const retry = page.getByRole('button', {name: 'Retry workspace layout', exact: true});
  await expect(page.getByRole('alert').filter({hasText: 'Workspace layout temporarily unavailable.'})).toBeVisible();
  const failedReads = reads;
  unavailable = false;
  let navigations = 0;
  page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations++;});
  await retry.click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(reads).toBeGreaterThan(failedReads);
  expect(navigations).toBe(0);
});
