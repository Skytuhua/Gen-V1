import {test,expect,type Page} from '@playwright/test';
import type {HostCommand,Snapshot} from '../../packages/contracts';
import type {SkillDetail,SkillProposal,SkillSummary} from '../../packages/contracts/skills';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const now='2026-11-01T12:00:00.000Z';
const summary=(revision=1):SkillSummary=>({name:'verify-release',description:'Verify a release using its actual receipts.',category:'development',revision,state:'active',enabled:true,protected:false,origin:'agent',managed:true,author:'agent',createdAt:now,updatedAt:now,lastUsedAt:now,useCount:2,patchCount:0});
const detail=(revision=1):SkillDetail=>({skill:summary(revision),content:revision===1?'Read the receipt. Run the focused checks.':'Read the receipt. Run the focused checks before packaging.',files:['references/checks.md'],versions:[{revision:1,at:now,actor:{kind:'agent'},action:'create'},...(revision>1?[{revision,at:now,actor:{kind:'agent' as const},action:'patch'}]:[])],nextVersionOffset:null});
type SkillSnapshot=Snapshot&{skills:SkillSummary[];skillProposals:SkillProposal[]};
async function fixture(page:Page,options:{empty?:boolean;stale?:boolean;proposal?:boolean}={}){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic skill management fixture.'}}}}) as SkillSnapshot;
 snapshot.skills=options.empty?[]:[summary()];snapshot.skillProposals=options.proposal?[{id:'proposal-1',createdAt:now,status:'pending',actor:{kind:'agent',threadId:'task-thread'},targets:['verify-release'],operations:[{action:'patch',name:'verify-release',baseRevision:1,oldText:'focused checks',newText:'focused checks before packaging'}]}]:[];snapshot.learning={supported:true,status:'idle',lastReview:null};
 const host=await serveTaskFixture(page,snapshot);let saved=detail(),stale=options.stale??false,reads=0;
 await page.route('**/api/skills/**',async route=>{const url=new URL(route.request().url());reads++;if(decodeURIComponent(url.pathname.split('/').pop()??'')!=='verify-release')return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Skill not found.'}}});if(url.searchParams.get('path'))return route.fulfill({json:{...saved,content:'Use the receipt hash as the source of truth.'}});if(url.searchParams.get('revision')==='1')return route.fulfill({json:detail()});return route.fulfill({json:saved});});
 await page.route('**/api/skill-proposals/proposal-1',route=>route.fulfill({json:snapshot.skillProposals[0]}));
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON() as HostCommand;host.commands.push(command);const p=command.payload;
  if(command.type==='settings.update'){snapshot.settings={...snapshot.settings,preferences:{...snapshot.settings.preferences,...p.preferences as object}};}
  if(command.type==='skill.flags'){saved={...saved,skill:{...saved.skill,...p,revision:saved.skill.revision+1}} as SkillDetail;snapshot.skills=[saved.skill];}
  if(command.type==='skill.manage'){
   const operation=(p.operations as {action:string;baseRevision:number;content?:string;description?:string;revision?:number}[])[0];
   if(stale&&operation.action==='patch'){stale=false;saved=detail(2);snapshot.skills=[saved.skill];return route.fulfill({status:409,json:{error:{code:'STALE_SKILL',message:'This skill changed. Your draft is retained.'}}});}
   if(operation.baseRevision!==saved.skill.revision)return route.fulfill({status:409,json:{error:{code:'STALE_SKILL',message:'This skill changed. Review the saved version.'}}});
   saved={...saved,skill:{...saved.skill,revision:saved.skill.revision+1,...(operation.description?{description:operation.description}:{}),...(operation.action==='delete'?{state:'archived' as const}:operation.action==='restore'?{state:'active' as const}:{} )},...(operation.content?{content:operation.content}:{}),...(operation.action==='rollback'?{content:detail().content}:{})};snapshot.skills=[saved.skill];
  }
  if(command.type==='skill.decide'){snapshot.skillProposals=[];if(p.approve){saved=detail(2);snapshot.skills=[saved.skill];}}
  snapshot.seq++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:{status:'applied',changes:[saved.skill]}}});
 });
 const open=async()=>{await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();const navigation=page.getByRole('button',{name:'Open navigation',exact:true});if(await navigation.isVisible())await navigation.click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Skills & learning',exact:true}).click();};
 return{snapshot,host,open,get reads(){return reads;}};
}

