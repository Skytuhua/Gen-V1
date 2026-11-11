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
 const writes=await setup(page);await draft(page).fill('IME draft');await draft(page).dispatchEvent('compositionstart');await expect(page.getByRole('button',{name:'Drafts',exact:true})).toBeDisabled();await draft(page).dispatchEvent('compositionend');await page.getByRole('button',{name:'Drafts',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Save current prompt'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('Draft name')).toBeFocused();await page.getByLabel('Draft name').fill('Name');await page.getByLabel('Draft name').dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.getByRole('dialog',{name:'Save prompt'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Drafts',exact:true})).toBeFocused();expect(writes).toEqual([]);
});
test('approved list captures and stress names remain usable at 1440/1024/768 with reduced motion',async({page},info)=>{
 await setup(page);await save(page);await save(page,'Group the notes by theme and cite each source.','Summarize interview notes');await draft(page).fill('');await open(page);
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(page.getByRole('dialog',{name:'Saved drafts'})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`2-after-${width}.png`)});}
 await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Escape');await seed(page,'full');await open(page);await page.screenshot({path:info.outputPath('stress-list.png')});await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name').fill('Overflow');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt'}).getByRole('alert')).toBeVisible();await page.screenshot({path:info.outputPath('save-error.png')});
});

for(const failure of ['quota','abort','conflict'] as const)test(`empty-composer ${failure} restore failure shows a keyboard-reachable alert and preserves drafts`,async({page},info)=>{
 const writes=await setup(page);await save(page,'Saved prompt','Empty restore');await draft(page).fill('');
 await page.evaluate(async failure=>{const path='/apps/web/src/journal.ts';await (await import(path)).journalFlush();
  if(failure==='conflict'){const original=IDBObjectStore.prototype.get;let injected=false;IDBObjectStore.prototype.get=function(key){if(!injected&&key==='draft:one'&&this.transaction.mode==='readwrite'){injected=true;this.put({value:'Concurrent edit',updatedAt:Date.now()+1,generation:crypto.randomUUID()},key);}return original.call(this,key);};}
  else{const original=IDBObjectStore.prototype.put;let injected=false;IDBObjectStore.prototype.put=function(value,key){if(!injected&&key==='draft:one'){injected=true;throw new DOMException(failure==='quota'?'Restore quota exhausted':'Restore transaction aborted',failure==='quota'?'QuotaExceededError':'AbortError');}return original.call(this,value,key);};}
 },failure);
 await open(page);await page.getByRole('button',{name:'Restore',exact:true}).focus();await page.keyboard.press('Enter');
 const popup=page.getByRole('dialog',{name:'Saved drafts',exact:true});
 await expect(popup.getByRole('alert')).toBeVisible();await expect(popup.getByRole('alert')).toContainText(failure==='conflict'?'current draft changed':failure==='quota'?'Restore quota':'Restore transaction');
 await expect(popup.getByRole('button',{name:'Retry',exact:true})).toBeFocused();await expect(draft(page)).toHaveValue('');
 for(const width of failure==='quota'?[1440,1024,768]:[1440]){await page.setViewportSize({width,height:900});await expect(popup.getByRole('alert')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`restore-${failure}-${width}.png`)});}
 if(failure!=='conflict'){await page.keyboard.press('Enter');await expect(popup.getByRole('alert')).toBeHidden();await expect(popup.getByRole('button',{name:'Save current prompt'})).toBeFocused();await page.keyboard.press('Tab');await expect(popup.getByRole('button',{name:'Restore',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(draft(page)).toHaveValue('Saved prompt');await expect(draft(page)).toBeFocused();}
 await page.reload();await expect(draft(page)).toHaveValue(failure==='conflict'?'Concurrent edit':'Saved prompt');await open(page);await expect(page.getByText('Empty restore',{exact:true})).toBeVisible();expect(writes).toEqual([]);
});

for(const kind of ['excerpt','skill'] as const)test(`new ${kind}-only saves remain reviewable after the original selection is gone`,async({page})=>{
 const writes=await setup(page);await page.evaluate(async({kind,owner})=>{const jp='/apps/web/src/journal.ts',ep='/apps/web/src/terminal-excerpts.ts',j=await import(jp);
  if(kind==='excerpt'){const e=await import(ep);await j.journalWrite(e.excerptDraftKey(owner.threadId),[e.captureTerminalExcerpt({terminalId:'reference-only',threadId:owner.threadId,projectId:owner.projectId,selection:'Reviewed saved output'})]);}
  else await j.journalWrite('draft-skills:'+owner.threadId,[{id:crypto.randomUUID(),name:'Selected review skill',source:'Personal',ref:{version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'saved-skill',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)}}]);
 },{kind,owner});
 await save(page,'','References only');await page.evaluate(async owner=>{const p='/apps/web/src/journal.ts',j=await import(p);await j.journalWrite('draft-excerpts:'+owner.threadId,[]);await j.journalWrite('draft-skills:'+owner.threadId,[]);},owner);
 await page.reload();await expect(draft(page)).toBeEnabled();await open(page);const review=page.getByRole('button',{name:'Review',exact:true});await expect(review).toBeEnabled();await review.focus();await page.keyboard.press('Enter');
 const modal=page.getByRole('dialog',{name:'Review saved references',exact:true});await expect(modal).toBeVisible();await expect(modal.getByText(/No prompt text was saved/)).toBeVisible();
 if(kind==='excerpt')await expect(modal.getByRole('textbox',{name:'Saved excerpt text · reference-only',exact:true})).toHaveValue('Reviewed saved output');else await expect(modal.getByText(/Skill saved-skill: unvalidated revision/)).toBeVisible();
 await expect(modal.getByRole('button',{name:'Restore with references unavailable'})).toBeDisabled();await expect(modal.getByRole('button',{name:'Insert text'})).toBeDisabled();await expect(modal.getByRole('button',{name:'Replace text'})).toBeDisabled();await expect(draft(page)).toHaveValue('');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Drafts',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'Terminal selection · reference-only',exact:true})).toBeHidden();expect(writes).toEqual([]);
});

