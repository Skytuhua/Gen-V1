import {test,expect,type Page} from '@playwright/test';
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
const owner={profileId:'fixture-profile',accountId:'fixture-account',threadId:'one',projectId:'capture-project',workingCopyId:'fixture-copy'};
async function setup(page:Page,query=''){
 const snapshot=shellSnapshot(),writes:string[]=[];await page.addInitScript(shellInit);await page.route('**/api/**',async r=>{if(r.request().method()!=='GET')writes.push(new URL(r.request().url()).pathname);return shellRoute(r,snapshot,false);});await page.goto('/fixture'+query);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();return writes;
}
const draft=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
async function open(page:Page){await page.getByRole('button',{name:'Drafts',exact:true}).click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toBeVisible();}
async function save(page:Page,text='Compare the changes with the checklist and flag anything missing.',name='Review the release notes'){
 await draft(page).fill(text);await open(page);await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name',{exact:true}).fill(name);await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt',exact:true})).toBeHidden();
}
async function seed(page:Page,kind:'rich'|'full'|'corrupt'){
 await page.evaluate(async({owner,kind})=>{const path='/apps/web/src/saved-drafts.ts',journalPath='/apps/web/src/journal.ts',excerptPath='/apps/web/src/terminal-excerpts.ts';const s=await import(path),j=await import(journalPath),e=await import(excerptPath);const ref={version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'review',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)};
 const excerpt=e.captureTerminalExcerpt({terminalId:'saved-terminal',projectId:owner.projectId,threadId:owner.threadId,selection:'Saved output'});
 const records=kind==='rich'?[s.createSavedDraft(owner,'With references','Recovered text',{resourceRefs:[{resourceId:'revoked-resource'}],skills:[ref],excerpts:[excerpt]})]:Array.from({length:20},(_,i)=>s.createSavedDraft(owner,`Long named prompt ${i} `+'unbroken-project-name-'.repeat(4),'Compare details. '.repeat(3)));
 await j.journalWrite(s.savedDraftLibraryKey(owner),kind==='corrupt'?{version:999}:{version:1,owner,records});
 if(kind==='rich')await j.journalWrite(e.excerptDraftKey(owner.threadId),[e.captureTerminalExcerpt({terminalId:'current-terminal',projectId:owner.projectId,threadId:owner.threadId,selection:'Current output'})]);
 },{owner,kind});
}
test('named save, reload, delete/cancel and empty state stay local',async({page})=>{
 const writes=await setup(page);await open(page);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();await page.keyboard.press('Escape');await save(page);await page.reload();await expect(draft(page)).toBeEnabled();await open(page);await expect(page.getByText('Review the release notes',{exact:true})).toBeVisible();await page.getByLabel('Delete draft Review the release notes').click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await open(page);await expect(page.getByText('Review the release notes',{exact:true})).toBeVisible();await page.getByLabel('Delete draft Review the release notes').click();await page.getByRole('button',{name:'Delete draft',exact:true}).click();await open(page);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();expect(writes).toEqual([]);
});
test('replace keeps recoverable text, insert respects caret and preserves selection, cancel preserves current input',async({page})=>{
 await setup(page);await save(page,'RESTORED','Named prompt');await draft(page).fill('Current draft');await open(page);await page.getByRole('button',{name:'Restore',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(draft(page)).toHaveValue('Current draft');await open(page);await page.getByRole('button',{name:'Restore',exact:true}).click();await page.getByRole('button',{name:'Replace text'}).click();await expect(draft(page)).toHaveValue('RESTORED');await expect(draft(page)).toBeFocused();await open(page);await expect(page.getByText(/Before replacing ·/)).toBeVisible();await page.keyboard.press('Escape');await draft(page).fill('abcd');await draft(page).evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(2,3));await open(page);await page.getByRole('button',{name:'Restore',exact:true}).last().click();await page.getByRole('button',{name:'Insert text'}).click();await expect(draft(page)).toHaveValue('abRESTOREDcd');expect(await draft(page).evaluate((el:HTMLTextAreaElement)=>el.selectionStart)).toBe(10);
});
test('stale restore is rejected atomically after a concurrent window edit',async({page,context})=>{
 await setup(page);await save(page,'Saved text','Named prompt');await draft(page).fill('Original current');await open(page);await page.getByRole('button',{name:'Restore',exact:true}).click();const other=await context.newPage();await setup(other);await draft(other).fill('Concurrent edit');await expect(draft(page)).toHaveValue('Concurrent edit');await page.getByRole('button',{name:'Replace text'}).click();await expect(page.getByRole('dialog',{name:'Restore saved draft'}).getByRole('alert')).toContainText('current draft changed');await expect(draft(other)).toHaveValue('Concurrent edit');await page.getByRole('button',{name:'Cancel',exact:true}).click();await open(page);await expect(page.getByText(/Before replacing ·/)).toHaveCount(0);
});
test('rich records list missing/revoked references but restore text only, preserving current excerpts',async({page})=>{
 const writes=await setup(page);await seed(page,'rich');await draft(page).fill('Current text');await open(page);await page.getByRole('button',{name:'Restore text only',exact:true}).click();await expect(page.getByText(/Resource revoked-resource: unvalidated/)).toBeVisible();await expect(page.getByText(/Skill review: unvalidated revision/)).toBeVisible();await expect(page.getByText(/Terminal saved-terminal: saved excerpt not restored/)).toBeVisible();await expect(page.getByRole('button',{name:'Restore with references unavailable'})).toBeDisabled();await page.getByRole('button',{name:'Replace text'}).click();await expect(draft(page)).toHaveValue('Recovered text');await expect(page.getByRole('button',{name:'Terminal selection · current-terminal',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Terminal selection · saved-terminal',exact:true})).toBeHidden();expect(writes).toEqual([]);
});
test('account/profile/thread/project/working-copy libraries remain isolated',async({page})=>{
 await setup(page);await save(page);for(const field of ['account','profile','thread','project','copy']){await page.goto('/fixture?'+field+'=other');await expect(draft(page)).toBeEnabled();await open(page);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();}await page.goto('/fixture');await expect(draft(page)).toBeEnabled();await open(page);await expect(page.getByText('Review the release notes',{exact:true})).toBeVisible();
});
test('quota failure and corrupt records keep the active draft and offer retry',async({page})=>{
 await setup(page);await draft(page).fill('Keep through quota');await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(String(key).startsWith('saved-drafts:'))throw new DOMException('Quota exhausted','QuotaExceededError');return original.call(this,value,key);};});await open(page);await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name').fill('Quota prompt');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt'}).getByRole('alert')).toContainText('Quota');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(draft(page)).toHaveValue('Keep through quota');await page.reload();await expect(draft(page)).toHaveValue('Keep through quota');await seed(page,'corrupt');await open(page);await expect(page.getByRole('dialog',{name:'Saved drafts'}).getByRole('alert')).toContainText('could not load');await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(draft(page)).toHaveValue('Keep through quota');
});
test('keyboard/IME does not save or send a composing name; focus returns to the trigger',async({page})=>{
 const writes=await setup(page);await draft(page).fill('IME draft');await draft(page).dispatchEvent('compositionstart');await expect(page.getByRole('button',{name:'Drafts',exact:true})).toBeDisabled();await draft(page).dispatchEvent('compositionend');await page.getByRole('button',{name:'Drafts',exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await expect(page.getByLabel('Draft name')).toBeFocused();await page.getByLabel('Draft name').fill('Name');await page.getByLabel('Draft name').dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.getByRole('dialog',{name:'Save prompt'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Drafts',exact:true})).toBeFocused();expect(writes).toEqual([]);
});
test('approved list captures and stress names remain usable at 1440/1024/768 with reduced motion',async({page},info)=>{
 await setup(page);await save(page);await save(page,'Group the notes by theme and cite each source.','Summarize interview notes');await draft(page).fill('');await open(page);
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(page.getByRole('dialog',{name:'Saved drafts'})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`2-after-${width}.png`)});}
 await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Escape');await seed(page,'full');await open(page);await page.screenshot({path:info.outputPath('stress-list.png')});await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name').fill('Overflow');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt'}).getByRole('alert')).toBeVisible();await page.screenshot({path:info.outputPath('save-error.png')});
});

