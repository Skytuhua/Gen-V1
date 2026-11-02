import {test,expect} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';

const source='# Delivery handoff\n\nPlease review the agreement and keep the original alongside it.';
test('an expanded artifact keeps its handoff editor interactive and owns Escape separately',async({page})=>{
 const host=await open(page);host.snapshot.artifacts[0].placement='expanded';await host.publish();await expect(page.locator('.artifact')).toHaveAttribute('aria-modal','true');await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.locator('.document-text-editor');await expect(editor).toBeVisible();expect(await editor.evaluate(node=>Boolean(node.closest('[inert]')))).toBe(false);await editor.fill('An expanded handoff draft.');await expect(editor).toBeFocused();await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:'An expanded handoff draft.'});await editor.press('Escape');await expect(editor).toHaveCount(0);await expect(page.getByRole('button',{name:'Collapse artifact',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open handoff',exact:true})).toBeFocused();
});
async function open(page:import('@playwright/test').Page){
 const snapshot=taskFixture({root:'doc',elements:{doc:{type:'Document',props:{title:'Delivery handoff',dataBinding:'handoff',presentation:'window',editableStateKey:'handoffDraft',linkLabel:'Open handoff'}}}},{handoff:source});
 snapshot.settings.theme='dark';
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.getByRole('button',{name:'Open handoff',exact:true})).toBeVisible();return host;
}
test('opens actual editable text, docks beside chat and retains the draft after floating and reload',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const host=await open(page);
 const before=await page.locator('.workspace').boundingBox();await page.getByRole('button',{name:'Open handoff',exact:true}).click();
 const window=page.getByRole('region',{name:'Delivery handoff document window',exact:true});await expect(window).toBeVisible();
 const editor=window.getByRole('textbox',{name:'Document text',exact:true});await expect(editor).toHaveValue(source);
 await expect.poll(async()=> (await page.locator('.workspace').boundingBox())!.width).toBeLessThan(before!.width-250);
 await editor.fill(source+'\n\nDeliver to the design team.');
 await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:source+'\n\nDeliver to the design team.'});
 const handle=window.getByRole('button',{name:'Move Delivery handoff',exact:true}),box=await handle.boundingBox();await page.mouse.move(box!.x+70,box!.y+12);await page.mouse.down();await page.mouse.move(box!.x-120,box!.y+80,{steps:8});await page.mouse.up();
 await expect(window).toHaveAttribute('data-placement','floating');await expect.poll(async()=> (await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(before!.width,0);
 await expect(editor).toHaveValue(source+'\n\nDeliver to the design team.');await page.reload();await page.getByRole('button',{name:'Open handoff',exact:true}).click();await expect(page.getByRole('textbox',{name:'Document text',exact:true})).toHaveValue(source+'\n\nDeliver to the design team.');
 expect(host.commands.some(command=>command.type==='action.submit'||command.type==='operation.approve')).toBe(false);
});
test('new source never overwrites edited text and the document can explicitly adopt the update',async({page})=>{
 const host=await open(page);await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});await editor.fill('My retained draft');
 await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:'My retained draft'});host.setInput('handoff','A newer prepared handoff.');await host.publish();await expect(editor).toHaveValue('My retained draft');await expect(page.getByText('New source available',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Use updated source',exact:true}).click();await expect(editor).toHaveValue('A newer prepared handoff.');
});

test('granted text clears immediately on revocation and retry rereads the authorized source',async({page})=>{
 const snapshot=taskFixture({root:'doc',elements:{doc:{type:'Document',props:{title:'Granted handoff',resourceId:'handoff-file',presentation:'window',editableStateKey:'draft',linkLabel:'Open handoff'}}}});
 const grant={id:'handoff-file',threadId:'task-thread',kind:'attachment' as const,path:'C:/fixture/handoff.md',label:'handoff.md',writable:false,createdAt:'2026-11-01T00:00:00Z'};snapshot.resources=[grant];
 const host=await serveTaskFixture(page,snapshot);let denied=true,reads=0;
 await page.route('**/api/resources/handoff-file/content',route=>{reads++;return route.fulfill(denied?{status:403}:{contentType:'text/markdown',body:'Authorized handoff content.'});});
 await page.goto('/');await page.getByRole('button',{name:'Open handoff',exact:true}).click();await expect(page.getByRole('alert')).toContainText('403');denied=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Document text',exact:true})).toHaveValue('Authorized handoff content.');expect(reads).toBe(2);
 snapshot.resources=[];await host.publish();await expect(page.getByRole('textbox',{name:'Document text',exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('no longer available');
});

test('narrow document window has no page overflow and keyboard undocking retains its editor',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page);await page.getByRole('button',{name:'Open handoff',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'Document text',exact:true});await editor.fill('A narrow draft');await page.getByRole('button',{name:'Move Delivery handoff',exact:true}).focus();await page.keyboard.press('ArrowLeft');
 await expect(page.getByRole('region',{name:'Delivery handoff document window',exact:true})).toHaveAttribute('data-placement','floating');await expect(editor).toHaveValue('A narrow draft');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);await expect(page.getByRole('button',{name:'Open handoff',exact:true})).toBeFocused();
});

