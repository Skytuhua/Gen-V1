import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
const modal=(page:Page)=>page.getByRole('dialog',{name:'Usage',exact:true});
async function host(page:Page){
 const s=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic Usage App integration'}}}});
 s.artifacts=[];s.data=[];s.messages=[];s.userStates=[];
 s.threads[0].sessionPath='/fixture/pi/tasks/task-thread/sessions/session.jsonl';
 s.usage={'task-thread':{contextTokens:8000,contextWindow:10000,inputTokens:7,outputTokens:null,cost:null,activity:'idle',sessionPercent:null,weeklyPercent:null}};
 s.settings.preferences={showUsageFooter:true,showComposerContext:true};
 s.memory=[{id:'note',threadId:'task-thread',key:'preserved',content:'Keep the existing source decision.',revision:3,author:'user',updatedAt:'2026-11-05T00:00:00.000Z'}];
 const h=await serveTaskFixture(page,s);
 await page.route('**/api/workspace',r=>r.fulfill({json:{state:{version:1,revision:1,activeCanvasId:'main',canvases:[{id:'main',version:1,name:'Workspace',preset:'workspace',viewport:{x:0,y:0,zoom:1},panels:[],filter:'all',projectIds:[]}],disabledKinds:[],integrations:{},profiles:[]},projects:[]}}));
 await page.goto('/');await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible({timeout:15000});return h;
}
test('actual App sidebar Usage opens canonical modal and retains the conversation draft',async({page})=>{
 const h=await host(page),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Preserve this draft');
 await page.getByRole('button',{name:'Usage',exact:true}).click();await expect(modal(page)).toBeVisible();
 await modal(page).getByRole('tab',{name:'Tokens',exact:true}).click();await expect(modal(page)).toContainText('7');await expect(modal(page)).toContainText('Not reported');
 await expect(modal(page)).not.toContainText('Thread memory');await page.keyboard.press('Escape');await expect(draft).toHaveValue('Preserve this draft');
 expect(h.commands.filter(x=>x.type==='thread.create'||x.type==='message.send')).toHaveLength(0);
});
for(const width of [375,768,1440])test(`actual App live usage launcher starts closed and toggles the summary at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await host(page);
 const show=page.getByRole('button',{name:'Show live usage',exact:true}),hide=page.getByRole('button',{name:'Hide live usage',exact:true});
 const summary=page.getByRole('region',{name:'Live usage',exact:true});
 await expect(show).toBeVisible();await expect(show).toHaveAttribute('aria-pressed','false');await expect(summary).toBeHidden();await expect(modal(page)).toHaveCount(0);
 await show.click();await expect(hide).toHaveAttribute('aria-pressed','true');await expect(summary).toBeVisible();
 await summary.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(summary.getByRole('region',{name:'Runtime usage details'})).toBeVisible();
 await hide.click();await expect(summary).toBeHidden();await expect(show).toHaveAttribute('aria-pressed','false');
 await show.click();await expect(summary.getByRole('region',{name:'Runtime usage details'})).toBeVisible();
 await page.reload();await expect(show).toBeVisible();await expect(show).toHaveAttribute('aria-pressed','false');await expect(summary).toBeHidden();
});
test('actual App Live usage preference controls the composer launcher without opening the summary',async({page})=>{
 const h=await host(page),launcher=page.locator('.composer-usage-launcher'),summary=page.getByRole('region',{name:'Live usage',exact:true});
 h.snapshot.settings.preferences={...h.snapshot.settings.preferences,showUsageFooter:false};await h.publish();await expect(launcher).toHaveCount(0);await expect(summary).toBeHidden();
 h.snapshot.settings.preferences={...h.snapshot.settings.preferences,showUsageFooter:true};await h.publish();await expect(launcher).toBeVisible();await expect(launcher).toHaveAttribute('aria-pressed','false');await expect(summary).toBeHidden();
 await launcher.click();await expect(summary).toBeVisible();
 h.snapshot.settings.preferences={...h.snapshot.settings.preferences,showUsageFooter:false};await h.publish();await expect(launcher).toHaveCount(0);await expect(summary).toBeHidden();
});
test('actual App dock header remains a disclosure and its body opens the same Usage modal',async({page})=>{
 await host(page);await page.getByRole('button',{name:'Show live usage',exact:true}).click();const summary=page.getByRole('region',{name:'Live usage',exact:true});
 await summary.getByRole('button',{name:'Inspect live usage',exact:true}).click();await summary.getByRole('button',{name:'Open Usage',exact:true}).click();
 await expect(modal(page)).toBeVisible();await page.keyboard.press('Escape');await expect(summary.getByRole('button',{name:'Open Usage',exact:true})).toBeFocused();
});
test('actual App context portal protects IME, retains its owner command, and never infers a receipt',async({page})=>{
 const h=await host(page),opener=page.getByRole('button',{name:'Inspect context usage',exact:true});await opener.click();
 const popup=page.getByRole('dialog',{name:'Context inspector'}),compact=popup.getByRole('button',{name:'Compact now',exact:true});
 await compact.focus();await compact.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(popup).toBeVisible();
 await compact.click();await expect(popup).toBeVisible();await expect.poll(()=>h.commands.filter(x=>x.type==='run.compact').map(x=>x.threadId)).toEqual(['task-thread']);
 h.snapshot.usage['task-thread'].contextTokens=4000;await h.publish();await expect(popup).not.toContainText('Freed');
 await page.keyboard.press('Escape');await expect(opener).toBeFocused();
});
test('actual App captured usage scope does not switch to another thread on snapshots',async({page})=>{
 const h=await host(page);await page.getByRole('button',{name:'Usage',exact:true}).click();await modal(page).getByRole('tab',{name:'Tokens',exact:true}).click();
 h.snapshot.threads.push({...h.snapshot.threads[0],id:'other',title:'Other synthetic owner'});h.snapshot.usage.other={...h.snapshot.usage['task-thread'],inputTokens:999};h.snapshot.activeThreadId='other';await h.publish();
 await expect(modal(page)).toContainText('Source-bound task fixture');await expect(modal(page)).not.toContainText('999');
});
test('actual App restores the old single Usage route to modal and leaves saved Thread memory reachable',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:shell-layout:v1',JSON.stringify({activeTab:'usage',rightPanelOpen:true,rightPanelWidth:380,sidebarCollapsed:false,folded:{}})));
 await host(page);await expect(modal(page)).toBeVisible();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('harness:shell-layout:v1')??'null')?.activeTab)).toBe('notes');
 await expect(page.getByRole('region',{name:'Thread memory',exact:true})).toHaveCount(1);
 await expect(page.getByRole('textbox',{name:'Note preserved',exact:true})).toHaveValue('Keep the existing source decision.');
});


test('review: a closed remembered Usage tab must not open a blocking dialog on launch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:shell-layout:v1',JSON.stringify({activeTab:'usage',rightPanelOpen:false})));
 await host(page);await expect(modal(page)).toHaveCount(0);
});
test('review: an open restored Usage tab resolves its loaded conversation scope',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:shell-layout:v1',JSON.stringify({activeTab:'usage',rightPanelOpen:true})));
 await host(page);await expect(modal(page)).toBeVisible();await modal(page).getByRole('tab',{name:'Tokens',exact:true}).click();
 await expect(modal(page)).toContainText('7');await expect(modal(page)).toContainText('Source-bound task fixture');
});
