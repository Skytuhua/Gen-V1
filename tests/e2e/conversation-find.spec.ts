import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import type { Route } from '@playwright/test';
import type { Snapshot, Thread } from '../../packages/contracts';

// Adapted from frontend.spec.ts's host/snapshot protocol pattern. Independent
// synthetic data; the spec is neither imported nor modified.
export function shellSnapshot(empty = false): Snapshot {
  const stamp = '2026-11-06T12:00:00.000Z';
  const threads: Thread[] = empty ? [] : ['one', 'two'].map((id, index) => ({ id, title: index ? 'Review keyboard navigation' : 'Audit the workspace', projectName: null, createdAt: stamp, updatedAt: stamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'capture-session' }));
  return { seq: 1, threads, messages: empty ? [] : [{ id: 'assistant-one', threadId: 'one', role: 'assistant', content: 'Review the workspace, sidebar and composer. This is synthetic audit content.', createdAt: stamp, runId: null }], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: 'test/model' }, activeThreadId: empty ? null : 'one' };
}
export async function shellRoute(route: Route, snapshot: Snapshot, error: boolean): Promise<void> {
  const url = new URL(route.request().url()), path = url.pathname;
  if (error) return route.fulfill({ status: 503, json: { error: { code: 'CAPTURE_503', message: 'Synthetic host unavailable. Retry workspace.' } } });
  const reply = (json: unknown) => route.fulfill({ json });
  if (path === '/api/bootstrap') return reply({ csrfToken: 'capture-shell' });
  if (path === '/api/snapshot') return reply(snapshot);
  if (path === '/api/shell-settings') return reply(snapshot.settings);
  if (path === '/api/models') return reply({ models: [{ id: 'test/model', provider: 'test', name: 'Audit model' }] });
  if (path === '/api/workspace') return reply({ projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace', canvases: [{ id: 'workspace', name: 'Workspace', preset: 'workspace', panels: [], filter: 'all', projectIds: [], viewport: { x: 0, y: 0, zoom: 1 } }], profiles: [], disabledKinds: [], integrations: {} } });
  if (path.startsWith('/api/shell/navigation/')) return reply(snapshot.threads.find(t => t.id === path.split('/').at(-1)));
  if (path === '/api/shell/navigation') return reply({ sequence: snapshot.seq, items: snapshot.threads, total: snapshot.threads.length, nextCursor: null, stats: { minOrder: 0, maxOrder: 1 } });
  if (path === '/api/shell/settings') return reply({ sequence: snapshot.seq, settings: snapshot.settings, accounts: [], skills: [], skillProposals: [], learning: { supported: true, status: 'idle', lastReview: null }, projects: [], resources: [], resourcePage: { total: 0, nextCursor: null }, counts: { threads: snapshot.threads.length, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0 } });
  if (path === '/api/shell/archive' || path === '/api/shell/resources') return reply({ sequence: 1, items: [], total: 0, nextCursor: null });
  if (path === '/api/plugins') return reply({ plugins: [] });
  if (path === '/api/skills/available') return reply({ skills: [], nextCursor: null });
  if (path === '/api/environment') return reply({ revision: 0, entries: [], secretStorageAvailable: false });
  if (path === '/api/integrations') return reply({ integrations: [] });
  if (path === '/api/commands') { const command = route.request().postDataJSON(); return reply({ commandId: command.id, eventSeq: ++snapshot.seq, result: {} }); }
  return reply({ items: [], profiles: [], nextCursor: null });
}
export const shellInit = `
  class CaptureEventSource extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.onopen?.()); }
    close() {}
  }
  Object.defineProperty(window, 'EventSource', {value: CaptureEventSource});
`;

import {scopedContext,scopedEnvelope,scopedMessage} from '../scoped-conversation-fixture';
async function setup(page:Page,count=3){
 const snapshot=shellSnapshot();snapshot.messages=Array.from({length:count},(_,i)=>({...snapshot.messages[0],id:'m'+i,content:i===0?'Review the **work**space, sidebar and composer.':i===1?'I reviewed the workspace and found two areas to check.':'The workspace panel starts closed.',role:i===0?'user':'assistant'}));
 await page.addInitScript(shellInit);await page.route('**/api/**',r=>shellRoute(r,snapshot,false));await page.goto('/fixture');await page.locator('.composer textarea').waitFor();return snapshot;
}
const phrase=(p:Page)=>p.getByRole('textbox',{name:'Find phrase'});
async function open(p:Page){await p.locator('.composer textarea').focus();await p.keyboard.press('Control+f');await expect(phrase(p)).toBeFocused();}
test('literal ranges cross formatting without modifying markup or copied code',async({page})=>{
 await setup(page);const before=await page.locator('.message-content').first().innerHTML();await open(page);await phrase(page).fill('workspace');await expect(page.getByRole('status').filter({hasText:'1 of 3'})).toBeVisible();
 expect(await page.locator('.message-content').first().innerHTML()).toBe(before);expect(await page.evaluate(()=>CSS.highlights.get('conversation-find-all')?.size)).toBe(3);
 await phrase(page).fill('[a].');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();await expect(page.getByLabel('Next match')).toBeDisabled();
});
test('wraps both directions; Escape restores opener and draft caret',async({page})=>{
 await setup(page);const draft=page.locator('.composer textarea');await draft.fill('Retained draft workspace');await draft.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(3,3));await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');await expect(page.getByRole('status').filter({hasText:'2 of 3'})).toBeVisible();await page.keyboard.press('Shift+Enter');await page.keyboard.press('Shift+Enter');await expect(page.getByRole('status').filter({hasText:'3 of 3'})).toBeVisible();await page.keyboard.press('Escape');await expect(draft).toBeFocused();await expect(draft).toHaveValue('Retained draft workspace');expect(await draft.evaluate((el:HTMLTextAreaElement)=>el.selectionStart)).toBe(3);
});
test('ignores composing keyboard events',async({page})=>{
 await setup(page);await open(page);await phrase(page).fill('workspace');await phrase(page).dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.getByRole('status').filter({hasText:'1 of 3'})).toBeVisible();await phrase(page).dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(phrase(page)).toBeVisible();
});
test('extends loaded history beyond 100; keeps the selected range when older messages mount',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');await expect(page.getByRole('status').filter({hasText:'1 of 100'})).toBeVisible();await page.getByRole('button',{name:'Load older messages',exact:true}).click();await expect(page.locator('.message')).toHaveCount(125);await expect(page.getByRole('status').filter({hasText:'26 of 125'})).toBeVisible();await expect(page.getByText('Loaded messages',{exact:true})).toBeVisible();
});
test('scoped reader keeps partial scope and exposes real loading and retry errors',async({page})=>{
 let older=false,hold:()=>void=()=>{};let fail=false;const gate=new Promise<void>(resolve=>{hold=resolve;});await page.route('**/api/**',async r=>{const url=new URL(r.request().url());if(url.pathname==='/api/bootstrap')return r.fulfill({json:{csrfToken:'fixture'}});if(url.pathname.endsWith('/transcript')){if(url.searchParams.has('cursor')){await gate;older=true;if(fail)return r.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});}return r.fulfill({json:{...scopedEnvelope,messages:[scopedMessage(older?'old':'m','workspace')],nextCursor:older?null:'older'}});}if(url.pathname.endsWith('/updates'))return r.fulfill({json:{...scopedEnvelope,fromSequence:scopedContext.sequence,owner:null,transcriptChanged:false}});return r.fulfill({json:scopedContext});});
 await page.goto('/fixture?scoped=1');await expect(page.locator('[data-message-id]')).toHaveCount(1);await page.getByLabel('Find in conversation',{exact:true}).click();await phrase(page).fill('workspace');await page.getByRole('search').getByText('Load older messages').click();await expect(page.getByRole('search').getByText('Loading older messages…')).toBeVisible();fail=true;hold();await expect(page.getByRole('search').getByRole('alert')).toContainText('Could not load');await expect(page.getByText('Loaded messages',{exact:true})).toBeVisible();
});
test('keyboard and reduced/off motion find paths are immediate at desktop and smoke widths',async({page},info)=>{
 await setup(page);await page.emulateMedia({reducedMotion:'reduce'});await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');
 const out=info.outputPath('screenshots');await mkdir(out,{recursive:true});
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(phrase(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.getByRole('search').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);await page.screenshot({path:`${out}/4-after-${width}.png`});}
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.setProperty('--ui-motion-scale','0');});await phrase(page).fill('no-matches');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
});

