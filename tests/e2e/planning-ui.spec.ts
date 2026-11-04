import {test,expect,type Page} from '@playwright/test';
import type {HostCommand,Snapshot} from '../../packages/contracts';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId,type PlanRecord} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const now='2026-10-30T05:00:00.000Z';
const plan:PlanRecord={version:1,title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce the failing test',completed:true},{id:'locate',label:'Locate the failing assertion',completed:false}],agentIds:['agent-tests']},{id:'verify',title:'Run checkout tests',status:'pending',requirements:[{id:'suite',label:'Focused tests pass',completed:false}],agentIds:[]}],agents:[{id:'agent-tests',commandId:'batch-1',taskId:'tests',name:'Test investigator',task:'Trace the checkout assertion',stepId:'investigate',status:'working',requirements:[{id:'reproduce',label:'Reproduce the failing test'},{id:'locate',label:'Locate the failing assertion'}],completedRequirementIds:['reproduce'],reportedPercent:null,createdAt:now,updatedAt:now},{id:'agent-review',commandId:'batch-1',taskId:'review',name:'Code reviewer',task:'Inspect the proposed correction',status:'queued',requirements:[],completedRequirementIds:[],reportedPercent:null,createdAt:now,updatedAt:now}]};
function fixture(){const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Checking the checkout boundary.'}}}});snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,value:structuredClone(plan),createdAt:now});return snapshot;}
function question(snapshot:Snapshot){snapshot.requests=[{id:'decision-route',threadId:'task-thread',artifactId:null,revision:1,title:'Which repair should we explore?',prompt:'Choose a scope for the checkout repair.',responseSchema:{type:'string'},basis:[],status:'pending',presentation:{options:[{id:'focused',label:'Focused repair',description:'Keep the public API stable.'},{id:'broader',label:'Broader cleanup',description:'Include the nearby validation path.',explanation:'This includes the validation path and its shared tests.',examples:[{text:'Update the input validation and exercise both callers.'}]}],allowCustom:true}}];}
async function openPlan(page:Page){await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();const rail=page.getByRole('region',{name:'Task plan',exact:true});if(!await rail.isVisible()){await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();}await expect(rail).toBeVisible();}

test('the plan rail uses real checklist progress and keeps unknown agent progress unknown',async({page})=>{
  const snapshot=fixture(),host=await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);
  const rail=page.getByRole('region',{name:'Task plan',exact:true});await expect(rail.getByText('Repair checkout failures',{exact:true})).toBeVisible();
  await expect(rail.getByRole('progressbar',{name:'Test investigator progress',exact:true})).toHaveAttribute('aria-valuenow','50');
  await expect(rail.getByRole('progressbar',{name:'Code reviewer progress',exact:true})).not.toHaveAttribute('aria-valuenow');
  const agent=await rail.locator('[data-agent-id="agent-tests"]').elementHandle();
  const current=snapshot.data.find(data=>data.id===planDataId('task-thread'))!;const value=current.value as PlanRecord;value.agents[0].completedRequirementIds.push('locate');value.agents[0].status='needs_review';current.revision++;await host.publish();
  await expect(rail.getByRole('progressbar',{name:'Test investigator progress',exact:true})).toHaveAttribute('aria-valuenow','100');
  await expect(rail.getByText('Needs review',{exact:true})).toBeVisible();expect(await rail.locator('[data-agent-id="agent-tests"]').evaluate((node,old)=>node===old,agent)).toBe(true);
  await rail.getByRole('button',{name:'Inspect Test investigator',exact:true}).click();await expect(rail.getByText('Locate the failing assertion',{exact:true}).last()).toBeVisible();
  await page.reload();await openPlan(page);await expect(page.getByRole('progressbar',{name:'Test investigator progress',exact:true})).toHaveAttribute('aria-valuenow','100');
});

test('a plan from another thread is not presented as the current task',async({page})=>{
  const snapshot=fixture();snapshot.data[0].threadId='another-thread';await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);
  await expect(page.getByRole('region',{name:'Task plan',exact:true})).toContainText('No plan yet');await expect(page.getByText('Repair checkout failures',{exact:true})).toHaveCount(0);
});