test('large edited source fits the real host state limit without duplicating the source text',async({page})=>{
 const host=await open(page);host.setInput('handoff','A'.repeat(70_000));await host.publish();await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});await expect(editor).toHaveValue('A'.repeat(70_000));await editor.fill('A'.repeat(70_000)+'!');
 await expect.poll(()=>host.commands.filter(command=>command.type==='state.save').length).toBeGreaterThan(0);const saved=host.commands.filter(command=>command.type==='state.save').at(-1)!;expect(JSON.stringify(saved.payload.values).length).toBeLessThanOrEqual(131072);
});

test('closing and reloading the handoff preserves its reading position',async({page})=>{
 const host=await open(page);host.setInput('handoff',Array.from({length:150},(_,index)=>`Handoff paragraph ${index}.`).join('\n\n'));await host.publish();await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});await editor.evaluate(node=>{node.scrollTop=500;node.dispatchEvent(new Event('scroll',{bubbles:true}));});
 await page.getByRole('button',{name:'Close document',exact:true}).click();await page.getByRole('button',{name:'Open handoff',exact:true}).click();await expect.poll(()=>editor.evaluate(node=>node.scrollTop)).toBe(500);await page.reload();await page.getByRole('button',{name:'Open handoff',exact:true}).click();await expect.poll(()=>editor.evaluate(node=>node.scrollTop)).toBe(500);
});

test('oversized UTF-8 edits are rejected without replacing the last durable draft',async({page})=>{
 const host=await open(page);await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});await editor.fill('A retained draft');await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:'A retained draft'});
 await editor.fill('漢'.repeat(100_000));await expect(page.getByRole('alert')).toContainText('editable preview limit');await expect(editor).toHaveValue('A retained draft');expect((host.snapshot.userStates[0].values.handoffDraft as {text:string}).text).toBe('A retained draft');
});

test('retargeting a document cannot overwrite a draft belonging to its previous source',async({page})=>{
 const host=await open(page);await page.getByRole('button',{name:'Open handoff',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});await editor.fill('Keep my original edits');await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:'Keep my original edits'});await expect(page.locator('.save-state')).toHaveAttribute('data-save-state','saved');
 host.snapshot.data.push({...host.snapshot.data[0],id:'input-other',value:'A different document.'});host.snapshot.artifacts[0].bindings.other={mode:'live',id:'input-other'};host.snapshot.artifacts[0].spec!.elements.doc.props.dataBinding='other';host.snapshot.artifacts[0].revision++;await host.publish();
 await expect(editor).toHaveValue('A different document.');await expect(editor).toHaveAttribute('readonly','');await expect(page.getByText('A draft for another source is retained. Reopen that document to edit it.',{exact:true})).toBeVisible();expect((host.snapshot.userStates[0].values.handoffDraft as {text:string}).text).toBe('Keep my original edits');
 host.snapshot.artifacts[0].spec!.elements.doc.props.dataBinding='handoff';host.snapshot.artifacts[0].revision++;await host.publish();await expect(editor).toHaveValue('Keep my original edits');await expect(editor).toBeEditable();
});

for(const width of [1920,1440,1280,390])test(`Plan and a docked handoff remain reachable together at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const host=await open(page);host.snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-01T00:00:00Z',value:{version:1,title:'Prepare the handoff',steps:[{id:'review',title:'Review the agreement',status:'working',requirements:[]},{id:'deliver',title:'Prepare the download',status:'pending',requirements:[]}],agents:[]}});await host.publish();
 const plan=page.getByRole('region',{name:'Task plan window',exact:true});await expect(plan).toBeVisible();await page.getByRole('button',{name:'Open handoff',exact:true}).click();const doc=page.getByRole('region',{name:'Delivery handoff document window',exact:true});await expect(doc).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 if(width>=1800){await expect.poll(async()=>{const p=await plan.boundingBox(),d=await doc.boundingBox();return p!.x+p!.width-d!.x;}).toBeLessThan(0);await expect.poll(async()=>{const workspace=await page.locator('.workspace').boundingBox(),p=await plan.boundingBox();return workspace!.x+workspace!.width-p!.x;}).toBeLessThan(0);}
 if(width===1280||width===1440){const p=await plan.boundingBox(),d=await doc.boundingBox();expect(p!.x+p!.width).toBeLessThan(d!.x);}
 if(process.env.CLEAR_WINDOWS_CAPTURE){await page.waitForTimeout(320);await page.screenshot({path:`docs/evidence/clearer-windows-20261101/combined-${width}.png`});}
 await doc.getByRole('button',{name:'Close document',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
});