test('legacy reference-only records expose IDs and keyboard-copyable excerpt text without restoring authority',async({page},info)=>{
 const writes=await setup(page);await page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',jp='/apps/web/src/journal.ts',ep='/apps/web/src/terminal-excerpts.ts',s=await import(sp),j=await import(jp),e=await import(ep);
  const ref={version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'legacy-skill',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)};
  const saved=s.createSavedDraft(owner,'Legacy references','',{resourceRefs:[{resourceId:'legacy-resource'}],skills:[ref],excerpts:[e.captureTerminalExcerpt({terminalId:'legacy-terminal',threadId:owner.threadId,projectId:owner.projectId,selection:'Legacy reviewed output <literal> & café'})]});await j.journalWrite(s.savedDraftLibraryKey(owner),{version:1,owner,records:[saved]});
 },owner);
 const library=()=>page.evaluate(async owner=>{const p='/apps/web/src/saved-drafts.ts';return (await (await import(p)).loadSavedDrafts(owner)).library;},owner),before=await library();
 await open(page);const review=page.getByRole('button',{name:'Review',exact:true});await expect(review).toBeEnabled();await review.focus();await page.keyboard.press('Enter');
 const modal=page.getByRole('dialog',{name:'Review saved references',exact:true}),excerpt=modal.getByRole('textbox',{name:'Saved excerpt text · legacy-terminal',exact:true});
 await expect(modal.getByText(/Resource legacy-resource: unvalidated/)).toBeVisible();await expect(modal.getByText(/Skill legacy-skill: unvalidated/)).toBeVisible();await expect(excerpt).toHaveValue('Legacy reviewed output <literal> & café');await expect(excerpt).toHaveAttribute('readonly','');
 await modal.getByRole('button',{name:'Close dialog',exact:true}).focus();await page.keyboard.press('Tab');await expect(excerpt).toBeFocused();await page.keyboard.press('ControlOrMeta+a');expect(await excerpt.evaluate((el:HTMLTextAreaElement)=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('Legacy reviewed output <literal> & café');
 await expect(modal.getByRole('button',{name:'Restore with references unavailable'})).toBeDisabled();await expect(modal.getByRole('button',{name:'Replace text'})).toBeDisabled();
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(modal).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`reference-review-${width}.png`)});}
 await page.keyboard.press('Escape');await expect(draft(page)).toHaveValue('');expect(await library()).toEqual(before);await page.reload();await expect(draft(page)).toBeEnabled();expect(await library()).toEqual(before);expect(writes).toEqual([]);
});