test('planning option explanations request Pi once and retain selection through the updated question',async({page})=>{
  const snapshot=fixture();question(snapshot);const host=await serveTaskFixture(page,snapshot);const details:HostCommand[]=[];
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type!=='request.detail')return route.fallback();details.push(command);snapshot.requests[0].detailRequests=[{id:command.id,kind:'explain',optionId:'focused',status:'pending'}];return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:snapshot.requests[0]}});});
  await page.goto('/');const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});
  await request.getByRole('radio',{name:'Focused repair',exact:true}).check();await request.getByRole('button',{name:'Explain Focused repair',exact:true}).click();
  await expect(request.getByRole('button',{name:'Explain Focused repair',exact:true})).toBeDisabled();expect(details).toHaveLength(1);expect(details[0].payload).toMatchObject({requestId:'decision-route',revision:1,kind:'explain',optionId:'focused'});
  snapshot.requests[0].revision++;snapshot.requests[0].presentation!.options[0].explanation='Keep the current API and change only the quantity calculation.';snapshot.requests[0].detailRequests![0].status='resolved';await host.publish();
  await expect(request.getByText('Keep the current API and change only the quantity calculation.',{exact:true})).toBeVisible();await expect(request.getByRole('radio',{name:'Focused repair',exact:true})).toBeChecked();
  await request.getByRole('button',{name:'Continue',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='request.respond').length).toBe(1);expect(host.commands.find(command=>command.type==='request.respond')?.payload.response).toBe('focused');
});

test('existing explanations and examples open locally while More options is a durable request',async({page})=>{
  const snapshot=fixture();question(snapshot);const host=await serveTaskFixture(page,snapshot);await page.goto('/');const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});
  await request.getByRole('button',{name:'Explain Broader cleanup',exact:true}).click();await expect(request.getByText('This includes the validation path and its shared tests.',{exact:true})).toBeVisible();
  await request.getByRole('button',{name:'Examples for Broader cleanup',exact:true}).click();await expect(request.getByText('Update the input validation and exercise both callers.',{exact:true})).toBeVisible();
  expect(host.commands.filter(command=>command.type==='request.detail')).toHaveLength(0);
  await request.getByRole('button',{name:'More options',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='request.detail').length).toBe(1);expect(host.commands.find(command=>command.type==='request.detail')?.payload.kind).toBe('more-options');
});

test('custom planning responses survive reload and composition does not submit on IME Enter',async({page})=>{
  const snapshot=fixture();question(snapshot);const host=await serveTaskFixture(page,snapshot);await page.goto('/');let request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});
  await request.getByRole('button',{name:'Add my own option',exact:true}).click();await request.getByRole('textbox',{name:'Your option',exact:true}).fill('Preserve the serializer and repair its caller.');
  await request.getByRole('textbox',{name:'Your option',exact:true}).evaluate(node=>{node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  expect(host.commands.filter(command=>command.type==='request.respond')).toHaveLength(0);
  await expect.poll(async()=>page.evaluate(async()=>{const path='/src/journal.ts',journal=await import(path);return (await journal.journalRead('request:decision-route:planning'))?.response;})).toBe('Preserve the serializer and repair its caller.');
  await page.reload();request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await expect(request.getByRole('textbox',{name:'Your option',exact:true})).toHaveValue('Preserve the serializer and repair its caller.');
});

test('live usage reflects reported values and can be disabled without inventing subscription cost',async({page})=>{
  const snapshot=fixture();snapshot.usage['task-thread']={...EMPTY_USAGE,contextTokens:5000,contextWindow:100000,inputTokens:12000,outputTokens:400,activity:'running'};const host=await serveTaskFixture(page,snapshot);await page.goto('/');
  await page.getByRole('button',{name:'Show live usage',exact:true}).click();const footer=page.getByRole('region',{name:'Live usage',exact:true});await expect(footer).toContainText(/12k/i);await footer.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(footer.getByText('Unavailable',{exact:true})).toHaveCount(3);
  snapshot.usage['task-thread']={...snapshot.usage['task-thread'],outputTokens:900,cost:0.0125};await host.publish();await expect(footer).toContainText('900');await expect(footer).toContainText('$0.0125');
  snapshot.settings.preferences={...snapshot.settings.preferences,showUsageFooter:false};await host.publish();await expect(footer).toHaveCount(0);
});

