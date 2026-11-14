import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const fixture=()=>{const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Review the current changes.'}}}});snapshot.settings.theme='dark';return snapshot;};
async function watchAnimations(page:import('@playwright/test').Page){
 await page.addInitScript(()=>{const original=Element.prototype.animate;Object.assign(window,{shellMotionEvents:[]});Element.prototype.animate=function(frames,options){const element=this as HTMLElement;(window as unknown as {shellMotionEvents:unknown[]}).shellMotionEvents.push({floatingId:element.dataset.floatingId,frames});return original.call(this,frames,options);};});
}

test('the empty composer is compact, grows for multiline work and keeps its draft',async({page})=>{
 await serveTaskFixture(page,fixture());await page.goto('/');const input=page.getByRole('textbox',{name:'Message',exact:true}),composer=page.locator('form.composer');await expect(input).toBeEnabled();
 expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(96);expect((await input.boundingBox())!.height).toBeLessThanOrEqual(32);
 await input.fill('One\nTwo\nThree\nFour\nFive\nSix');expect((await composer.boundingBox())!.height).toBeGreaterThan(150);await page.reload();await expect(input).toHaveValue('One\nTwo\nThree\nFour\nFive\nSix');
 for(const name of ['Add resource','Inspect context usage','Send message'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
});
test('desktop navigation stays visible through its close while becoming inert immediately',async({page})=>{
 await serveTaskFixture(page,fixture());await page.goto('/');const sidebar=page.getByRole('complementary',{name:'Thread navigation',exact:true});await expect(sidebar).toBeVisible();await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await expect(sidebar).toHaveAttribute('inert','');expect(await sidebar.evaluate(node=>getComputedStyle(node).visibility)).toBe('visible');await expect(sidebar).toBeHidden();
 await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await expect(sidebar).toBeVisible();await expect(sidebar).not.toHaveAttribute('inert','');
});
test('a window opened from Thread options animates once without replaying on snapshot or theme updates',async({page})=>{
 await watchAnimations(page);const snapshot=fixture(),host=await serveTaskFixture(page,snapshot);await page.goto('/');await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();const panel=page.getByRole('region',{name:'Task plan window',exact:true});await expect(panel).toBeVisible();
 const count=()=>page.evaluate(()=>(window as unknown as {shellMotionEvents:{floatingId?:string}[]}).shellMotionEvents.filter(event=>event.floatingId==='plan').length);
 await expect.poll(count).toBe(1);await host.publish();snapshot.settings.theme='light';await host.publish();await expect.poll(count).toBe(1);
});
test('settings opens with bounded motion and reduced motion removes travel',async({page})=>{
 await serveTaskFixture(page,fixture());await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.locator('dialog.settings-dialog');await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-label','Settings');expect(await dialog.evaluate(node=>node.getAnimations().length)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(dialog).toBeVisible();const frames=await dialog.evaluate(node=>node.getAnimations().flatMap(animation=>(animation.effect as KeyframeEffect).getKeyframes()).map(frame=>frame.transform).filter(value=>value!==undefined));expect(frames.every(value=>value==='none')).toBe(true);
});
test('navigation shows actual recency without repeating idle status but retains accessible task state',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].updatedAt=new Date(Date.now()-10*60*1000).toISOString();await serveTaskFixture(page,snapshot);await page.goto('/');const row=page.locator('.sidebar-thread-row').first();await expect(row.locator('time')).toBeVisible();await expect(row.locator('time')).toHaveAttribute('dateTime',snapshot.threads[0].updatedAt);await expect(row.getByRole('button',{name:'Source-bound task fixture Ready',exact:true})).toBeVisible();expect(await row.locator('.thread-item-state').evaluate(node=>getComputedStyle(node).position)).toBe('absolute');
});

for(const mode of ['disabled','reduced'] as const)test(`floating windows respect ${mode} motion without delaying controls`,async({page})=>{
 await watchAnimations(page);if(mode==='reduced')await page.emulateMedia({reducedMotion:'reduce'});const snapshot=fixture();if(mode==='disabled')snapshot.settings.preferences={panelAnimations:false};await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();const panel=page.getByRole('region',{name:'Task plan window',exact:true});await expect(panel).toBeVisible();
 const entries=await page.evaluate(()=>(window as unknown as {shellMotionEvents:{floatingId?:string;frames:Keyframe[]}[]}).shellMotionEvents.filter(event=>event.floatingId==='plan'));
 if(mode==='disabled')expect(entries).toHaveLength(0);else{expect(entries).toHaveLength(1);expect(entries[0].frames.every(frame=>frame.transform===undefined&&frame.filter===undefined)).toBe(true);}
 await panel.getByRole('button',{name:'Minimize Task plan',exact:true}).click();await expect(panel).toHaveAttribute('data-collapsed','true');await panel.getByRole('button',{name:'Expand Task plan',exact:true}).click();await expect(panel).toHaveAttribute('data-collapsed','false');
});

test('completed operation receipts are compact, truthful and retain full evidence on inspection',async({page})=>{
 const snapshot=fixture(),digest='a'.repeat(64);
 snapshot.operations=[{id:'finished',threadId:'task-thread',revision:4,kind:'database.migration',description:`Apply 4 statements and resource version ${digest}`,args:{statements:['alter table projects add archived integer']},resourceIds:['database-one'],preconditions:{sourceSha256:digest},status:'succeeded',approved:true,result:{rowsChanged:12,integrity:'ok'},createdAt:new Date().toISOString()}];
 await serveTaskFixture(page,snapshot);await page.goto('/');const receipt=page.getByRole('region',{name:'Operation outcome',exact:true}),summary=receipt.locator('summary').first();
 await expect(summary).toContainText('Succeeded');await expect(summary).toContainText('Apply 4 statements');await expect(receipt.locator('details').first()).not.toHaveAttribute('open','');expect((await receipt.boundingBox())!.height).toBeLessThanOrEqual(66);await expect(receipt.getByText(digest,{exact:false})).toBeHidden();
 expect(await receipt.locator('.operation-outcome-status').evaluate(node=>getComputedStyle(node).color)).toBe(await receipt.evaluate(node=>getComputedStyle(node).getPropertyValue('--success').trim()).then(async color=>page.evaluate(value=>{const node=document.createElement('span');node.style.color=value;document.body.append(node);const resolved=getComputedStyle(node).color;node.remove();return resolved;},color)));
 await summary.click();await receipt.getByText('Changes and preconditions',{exact:true}).click();await expect(receipt.locator('pre').first()).toContainText(digest);await receipt.getByText('Executor result',{exact:true}).click();await expect(receipt.locator('pre').last()).toContainText('rowsChanged');
});

test('failed and cancelled receipts do not claim success and prepared approval retains exact authority',async({page})=>{
 const snapshot=fixture(),base={threadId:'task-thread',revision:7,kind:'file.replace',description:'Replace the reviewed file.',args:{content:'reviewed'},resourceIds:['file-one'],preconditions:{'file-one':'expected-version'},createdAt:new Date().toISOString()};
 snapshot.operations=[{...base,id:'failed',status:'failed',approved:true,error:'The file changed. Review the current version.'},{...base,id:'cancelled',status:'cancelled',approved:true},{...base,id:'prepared',status:'prepared',approved:false}];
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const failed=page.locator('[data-operation-id="failed"]'),cancelled=page.locator('[data-operation-id="cancelled"]'),approval=page.getByRole('region',{name:'Operation approval',exact:true});
 await expect(failed.locator('summary').first()).toContainText('Failed');await expect(cancelled.locator('summary').first()).toContainText('Cancelled');await failed.locator('summary').first().click();await expect(failed.getByText('The file changed. Review the current version.',{exact:true})).toBeVisible();
 await expect(approval.getByText('Replace the reviewed file.',{exact:true})).toBeVisible();await expect(approval.getByRole('button',{name:'Decline operation',exact:true})).toBeVisible();await approval.getByText('Changes and preconditions',{exact:true}).click();await expect(approval.locator('pre')).toContainText('expected-version');await approval.getByRole('button',{name:'Approve operation',exact:true}).click();
 await expect.poll(()=>host.commands.find(command=>command.type==='operation.approve')?.payload).toEqual({operationId:'prepared',revision:7});expect(host.commands.find(command=>command.type==='operation.approve')?.threadId).toBe('task-thread');
});

test('shell notice enters, pauses on hover, auto-expires and exits before unmount',async({page})=>{
 test.setTimeout(60000);
 await serveTaskFixture(page,fixture());await page.goto('/');
 await page.evaluate(async({reactPath,domPath})=>{
  const r=await import(reactPath),d=await import(domPath),React=r.default??r,DOM=d.default??d;
  await import('/src/styles.css');await import('/src/shell.css');
  const entry='/src/ShellNotice.tsx';const {ShellNotice}=await import(entry);
  const root=document.createElement('div');root.setAttribute('aria-label','Shell notice fixture');document.body.append(root);
  const node=DOM.createRoot(root);
  const render=(message:string)=>node.render(React.createElement(ShellNotice,{message,onDismiss:()=>render('')}));
  render('Settings saved.');
  Object.assign(window,{noticeFixture:{render}});
 },{reactPath:'/@fs/'+resolve('node_modules/.vite/deps/react.js').replaceAll('\\','/'),domPath:'/@fs/'+resolve('node_modules/.vite/deps/react-dom_client.js').replaceAll('\\','/')});
 const notice=page.locator('[aria-label="Shell notice fixture"]').getByRole('status');
 await expect(notice).toBeVisible({timeout:15000});await expect(notice).toContainText('Settings saved.');
 expect(await notice.evaluate(node=>getComputedStyle(node).animationName)).toBe('shell-notice-in');
 await notice.hover();await page.waitForTimeout(6500);await expect(notice).toBeVisible();
 await page.mouse.move(0,0);await expect(notice).toHaveCount(0,{timeout:8000});
 await page.evaluate(()=>(window as unknown as {noticeFixture:{render(message:string):void}}).noticeFixture.render('Saved again.'));
 await expect(notice).toBeVisible();await notice.getByRole('button',{name:'Dismiss notification',exact:true}).click();
 await expect(notice).toHaveAttribute('data-leaving','true');await expect(notice).toHaveCount(0,{timeout:2000});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>(window as unknown as {noticeFixture:{render(message:string):void}}).noticeFixture.render('Quiet mode.'));
 await expect(notice).toBeVisible();expect(await notice.evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 await notice.getByRole('button',{name:'Dismiss notification',exact:true}).click();await expect(notice).toHaveCount(0,{timeout:2000});
});