test('approved thread capacity blocks a new draft with an alert and keeps records in every working copy',async({page})=>{
 const writes=await setup(page);await page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',jp='/apps/web/src/journal.ts',s=await import(sp),j=await import(jp),other={...owner,workingCopyId:'other-copy'};
  for(const [scope,count] of [[owner,19],[other,1]] as const)await j.journalWrite(s.savedDraftLibraryKey(scope),{version:1,owner:scope,records:Array.from({length:count},(_,i)=>s.createSavedDraft(scope,`Existing ${i}`,'Existing text'))});
 },owner);
 await draft(page).fill('Keep this current text');await open(page);await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name',{exact:true}).fill('Over capacity');await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Save prompt',exact:true}).getByRole('alert')).toContainText('20 per thread');await page.keyboard.press('Escape');await expect(draft(page)).toHaveValue('Keep this current text');
 expect(await page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',s=await import(sp);return [(await s.loadSavedDrafts(owner)).library.records.length,(await s.loadSavedDrafts({...owner,workingCopyId:'other-copy'})).library.records.length];},owner)).toEqual([19,1]);expect(writes).toEqual([]);
});

test('idle expiry refreshes an open list and deletes only the expired saved record',async({page})=>{
 await page.clock.install();const writes=await setup(page);await draft(page).fill('Keep the active composer');
 await page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',jp='/apps/web/src/journal.ts',lp='/apps/web/src/draft-limits.ts',s=await import(sp),j=await import(jp),limits=await import(lp),expiring=s.createSavedDraft(owner,'Expires soon','Old saved text'),fresh=s.createSavedDraft(owner,'Still recent','Recent saved text');
  expiring.updatedAt=new Date(Date.now()-limits.SAVED_DRAFT_IDLE_MS+60000).toISOString();await j.journalWrite(s.savedDraftLibraryKey(owner),{version:1,owner,records:[expiring,fresh]});
 },owner);
 await open(page);await expect(page.getByText('Expires soon',{exact:true})).toBeVisible();await page.clock.fastForward(120000);await expect(page.getByText('Expires soon',{exact:true})).toBeHidden();await expect(page.getByText('Still recent',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(draft(page)).toHaveValue('Keep the active composer');await page.reload();await expect(draft(page)).toHaveValue('Keep the active composer');await open(page);await expect(page.getByText('Expires soon',{exact:true})).toBeHidden();await expect(page.getByText('Still recent',{exact:true})).toBeVisible();expect(writes).toEqual([]);
});