test('planning views remain keyboard usable and within the narrow viewport with reduced motion',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const snapshot=fixture();question(snapshot);const host=await serveTaskFixture(page,snapshot);await page.goto('/');
  const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await expect(request.getByRole('radio',{name:'Focused repair',exact:true})).toBeEnabled();await request.getByRole('radio',{name:'Focused repair',exact:true}).focus();await expect(request.getByRole('radio',{name:'Focused repair',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await expect(request.getByRole('radio',{name:'Broader cleanup',exact:true})).toBeChecked();
  await request.getByRole('button',{name:'Examples for Broader cleanup',exact:true}).click();await expect(request.getByText('Update the input validation and exercise both callers.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  if(process.env.HARNESS_PLANNING_CAPTURE){
    const folder=process.env.HARNESS_PLANNING_CAPTURE;snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000,activity:'running'};await host.publish();
    await openPlan(page);await expect.poll(()=>page.getByRole('region',{name:'Task plan window',exact:true}).evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
    await page.screenshot({path:`${folder}/narrow.png`});
    await page.setViewportSize({width:1920,height:1080});snapshot.settings.theme='light';await host.publish();await openPlan(page);await page.getByRole('button',{name:'Inspect Test investigator',exact:true}).click();await expect(page.getByText('1 of 2 requirements complete',{exact:true})).toBeVisible();await expect(page.locator('.plan-agent-details').first()).toHaveAttribute('data-motion-phase','open');await page.getByRole('button',{name:'Show live usage',exact:true}).click();await page.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect.poll(()=>page.getByRole('region',{name:'Live usage',exact:true}).evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);await page.screenshot({path:`${folder}/desktop-light.png`});
    snapshot.settings.theme='dark';await host.publish();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:`${folder}/desktop-dark.png`});
  }
});

test('planning examples load only images granted to the owning thread and clear them on revocation',async({page})=>{
  const snapshot=fixture();question(snapshot);snapshot.resources=[{id:'allowed-image',threadId:'task-thread',kind:'attachment',path:'C:/fixture/example.png',label:'Example',writable:false,createdAt:now},{id:'other-image',threadId:'another-thread',kind:'attachment',path:'C:/fixture/private.png',label:'Other',writable:false,createdAt:now}];
  snapshot.requests[0].presentation!.options[1].examples=[{resourceId:'allowed-image',alt:'Focused checkout form'},{resourceId:'other-image',alt:'Unavailable example'}];
  const host=await serveTaskFixture(page,snapshot);const imageRequests:string[]=[];await page.route('**/api/resources/*/content',route=>{imageRequests.push(new URL(route.request().url()).pathname);return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1e8AAAAASUVORK5CYII=','base64')});});
  await page.goto('/');const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await request.getByRole('button',{name:'Examples for Broader cleanup',exact:true}).click();await expect(request.getByRole('img',{name:'Focused checkout form',exact:true})).toBeVisible();
  await expect(request.getByText('This example image is not available to this thread.',{exact:true})).toHaveCount(1);expect(imageRequests).toEqual(['/api/resources/allowed-image/content']);
  snapshot.resources=[];await host.publish();await expect(request.locator('.planning-example img')).toHaveCount(0);await expect(request.getByText('This example image is not available to this thread.',{exact:true})).toHaveCount(2);
});

test('failed planning detail requests show a recoverable error without losing the choice',async({page})=>{
  const snapshot=fixture();question(snapshot);await serveTaskFixture(page,snapshot);let attempts=0;
  await page.route('**/api/commands',route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type!=='request.detail')return route.fallback();attempts++;return attempts===1?route.fulfill({status:409,json:{error:{code:'STALE_REQUEST',message:'The question changed. Review its latest options.'}}}):route.fulfill({json:{commandId:command.id,eventSeq:1,result:{}}});});
  await page.goto('/');const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await request.getByRole('radio',{name:'Focused repair',exact:true}).check();await request.getByRole('button',{name:'Explain Focused repair',exact:true}).click();await expect(request.getByRole('alert')).toContainText('The question changed. Review its latest options.');await expect(request.getByRole('radio',{name:'Focused repair',exact:true})).toBeChecked();await expect(request.getByRole('button',{name:'Explain Focused repair',exact:true})).toBeEnabled();await request.getByRole('button',{name:'Explain Focused repair',exact:true}).click();await expect.poll(()=>attempts).toBe(2);
});

test('live usage details dismiss with Escape and restore their trigger focus',async({page})=>{
  await serveTaskFixture(page,fixture());await page.goto('/');await page.getByRole('button',{name:'Show live usage',exact:true}).click();const footer=page.getByRole('region',{name:'Live usage',exact:true}),trigger=footer.getByRole('button',{name:'Inspect live usage',exact:true});await trigger.click();await expect(footer.getByRole('region',{name:'Runtime usage details',exact:true})).toBeVisible();await footer.getByRole('button',{name:'Close live usage details',exact:true}).focus();await page.keyboard.press('Escape');await expect(footer.getByRole('region',{name:'Runtime usage details',exact:true})).toHaveCount(0);await expect(trigger).toBeFocused();
});

test('live usage remains visible and clickable above the open workspace panel',async({page})=>{
  const snapshot=fixture();snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12000,outputTokens:400};await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);await page.getByRole('button',{name:'Show live usage',exact:true}).click();
  const trigger=page.getByRole('button',{name:'Inspect live usage',exact:true});
  expect(await trigger.evaluate(button=>{const box=button.getBoundingClientRect();return button.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));})).toBe(true);
  await trigger.click();await expect(page.getByRole('region',{name:'Runtime usage details',exact:true})).toBeVisible();
});

