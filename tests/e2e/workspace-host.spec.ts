import {test, expect, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import type {AgentSummary} from '../../packages/contracts/agent-inventory';
import type {ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import {serveTaskFixture, taskFixture} from './task-interface-fixture';

async function fixture(page: Page, {native = false, delayed = false, unavailable = false, invalidOwner = false, working = true, pinned = false, archiveConfirmation = true} = {}) {
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
        onState: () => () => {}, onCloseRequested: () => () => {}, list: async () => [], browser: async () => {},
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
  const canvases = ['workspace', 'all-agents', 'code-review', 'research', 'custom'].map(preset => ({id: preset, name: preset, preset, panels: [], viewport: {x: 0, y: 0, zoom: 1}}));
  const envelope = {projects, state: {version: 1, revision: 1, activeCanvasId: invalidOwner ? 'missing' : 'all-agents', canvases, profiles: [], disabledKinds: [], integrations: {}}};
  await page.route('**/api/workspace', async route => {await gate; return failed ? route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Workspace unavailable'}}}) : route.fulfill({json: envelope});});
  await page.route('**/api/workspace/commands', route => {
    const input = route.request().postDataJSON();
    if (input.type === 'workspace.canvas.select') envelope.state.activeCanvasId = input.payload.canvasId;
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
  const module = '/@fs/' + encodeURI(fileURLToPath(new URL('./workspace-app-fixture.tsx', import.meta.url)).replaceAll('\\', '/'));
  await page.route('**/workspace-host-check', route => route.fulfill({contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
  await page.goto('/workspace-host-check');
  return {requests, commands, snapshot, release: () => release?.(), recover: () => {failed = false; envelope.state.activeCanvasId = 'all-agents';}};
}

test('cold restored monitor resolves its owner before any global conversation read', async ({page}) => {
  const h = await fixture(page, {delayed: true});
  await expect.poll(() => h.requests.filter(path => path === '/api/workspace').length).toBe(1);
  expect(h.requests.filter(path => path === '/api/snapshot')).toEqual([]);
  expect(h.requests.filter(path => path.startsWith('/api/models'))).toEqual([]);
  h.release();
  await expect(page.getByRole('region', {name: 'Agent workspace', exact: true})).toBeVisible();
  await expect(page.getByRole('log', {name: 'Project investigation messages', exact: true})).toContainText('Bound live transcript');
  await expect(page.getByRole('button', {name: 'Empty draft stays in navigation Ready', exact: true})).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('saved workspace');
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

test('monitor preserves unpin confirmation with a shared dialog and cancellation', async ({page}) => {
  const h = await fixture(page, {pinned: true});
  await page.getByRole('button', {name: 'Options for Project investigation', exact: true}).click();
  await page.getByRole('button', {name: 'Unpin thread', exact: true}).click();
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
  await page.getByRole('button', {name: 'Archive thread', exact: true}).click();
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
  await page.getByRole('button', {name: 'Archive thread', exact: true}).click();
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

test('review: returning through All Agents retains the latest conversation selection', async ({page}) => {
 await fixture(page, {working:false});
 await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Empty draft stays in navigation Ready',exact:true}).click();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Draft belongs to latest B');
 await page.getByRole('button',{name:'All Agents',exact:true}).click();
 await expect(page.getByRole('region',{name:'Agent workspace',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Workspace',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Draft belongs to latest B');
});

for (const fromMonitor of [false, true]) for (const [preset, label] of [['research', 'Research'], ['code-review', 'Code Review']]) test(`review: first ${label} canvas creation carries the selected conversation from ${fromMonitor ? 'monitor' : 'conversation'}`, async ({page}) => {
 const originalRoute=page.route.bind(page);
 page.route=async (url:any, handler:any, options:any)=>{
  if(url==='**/api/workspace') return originalRoute(url, async route=>{
   const fake={...route, fulfill:async (opts:any)=>{opts.json.state.canvases=opts.json.state.canvases.filter((c:any)=>c.preset!==preset);return route.fulfill(opts);}};
   return handler(fake);
  },options);
  return originalRoute(url,handler,options);
 };
 await fixture(page, {working:false});
 await page.getByRole('button',{name:'Open conversation Project investigation',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Empty draft stays in navigation Ready',exact:true}).click();
 if (fromMonitor) {await page.getByRole('button',{name:'All Agents',exact:true}).click(); await expect(page.getByRole('region',{name:'Agent workspace',exact:true})).toBeVisible();}
 const created=page.waitForRequest(request=>request.url().endsWith('/api/workspace/commands')&&request.postDataJSON().type==='workspace.canvas.create');
 await page.getByRole('button',{name:label,exact:true}).click();
 expect((await created).postDataJSON().payload).toMatchObject({preset,threadId:'empty-draft'});
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
 await expect(page.getByRole('button',{name:'Restored canonical conversation Ready',exact:true})).toBeVisible();
 await expect(composer).toHaveValue('Keep the monitor draft through restore');
 expect(h.requests.filter(path=>path==='/api/snapshot')).toEqual([]);
 await page.getByRole('button',{name:'Restored canonical conversation Ready',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Open restored owner');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>h.commands.find(command=>command.type==='message.send')?.threadId).toBe('restored-thread');
});
test('review: restored native thread owner keeps the monitor composer inert', async ({page})=>{
 const originalInit=page.addInitScript.bind(page);
 page.addInitScript=async (fn:any,arg:any)=>{
  await originalInit(fn,arg);
  if(arg?.native)await originalInit(()=>{
   const bridge=(window as any).harnessDesktop, original=bridge.getContext;
   bridge.focus=async(id:string)=>{(window as any).focusedOwner=id;};
   bridge.getContext=async()=>({...await original(),windows:[{id:'existing-child',surface:{kind:'thread',threadId:'parent-a'},title:'Restored thread'}]});
  });
 };
 const {commands} = await fixture(page,{native:true,working:true});
 const input=page.getByRole('textbox',{name:'Message to Project investigation',exact:true});
 await expect(input).toBeVisible();
 expect(await input.evaluate(node=>Boolean(node.closest('[inert]'))||node.hasAttribute('disabled'))).toBe(true);
 await expect(page.getByRole('button', {name:'Stop Project investigation', exact:true})).toBeDisabled();
 await page.getByRole('button', {name:'Focus existing window', exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).focusedOwner)).toBe('existing-child');
 expect(commands.filter(command=>['message.send','run.stop'].includes(command.type))).toEqual([]);
});

test('desktop ownership updates hold monitor send and Stop then preserve the draft on return', async ({page}) => {
 const originalInit = page.addInitScript.bind(page);
 page.addInitScript = async (fn: any, arg: any) => {
  await originalInit(fn, arg);
  if (arg?.native) await originalInit(() => {
   const bridge = (window as any).harnessDesktop;
   bridge.onState = (notify: (state: unknown) => void) => {
    (window as any).publishOwner = (owned: boolean) => notify({windows: owned ? [{id:'existing-child',surface:{kind:'thread',threadId:'parent-a'},title:'Restored thread'}] : []});
    return () => {};
   };
   bridge.focus = async () => {};
  });
 };
 const h = await fixture(page, {native:true, working:true});
 const composer = page.getByRole('textbox', {name:'Message to Project investigation',exact:true});
 await composer.fill('Keep across native ownership');
 await page.evaluate(() => (window as any).publishOwner(true));
 await expect(composer).toBeDisabled();
 await expect(page.getByRole('button', {name:'Stop Project investigation',exact:true})).toBeDisabled();
 expect(h.commands.filter(command=>['message.send','run.stop'].includes(command.type))).toEqual([]);
 await page.evaluate(() => (window as any).publishOwner(false));
 await expect(composer).toBeEnabled(); await expect(composer).toHaveValue('Keep across native ownership');
 await page.getByRole('button', {name:'Send to Project investigation',exact:true}).click();
 await expect.poll(()=>h.commands.filter(command=>command.type==='message.send').length).toBe(1);
 expect(h.commands.find(command=>command.type==='message.send')).toMatchObject({threadId:'parent-a',payload:{content:'Keep across native ownership'}});
});
