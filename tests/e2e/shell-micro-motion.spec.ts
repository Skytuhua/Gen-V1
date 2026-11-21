import {test,expect} from '@playwright/test';
import {openApp,reloadApp,warmApp} from './app-ready';
test.beforeAll(async({browser,baseURL})=>{await warmApp(browser,baseURL);});
import {resolve} from 'node:path';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {quiescent} from './settle';

const fixture=()=>{const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Review the current changes.'}}}});snapshot.settings.theme='dark';return snapshot;};

test('the empty composer is compact, grows for multiline work and keeps its draft',async({page})=>{
 await serveTaskFixture(page,fixture());await openApp(page);const input=page.getByRole('textbox',{name:'Message',exact:true}),composer=page.locator('form.composer');await expect(input).toBeEnabled();
 expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(96);expect((await input.boundingBox())!.height).toBeLessThanOrEqual(32);
 await input.fill('One\nTwo\nThree\nFour\nFive\nSix');expect((await composer.boundingBox())!.height).toBeGreaterThan(150);await reloadApp(page);await expect(input).toHaveValue('One\nTwo\nThree\nFour\nFive\nSix');
 for(const name of ['Attach files','Select project','Inspect context usage','Send message'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
});
test('desktop navigation becomes inert immediately on collapse and restores on reopen',async({page})=>{
 await serveTaskFixture(page,fixture());await openApp(page);const sidebar=page.getByRole('complementary',{name:'Thread navigation',exact:true});await expect(sidebar).toBeVisible();await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 const collapsed=page.locator('.app-shell > aside.sidebar');await expect(collapsed).toHaveAttribute('inert','');await expect(collapsed).toBeHidden();
 await page.getByRole('button',{name:'Open sidebar',exact:true}).click();await expect(sidebar).toBeVisible();await expect(sidebar).not.toHaveAttribute('inert','');
});
test('a published plan flags the collapsed overview once without replaying on snapshot or theme updates',async({page})=>{
 const snapshot=fixture(),host=await serveTaskFixture(page,snapshot);await openApp(page);
 // The loading shell also renders an overview. Wait for the owning conversation
 // before attaching an observer to an element that startup will replace.
 await expect(page.locator('.split-workspace[data-workspace-id="workspace"] [data-split-view="thread:task-thread"]')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 const overview=page.getByRole('region',{name:'Project overview window',exact:true});await expect(overview).toHaveAttribute('data-collapsed','true');
 await overview.evaluate(node=>{let changes=0;new MutationObserver(records=>{changes+=records.length;}).observe(node,{attributes:true,attributeFilter:['data-collapsed']});Object.assign(window,{overviewCollapses:()=>node.isConnected?changes:-1});});
 snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-01T00:00:00Z',value:{version:1,title:'Repair checkout failures',steps:[{id:'find',title:'Find the failing boundary',status:'working',requirements:[],agentIds:[]}],agents:[]}});await host.publish();
 await expect(overview.getByText('Update available',{exact:true})).toBeVisible();await expect(overview).toHaveAttribute('data-collapsed','true');
 await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','false');await expect(overview.getByRole('region',{name:'Plan summary',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {overviewCollapses:()=>number}).overviewCollapses())).toBe(1);
 snapshot.settings.theme='light';await host.publish();await expect(overview).toHaveAttribute('data-collapsed','false');
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {overviewCollapses:()=>number}).overviewCollapses())).toBe(1);
});
test('settings opens with bounded motion and reduced motion removes travel',async({page})=>{
 await serveTaskFixture(page,fixture());await openApp(page);
 const dialog=page.locator('dialog.settings-dialog');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog).toHaveAccessibleName('Settings');
 // The declared entrance, not a sampled one: a live animation list empties the moment
 // the entrance finishes, which a loaded runner reaches before this assertion runs.
 const entrance=await dialog.evaluate(node=>{const style=getComputedStyle(node);return {duration:Math.max(...style.transitionDuration.split(',').map(value=>Number.parseFloat(value)||0)),properties:style.transitionProperty.split(',').map(value=>value.trim())};});
 expect(entrance.properties).toEqual(expect.arrayContaining(['opacity','transform']));expect(entrance.duration).toBeGreaterThan(0);expect(entrance.duration).toBeLessThan(.4);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(dialog).toBeVisible();
 // Known limit: the app-wide `:root[data-motion]` clamp also yields `transform: none`
 // here, so this half passes even with the dialog's own reduce block removed. It
 // still pins the user-visible outcome; it does not isolate which rule provides it.
 expect(await dialog.evaluate(node=>getComputedStyle(node).transform)).toBe('none');expect(await dialog.evaluate(node=>node.getAnimations().length)).toBe(0);
});
test('navigation shows actual recency without repeating idle status but retains accessible task state',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].updatedAt=new Date(Date.now()-10*60*1000).toISOString();await serveTaskFixture(page,snapshot);await openApp(page);const row=page.locator('.sidebar-thread-row').first();await expect(row.locator('time')).toBeVisible();await expect(row.locator('time')).toHaveAttribute('dateTime',snapshot.threads[0].updatedAt);await expect(row.getByRole('button',{name:'Source-bound task fixture, Ready, 10m, Reusable task surfaces',exact:true})).toBeVisible();expect(await row.locator('.thread-item-state').evaluate(node=>getComputedStyle(node).position)).toBe('absolute');
});