test('a settled unanswered planning detail becomes retryable without clearing the decision draft',async({page})=>{
  const snapshot=fixture();question(snapshot);const host=await serveTaskFixture(page,snapshot),details:HostCommand[]=[];
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type!=='request.detail')return route.fallback();details.push(command);snapshot.requests[0].detailRequests=[{id:'pending-detail-input',kind:'explain',optionId:'focused',status:'pending'}];return route.fulfill({json:{commandId:command.id,eventSeq:++snapshot.seq,result:snapshot.requests[0]}});});
  await page.goto('/');const request=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await request.getByRole('radio',{name:'Focused repair',exact:true}).check();await request.getByRole('button',{name:'Explain Focused repair',exact:true}).click();await expect(request.getByRole('status')).toContainText('Preparing an explanation');await expect(request.getByRole('button',{name:'Explain Focused repair',exact:true})).toBeDisabled();
  snapshot.requests[0].revision++;snapshot.requests[0].detailRequests![0]={...snapshot.requests[0].detailRequests![0],status:'failed',error:'The agent finished without an explanation. Request it again.'};await host.publish();
  await expect(request.getByRole('alert')).toContainText('The agent finished without an explanation. Request it again.');await expect(request.getByRole('button',{name:'Explain Focused repair',exact:true})).toBeEnabled();await expect(request.getByRole('radio',{name:'Focused repair',exact:true})).toBeChecked();await expect(request.getByRole('status')).toHaveCount(0);
  await request.getByRole('button',{name:'Explain Focused repair',exact:true}).click();await expect.poll(()=>details.length).toBe(2);expect(details[1].payload).toMatchObject({requestId:'decision-route',revision:2,kind:'explain',optionId:'focused'});await expect(request.getByRole('button',{name:'Explain Focused repair',exact:true})).toBeDisabled();
});