test('owner switch clears find and excluded composer text is never counted',async({page})=>{
 await setup(page);await page.locator('.composer textarea').fill('unique-draft-phrase');await open(page);await phrase(page).fill('unique-draft-phrase');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
 await phrase(page).fill('workspace');await page.getByRole('button',{name:'Review keyboard navigation Ready',exact:true}).click();await expect(phrase(page)).toBeHidden();expect(await page.evaluate(()=>CSS.highlights.get('conversation-find-all')?.size??0)).toBe(0);
});
test('retains active match and reading position on rendered background additions',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');const top=await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop);
 await page.locator('.conversation').evaluate(el=>{const message=document.createElement('div');message.className='message';message.innerHTML='<div class="message-content">New workspace update</div>';el.append(message);});
 await expect(page.getByRole('status').filter({hasText:'2 of 101'})).toBeVisible();expect(await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop)).toBe(top);
});

test('Enter activates the focused previous, close and history buttons',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');
 await page.getByRole('button',{name:'Previous match',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('status').filter({hasText:'100 of 100'})).toBeVisible();
 await page.getByRole('button',{name:'Load older messages',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.message')).toHaveCount(125);
 await page.getByRole('button',{name:'Close find',exact:true}).focus();await page.keyboard.press('Enter');await expect(phrase(page)).toBeHidden();
});
test('Escape and Close restore the rendered Find trigger',async({page})=>{
 await setup(page);const trigger=page.getByRole('button',{name:'Find in conversation',exact:true});await trigger.focus();await page.keyboard.press('Enter');await expect(phrase(page)).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close find',exact:true}).click();await expect(trigger).toBeFocused();
});