test('completed operation receipts are compact, truthful and retain full evidence on inspection',async({page})=>{
 const snapshot=fixture(),digest='a'.repeat(64);
 snapshot.operations=[{id:'finished',threadId:'task-thread',revision:4,kind:'database.migration',description:`Apply 4 statements and resource version ${digest}`,args:{statements:['alter table projects add archived integer']},resourceIds:['database-one'],preconditions:{sourceSha256:digest},status:'succeeded',approved:true,result:{rowsChanged:12,integrity:'ok'},createdAt:new Date().toISOString()}];
 await serveTaskFixture(page,snapshot);await openApp(page);const receipt=page.getByRole('region',{name:'Operation outcome',exact:true}),summary=receipt.locator('summary').first();
 await expect(summary).toContainText('Succeeded');await expect(summary).toContainText('Apply 4 statements');await expect(receipt.locator('details').first()).not.toHaveAttribute('open','');expect((await receipt.boundingBox())!.height).toBeLessThanOrEqual(66);await expect(receipt.getByText(digest,{exact:false})).toBeHidden();
 expect(await receipt.locator('.operation-outcome-status').evaluate(node=>getComputedStyle(node).color)).toBe(await receipt.evaluate(node=>getComputedStyle(node).getPropertyValue('--success').trim()).then(async color=>page.evaluate(value=>{const node=document.createElement('span');node.style.color=value;document.body.append(node);const resolved=getComputedStyle(node).color;node.remove();return resolved;},color)));
 await summary.click();await receipt.getByText('Changes and preconditions',{exact:true}).click();await expect(receipt.locator('pre').first()).toContainText(digest);await receipt.getByText('Executor result',{exact:true}).click();await expect(receipt.locator('pre').last()).toContainText('rowsChanged');
});