test('empty libraries and automatic review controls work with old snapshots',async({page})=>{
 const x=await fixture(page,{empty:true});delete (x.snapshot as Snapshot).skills;delete (x.snapshot as Snapshot).skillProposals;delete (x.snapshot as Snapshot).learning;await x.open();await expect(page.getByRole('heading',{name:'Skills & learning',exact:true})).toBeVisible();await expect(page.getByText('No saved skills yet.',{exact:true})).toBeVisible();expect(x.reads).toBe(0);
 await page.getByRole('switch',{name:'Automatic learning reviews',exact:true}).click();await expect.poll(()=>x.snapshot.settings.preferences).toMatchObject({learningEnabled:false});
 await page.getByRole('switch',{name:'Require approval for agent writes',exact:true}).click();await expect.poll(()=>x.snapshot.settings.preferences).toMatchObject({learningApproval:true});
 await page.getByRole('spinbutton',{name:'Review after model iterations',exact:true}).fill('20');await expect.poll(()=>x.snapshot.settings.preferences).toMatchObject({learningInterval:20});
 await page.getByRole('switch',{name:'Idle curation',exact:true}).click();await expect.poll(()=>x.snapshot.settings.preferences).toMatchObject({skillCurator:false});
 await expect(page.getByText('Uses the task’s selected model and subscription quota.',{exact:true})).toBeVisible();
});