for(const failure of ['quota','abort','conflict'] as const)test(`empty-composer ${failure} restore failure remains visible and preserves text`,async({page})=>{
 await setup(page);await save(page,'Saved prompt','Empty restore');await draft(page).fill('');
 await page.evaluate(async failure=>{const path='/apps/web/src/journal.ts';await (await import(path)).journalFlush();
  if(failure==='conflict'){const original=IDBObjectStore.prototype.get;let injected=false;IDBObjectStore.prototype.get=function(key){if(!injected&&key==='draft:one'&&this.transaction.mode==='readwrite'){injected=true;this.put({value:'Concurrent edit',updatedAt:Date.now()+1,generation:crypto.randomUUID()},key);}return original.call(this,key);};}
  else{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='draft:one')throw new DOMException(failure==='quota'?'Restore quota exhausted':'Restore transaction aborted',failure==='quota'?'QuotaExceededError':'AbortError');return original.call(this,value,key);};}
 },failure);
 await open(page);await page.getByRole('button',{name:'Restore',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('alert')).toContainText(failure==='conflict'?'current draft changed':failure==='quota'?'Restore quota':'Restore transaction');
 await page.reload();await expect(draft(page)).toHaveValue(failure==='conflict'?'Concurrent edit':'');await open(page);await expect(page.getByText('Empty restore',{exact:true})).toBeVisible();
});
for(const kind of ['excerpt','skill'] as const)test(`rejects a new ${kind}-only save with a visible prompt-text explanation`,async({page})=>{
 await setup(page);await page.evaluate(async({kind,owner})=>{const jp='/apps/web/src/journal.ts',ep='/apps/web/src/terminal-excerpts.ts',j=await import(jp);
  if(kind==='excerpt'){const e=await import(ep);await j.journalWrite(e.excerptDraftKey(owner.threadId),[e.captureTerminalExcerpt({terminalId:'reference-only',threadId:owner.threadId,projectId:owner.projectId,selection:'Recoverable output'})]);}
  else await j.journalWrite('draft-skills:'+owner.threadId,[{id:crypto.randomUUID(),name:'Selected review skill',source:'Personal',ref:{version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'review',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)}}]);
 },{kind,owner});
 await open(page);await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name').fill('Reference-only');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt'}).getByRole('alert')).toContainText('prompt text');
 expect(await page.evaluate(async owner=>{const path='/apps/web/src/saved-drafts.ts';return (await (await import(path)).loadSavedDrafts(owner)).library.records.length;},owner)).toBe(0);
});
test('legacy reference-only records remain inspectable while rich restore stays disabled',async({page})=>{
 await setup(page);await page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',jp='/apps/web/src/journal.ts',ep='/apps/web/src/terminal-excerpts.ts',s=await import(sp),j=await import(jp),e=await import(ep);
  const ref={version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'legacy-skill',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)};
  const saved=s.createSavedDraft(owner,'Legacy references','',{resourceRefs:[{resourceId:'legacy-resource'}],skills:[ref],excerpts:[e.captureTerminalExcerpt({terminalId:'legacy-terminal',threadId:owner.threadId,projectId:owner.projectId,selection:'Legacy reviewed output'})]});await j.journalWrite(s.savedDraftLibraryKey(owner),{version:1,owner,records:[saved]});
 },owner);
 await open(page);await expect(page.getByRole('button',{name:'Review',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Review',exact:true}).click();await expect(page.getByText(/Resource legacy-resource: unvalidated/)).toBeVisible();await expect(page.getByText(/Skill legacy-skill: unvalidated/)).toBeVisible();await expect(page.getByText('Legacy reviewed output',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Restore with references unavailable'})).toBeDisabled();await expect(page.getByRole('button',{name:'Replace text'})).toBeDisabled();await expect(draft(page)).toHaveValue('');
});