test('failed and cancelled receipts do not claim success and prepared approval retains exact authority',async({page})=>{
 const snapshot=fixture(),base={threadId:'task-thread',revision:7,kind:'file.replace',description:'Replace the reviewed file.',args:{content:'reviewed'},resourceIds:['file-one'],preconditions:{'file-one':'expected-version'},createdAt:new Date().toISOString()};
 snapshot.operations=[{...base,id:'failed',status:'failed',approved:true,error:'The file changed. Review the current version.'},{...base,id:'cancelled',status:'cancelled',approved:true},{...base,id:'prepared',status:'prepared',approved:false}];
 const host=await serveTaskFixture(page,snapshot);await openApp(page);const failed=page.locator('[data-operation-id="failed"]'),cancelled=page.locator('[data-operation-id="cancelled"]'),approval=page.getByRole('region',{name:'Operation approval',exact:true});
 await expect(failed.locator('summary').first()).toContainText('Failed');await expect(cancelled.locator('summary').first()).toContainText('Cancelled');await failed.locator('summary').first().click();await expect(failed.getByText('The file changed. Review the current version.',{exact:true})).toBeVisible();
 await expect(approval.getByText('Replace the reviewed file.',{exact:true})).toBeVisible();await expect(approval.getByRole('button',{name:'Decline operation',exact:true})).toBeVisible();await approval.getByText('Changes and preconditions',{exact:true}).click();await expect(approval.locator('pre')).toContainText('expected-version');await approval.getByRole('button',{name:'Approve operation',exact:true}).click();
 await expect.poll(()=>host.commands.find(command=>command.type==='operation.approve')?.payload).toEqual({operationId:'prepared',revision:7});expect(host.commands.find(command=>command.type==='operation.approve')?.threadId).toBe('task-thread');
});

test('shell notice enters, pauses on hover, auto-expires and exits before unmount',async({page})=>{
 test.setTimeout(60000);
 await serveTaskFixture(page,fixture());await openApp(page);
 await page.evaluate(async fixture=>{
  const root=document.createElement('div');root.setAttribute('aria-label','Shell notice fixture');document.body.append(root);
  await import(fixture);
 },'/@fs/'+resolve('tests/e2e/shell-notice-fixture.tsx').replaceAll('\\','/'));
 await page.evaluate(()=>(window as unknown as {noticeFixture:{render(message:string):void}}).noticeFixture.render('Settings saved.'));
 const notice=page.locator('[aria-label="Shell notice fixture"]').getByRole('status');
 await expect(notice).toBeVisible({timeout:15000});await expect(notice).toContainText('Settings saved.');
 expect(await notice.evaluate(node=>getComputedStyle(node).animationName)).toBe('shell-notice-in');
 await notice.hover();expect(await quiescent(page,6500,()=>notice.count())).toHaveLength(1);await expect(notice).toBeVisible();
 await page.mouse.move(0,0);await expect(notice).toHaveCount(0,{timeout:8000});
 await page.evaluate(()=>(window as unknown as {noticeFixture:{render(message:string):void}}).noticeFixture.render('Saved again.'));
 await expect(notice).toBeVisible();await notice.getByRole('button',{name:'Dismiss notification',exact:true}).click();
 await expect(notice).toHaveAttribute('data-leaving','true');await expect(notice).toHaveCount(0,{timeout:2000});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>(window as unknown as {noticeFixture:{render(message:string):void}}).noticeFixture.render('Quiet mode.'));
 await expect(notice).toBeVisible();expect(await notice.evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 await notice.getByRole('button',{name:'Dismiss notification',exact:true}).click();await expect(notice).toHaveCount(0,{timeout:2000});
});

test('shell notice stays visible when the pointer leaves but keyboard focus remains',async({page})=>{
 await serveTaskFixture(page,fixture());await openApp(page);
 await page.clock.install();
 const fixturePath='/@fs/'+resolve('tests/e2e/shell-notice-fixture.tsx').replaceAll('\\','/');
 await page.evaluate(async path=>{
  const {mountNotice}=await import(path),root=document.createElement('div');
  root.setAttribute('aria-label','Paused notice fixture');document.body.append(root);mountNotice(root);
 },fixturePath);
 const notice=page.locator('[aria-label="Paused notice fixture"]').getByRole('status');
 const dismiss=notice.getByRole('button',{name:'Dismiss notification',exact:true});
 await expect(notice).toBeVisible();await notice.hover();await dismiss.focus();await page.mouse.move(0,0);
 await page.clock.runFor(7000);await expect(notice).toBeVisible();await expect(dismiss).toBeFocused();
 await dismiss.blur();await page.clock.fastForward(6100);await page.clock.fastForward(200);
 await expect(notice).toHaveCount(0);
});