test('pending legacy migration keeps saved instructions and supporting files readable',async({page})=>{
 const x=await fixture(page);x.snapshot.skills[0].migrationError='This legacy skill needs migration before activation.';await x.open();
 await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();
 await expect(page.getByText(/Saved instructions, supporting files, history and drafts remain available to read/)).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Instructions for verify-release',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Save skill',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'View references/checks.md',exact:true}).click();
 await expect(page.getByText('Use the receipt hash as the source of truth.',{exact:true})).toBeVisible();
});
test('inspect, edit, supporting files, flags and recoverable archive use current revisions',async({page})=>{
 const x=await fixture(page);await x.open();expect(x.reads).toBe(0);await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();await expect(page.getByRole('textbox',{name:'Instructions for verify-release',exact:true})).toHaveValue(detail().content);expect(x.reads).toBe(1);
 await page.getByRole('button',{name:'View references/checks.md',exact:true}).click();await expect(page.getByText('Use the receipt hash as the source of truth.',{exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Instructions for verify-release',exact:true}).fill('Read the exact receipt, then run its checks.');await page.getByRole('button',{name:'Save skill',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].revision).toBe(2);
 await page.getByRole('button',{name:'Disable verify-release',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].enabled).toBe(false);await page.getByRole('button',{name:'Protect verify-release',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].protected).toBe(true);
 await page.getByRole('button',{name:'Archive verify-release',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].state).toBe('archived');await page.getByRole('button',{name:'Restore verify-release',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].state).toBe('active');
});
test('a conflicting skill edit survives refresh and reload until the user chooses a saved version',async({page})=>{
 const x=await fixture(page,{stale:true});await x.open();await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();const input=page.getByRole('textbox',{name:'Instructions for verify-release',exact:true});await input.fill('Keep my local review of the procedure.');await page.getByRole('button',{name:'Save skill',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Your draft is retained');await expect(input).toHaveValue('Keep my local review of the procedure.');
 await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Skills & learning',exact:true}).click();await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();await expect(input).toHaveValue('Keep my local review of the procedure.');
 await page.getByRole('button',{name:'Review saved version',exact:true}).click();await expect(page.getByText(detail(2).content,{exact:true})).toBeVisible();await expect(input).toHaveValue('Keep my local review of the procedure.');await page.getByRole('button',{name:'Use saved version',exact:true}).click();await expect(input).toHaveValue(detail(2).content);
});
test('pending changes show the proposed text and require an explicit approval or rejection',async({page})=>{
 const x=await fixture(page,{proposal:true});await x.open();await page.getByRole('button',{name:'Review proposed changes to verify-release',exact:true}).click();await expect(page.getByText('focused checks',{exact:true})).toBeVisible();await expect(page.getByText('focused checks before packaging',{exact:true})).toBeVisible();
 expect(x.host.commands.some(command=>command.type==='skill.decide')).toBe(false);await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect.poll(()=>x.snapshot.skillProposals).toEqual([]);expect(x.host.commands.find(command=>command.type==='skill.decide')?.payload).toEqual({proposalId:'proposal-1',approve:true});
});
test('version history restores a prior version through a new current revision',async({page})=>{
 const x=await fixture(page);await x.open();await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();await page.getByText('Revision history',{exact:true}).click();await page.getByRole('button',{name:'View revision 1',exact:true}).click();await expect(page.getByLabel('Historical skill version',{exact:true}).getByText(detail().content,{exact:true})).toBeVisible();await page.getByRole('button',{name:'Restore this revision',exact:true}).click();await expect.poll(()=>x.snapshot.skills[0].revision).toBe(2);expect(x.host.commands.find(command=>command.type==='skill.manage')?.payload).toEqual({operations:[{action:'rollback',name:'verify-release',baseRevision:1,revision:1}]});
});
test('a proposal can create a skill and its supporting file before the skill exists',async({page})=>{
 const x=await fixture(page,{empty:true,proposal:true});x.snapshot.skillProposals[0]={...x.snapshot.skillProposals[0],targets:['new-workflow'],operations:[{action:'create',name:'new-workflow',baseRevision:0,description:'A reusable workflow.',content:'Follow the verified procedure.'},{action:'write_file',name:'new-workflow',baseRevision:1,path:'references/checks.md',content:'Check the completed receipt.'}]};await x.open();await page.getByRole('button',{name:'Review proposed changes to new-workflow',exact:true}).click();await expect(page.getByText('Follow the verified procedure.',{exact:true})).toBeVisible();await expect(page.getByText('Check the completed receipt.',{exact:true})).toBeVisible();expect(x.reads).toBe(0);await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect.poll(()=>x.snapshot.skillProposals).toEqual([]);
});
test('rejecting a proposed change preserves the active skill',async({page})=>{
 const x=await fixture(page,{proposal:true});await x.open();await page.getByRole('button',{name:'Review proposed changes to verify-release',exact:true}).click();await page.getByRole('button',{name:'Reject changes',exact:true}).click();await expect.poll(()=>x.snapshot.skillProposals).toEqual([]);expect(x.snapshot.skills[0].revision).toBe(1);expect(x.host.commands.find(command=>command.type==='skill.decide')?.payload).toEqual({proposalId:'proposal-1',approve:false});
});
test('unconfirmed learning cleanup stays visibly blocked and allows an explicit stop retry',async({page})=>{
 const x=await fixture(page,{empty:true});x.snapshot.learning={supported:true,status:'blocked',lastReview:{sourceThreadId:'task-thread',sourceRunId:'review-1',modelId:'fixture-model',accountId:null,status:'failed',startedAt:now,toolCalls:0,inputBytes:0,appliedChanges:0,cleanupConfirmed:false,error:'Learning review could not stop. Runtime cleanup is unconfirmed.'}};
 await x.open();await expect(page.getByRole('alert')).toContainText('Runtime cleanup is unconfirmed.');await expect(page.getByText('Learning review is blocked.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Stop learning review',exact:true}).click();await expect.poll(()=>x.host.commands.some(command=>command.type==='learning.cancel')).toBe(true);
});
test('skill controls and editors fit desktop and narrow light and dark views',async({page},info)=>{
 const x=await fixture(page);for(const width of [1440,390])for(const theme of ['dark','light'] as const){
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});x.snapshot.settings.theme=theme;await x.open();
  await expect.poll(()=>page.locator('.settings-dialog').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(theme==='dark'?'rgb(15, 15, 15)':'rgb(255, 255, 255)');
  const selectedSection=page.getByRole('button',{name:'Skills & learning',exact:true});await expect.poll(async()=>{const selected=await selectedSection.boundingBox(),nav=await page.getByRole('navigation',{name:'Settings sections',exact:true}).boundingBox();return Boolean(selected&&nav&&selected.x>=nav.x-1&&selected.x+selected.width<=nav.x+nav.width+1);}).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`skills-${width}-${theme}-controls.png`)});
  await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();const editor=page.getByRole('textbox',{name:'Instructions for verify-release',exact:true});await expect(editor).toHaveValue(detail().content);await editor.scrollIntoViewIfNeeded();const box=await editor.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);if(width===390)expect(box!.width).toBeGreaterThanOrEqual(250);await page.screenshot({path:info.outputPath(`skills-${width}-${theme}-editor.png`)});
 }
});