async function seedInactiveExpiry(page:Page,untilExpiry:number){
 return page.evaluate(async({owner,untilExpiry})=>{const sp='/apps/web/src/saved-drafts.ts',lp='/apps/web/src/draft-limits.ts',s=await import(sp),limits=await import(lp);
  const scopes=[{...owner,workingCopyId:'inactive-copy'},{...owner,threadId:'inactive-thread'}],keys=scopes.map(scope=>s.savedDraftLibraryKey(scope));
  const request=indexedDB.open('generative-harness-journal',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('entries','readwrite');for(const [i,scope] of scopes.entries()){const expired=s.createSavedDraft(scope,'Expires offscreen','Private old text'),recent=s.createSavedDraft(scope,'Keep recent','Recent text');expired.updatedAt=new Date(Date.now()-limits.SAVED_DRAFT_IDLE_MS+untilExpiry).toISOString();tx.objectStore('entries').put({value:{version:1,owner:scope,records:[expired,recent]},updatedAt:Date.now(),generation:crypto.randomUUID()},keys[i]);}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();return keys;
 },{owner,untilExpiry});
}
async function durableNames(page:Page,keys:string[]){
 return page.evaluate(async keys=>{const request=indexedDB.open('generative-harness-journal',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await Promise.all(keys.map(key=>new Promise<string[]>((resolve,reject)=>{const get=db.transaction('entries').objectStore('entries').get(key);get.onsuccess=()=>resolve(get.result.value.records.map((r:{name:string})=>r.name));get.onerror=()=>reject(get.error);})));}finally{db.close();}
 },keys);
}
for(const access of ['load','list','switch'] as const)test(`global retention evicts inactive threads and copies on ${access}`,async({page})=>{
 const writes=await setup(page);await draft(page).fill('Keep active text');const keys=await seedInactiveExpiry(page,-1);
 if(access==='load')await page.reload();else if(access==='switch')await page.goto('/fixture?copy=empty-copy');else await open(page);
 await expect(draft(page)).toHaveValue('Keep active text');await expect.poll(()=>durableNames(page,keys)).toEqual([['Keep recent'],['Keep recent']]);expect(writes).toEqual([]);
});
test('empty active library schedules expiry for inactive threads and copies without reading their owner',async({page})=>{
 await page.clock.install();const writes=await setup(page);await draft(page).fill('Keep active text');const keys=await seedInactiveExpiry(page,60000);await page.reload();await expect(draft(page)).toHaveValue('Keep active text');await open(page);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();
 expect(await durableNames(page,keys)).toEqual([['Expires offscreen','Keep recent'],['Expires offscreen','Keep recent']]);await page.clock.fastForward(120000);
 await expect.poll(()=>durableNames(page,keys)).toEqual([['Keep recent'],['Keep recent']]);await expect(draft(page)).toHaveValue('Keep active text');expect(writes).toEqual([]);
});


test('another window adding an inactive library reschedules the empty active library deadline',async({page,context})=>{
 await page.clock.install();const writes=await setup(page);await open(page);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();
 const other=await context.newPage();await setup(other,'?thread=inactive-thread');
 const key=await other.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',jp='/apps/web/src/journal.ts',lp='/apps/web/src/draft-limits.ts',s=await import(sp),j=await import(jp),limits=await import(lp),scope={...owner,threadId:'inactive-thread'},expired=s.createSavedDraft(scope,'Expires offscreen','Old text'),recent=s.createSavedDraft(scope,'Keep recent','Recent text');expired.updatedAt=new Date(Date.now()-limits.SAVED_DRAFT_IDLE_MS+60000).toISOString();const key=s.savedDraftLibraryKey(scope);await j.journalWrite(key,{version:1,owner:scope,records:[expired,recent]});return key;},owner);
 await page.clock.fastForward(120000);await expect.poll(()=>durableNames(page,[key])).toEqual([['Keep recent']]);await expect(page.getByText('No saved drafts yet.',{exact:false})).toBeVisible();expect(writes).toEqual([]);
});


async function seedMalformedInactive(page:Page){
 return page.evaluate(async owner=>{const sp='/apps/web/src/saved-drafts.ts',s=await import(sp),scope={...owner,threadId:'damaged-thread',workingCopyId:'damaged-copy'},key=s.savedDraftLibraryKey(scope),row={value:{version:999,owner:scope,records:[],private:'do-not-log-private-text'},updatedAt:Date.now(),generation:crypto.randomUUID()};
  const request=indexedDB.open('generative-harness-journal',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(row,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();return {key,row};
 },owner);
}
async function durableRow(page:Page,key:string){
 return page.evaluate(async key=>{const request=indexedDB.open('generative-harness-journal',1),db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise<unknown>((resolve,reject)=>{const get=db.transaction('entries').objectStore('entries').get(key);get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);});}finally{db.close();}},key);
}
for(const access of ['load','save','list','switch'] as const)test(`malformed inactive library does not block valid ${access} or inactive expiry`,async({page})=>{
 const warnings:string[]=[];page.on('console',message=>{if(message.type()==='warning')warnings.push(message.text());});const writes=await setup(page);await draft(page).fill('Keep active text');const keys=await seedInactiveExpiry(page,-1),bad=await seedMalformedInactive(page);
 if(access==='load')await page.reload();else if(access==='switch')await page.goto('/fixture?copy=valid-empty-copy');else{await open(page);await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true}).getByRole('alert')).toBeHidden();if(access==='save'){await page.getByRole('button',{name:'Save current prompt'}).click();await page.getByLabel('Draft name',{exact:true}).fill('Healthy new draft');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt',exact:true})).toBeHidden();}}
 await expect.poll(()=>durableNames(page,keys)).toEqual([['Keep recent'],['Keep recent']]);await expect(draft(page)).toHaveValue('Keep active text');expect(await durableRow(page,bad.key)).toEqual(bad.row);expect(warnings.join(' ')).not.toContain('do-not-log-private-text');expect(writes).toEqual([]);
});
test('malformed inactive library does not stop the global expiry deadline',async({page})=>{
 await page.clock.install();const writes=await setup(page);await draft(page).fill('Keep active text');const keys=await seedInactiveExpiry(page,60000),bad=await seedMalformedInactive(page);await page.reload();await expect(draft(page)).toHaveValue('Keep active text');await open(page);
 expect(await durableNames(page,keys)).toEqual([['Expires offscreen','Keep recent'],['Expires offscreen','Keep recent']]);await page.clock.fastForward(120000);await expect.poll(()=>durableNames(page,keys)).toEqual([['Keep recent'],['Keep recent']]);expect(await durableRow(page,bad.key)).toEqual(bad.row);await expect(draft(page)).toHaveValue('Keep active text');expect(writes).toEqual([]);
});
