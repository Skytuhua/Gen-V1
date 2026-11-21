import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {shellInit,shellRoute,shellSnapshot} from '../../scripts/capture-ui/shell-api';
import {serveTaskSplitLayout} from './task-interface-fixture';
import type {HostCommand,Snapshot} from '../../packages/contracts';

// Integration gate for edit-last-prompt-and-rerun (#1532 T05). Real App against
// a stubbed /api: edit -> rerun -> earlier-versions disclosure, rejection
// paths, keyboard, theme/width/motion evidence. Synthetic fixture data only.
const PROMPT='Review the workspace audit and list the risks.';
const REPLY='I reviewed the workspace and found two synthetic risks.';
const EDITED_PROMPT='Review the workspace audit and list the risks, ordered by severity.';
const EDITED_REPLY='Replacement reply recorded by the fixture.';
const stamp='2026-11-06T12:00:00.000Z';
const scopeKey='a'.repeat(64),revisionHash='b'.repeat(64);
const context={authority:'personal',owner:{threadId:'one',title:'Audit the workspace',projectId:null,projectName:null,epoch:0,runId:null,status:'ready',modelId:'test/model'},scopeKey,revision:revisionHash,sequence:10,checkpoint:'checkpoint-10',readOnly:false,archived:false,includeArchived:false,researchEligible:true};

interface Turn{revision:number;versions:{version:number;messageId:string;inputId:string;status:'active'|'superseded';createdAt:string;content:string;reply:string|null}[]}
interface EditState{snapshot:Snapshot;commands:HostCommand[];fail:'none'|'once'|'always';turn:Turn}

function seed(running=false):EditState{
 const snapshot=shellSnapshot();
 snapshot.messages=[
  {id:'m-user',threadId:'one',role:'user',content:PROMPT,createdAt:stamp,runId:null},
  {id:'m-reply',threadId:'one',role:'assistant',content:REPLY,createdAt:stamp,runId:null},
 ];
 if(running){snapshot.threads[0].runId='run-1';snapshot.threads[0].status='working';}
 return {snapshot,commands:[],fail:'none',turn:{revision:0,versions:[{version:1,messageId:'m-user',inputId:'in-1',status:'active',createdAt:stamp,content:PROMPT,reply:REPLY}]}};
}

function turnsEnvelope(state:EditState){return {authority:'personal',threadId:'one',scopeKey,sequence:context.sequence,turns:[{turnId:'turn-1',originalMessageId:'m-user',revision:state.turn.revision,versions:state.turn.versions}]};}

async function route(page:Page,state:EditState){
 const api=async(r:Route)=>{
  const url=new URL(r.request().url()),path=url.pathname;
  if(path==='/api/commands'){
   const command=r.request().postDataJSON() as HostCommand;state.commands.push(command);
   if(command.type==='message.editRerun'){
    const payload=command.payload as {messageId:string;expectedRevision:number;content:string};
    if(state.fail==='always')return r.fulfill({status:403,json:{error:{code:'EDIT_UNAVAILABLE',message:'This turn cannot be edited right now.'}}});
    if(state.fail==='once'){state.fail='none';return r.fulfill({status:409,json:{error:{code:'STALE_REVISION',message:'The prompt changed before this edit. Retry to apply your text.'}}});}
    if(payload.expectedRevision!==state.turn.revision)return r.fulfill({status:409,json:{error:{code:'STALE_REVISION',message:'The prompt changed before this edit. Retry to apply your text.'}}});
    const next=state.turn.revision+2,messageId=`m-user-v${next}`,inputId=`in-${next}`;
    for(const version of state.turn.versions)version.status='superseded';
    state.turn.versions.push({version:next,messageId,inputId,status:'active',createdAt:stamp,content:payload.content,reply:EDITED_REPLY});
    state.turn.revision++;
    state.snapshot.messages=[
     {id:messageId,threadId:'one',role:'user',content:payload.content,createdAt:stamp,runId:null,turnId:'turn-1'},
     {id:`m-reply-v${next}`,threadId:'one',role:'assistant',content:EDITED_REPLY,createdAt:stamp,runId:null},
    ];
    state.snapshot.seq++;
    return r.fulfill({json:{commandId:command.id,eventSeq:state.snapshot.seq,result:{turnId:'turn-1',versionId:`v${next}`,messageId,inputId}}});
   }
   return r.fulfill({json:{commandId:command.id,eventSeq:++state.snapshot.seq,result:{}}});
  }
  if(path==='/api/conversations/one')return r.fulfill({json:context});
  if(path==='/api/conversations/one/turns')return r.fulfill({json:turnsEnvelope(state)});
  return shellRoute(r,state.snapshot,false);
 };
 await page.addInitScript(shellInit);
 await page.route('**/api/**',api);
 await serveTaskSplitLayout(page,state.snapshot);
 await page.goto('/fixture');
 await page.locator('.composer textarea').waitFor();
}

const editButton=(page:Page)=>page.getByRole('button',{name:'Edit prompt and rerun'});
const rerunButton=(page:Page)=>page.getByRole('button',{name:'Rerun',exact:true});
const editedToggle=(page:Page)=>page.getByRole('button',{name:/Edited · Earlier versions/});

test('edit, rerun and disclosure keep the transcript anchor and expose earlier versions',async({page})=>{
 const state=seed();await route(page,state);
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await expect(area).toBeFocused();await expect(area).toHaveValue(PROMPT);
 await expect(page.getByText('Files are not reverted.',{exact:true})).toBeVisible();
 await area.fill(EDITED_PROMPT);
 await rerunButton(page).click();
 const edits=state.commands.filter(command=>command.type==='message.editRerun');
 expect(edits).toHaveLength(1);
 expect(edits[0].payload).toMatchObject({messageId:'m-user',expectedRevision:0,content:EDITED_PROMPT});
 await expect(page.locator('.message-user')).toContainText(EDITED_PROMPT);
 await expect(page.locator('.message-assistant')).toContainText(EDITED_REPLY);
 await expect(page.locator('.message-content').getByText(PROMPT,{exact:true})).toHaveCount(0);
 await editedToggle(page).click();
 const region=page.getByRole('region',{name:'Earlier prompt versions'});
 await expect(region.getByText('v1',{exact:true})).toBeVisible();
 await expect(region).toContainText(PROMPT);
 await region.getByText('Earlier reply').click();
 await expect(region).toContainText(REPLY);
 await expect(region.getByRole('button',{name:'Copy earlier prompt'})).toBeVisible();
});

test('a stale revision keeps the typed edit; one retry applies it',async({page})=>{
 const state=seed();state.fail='once';await route(page,state);
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await area.fill(EDITED_PROMPT);
 await rerunButton(page).click();
 await expect(page.getByRole('alert')).toContainText('The prompt changed before this edit');
 await expect(area).toHaveValue(EDITED_PROMPT);
 await rerunButton(page).click();
 expect(state.commands.filter(command=>command.type==='message.editRerun')).toHaveLength(2);
 await editedToggle(page).click();
 await expect(page.getByRole('region',{name:'Earlier prompt versions'})).toContainText(PROMPT);
});

test('an unavailable edit keeps the typed replacement inline',async({page})=>{
 const state=seed();state.fail='always';await route(page,state);
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await area.fill(EDITED_PROMPT);
 await rerunButton(page).click();
 await expect(page.getByRole('alert')).toContainText('This turn cannot be edited right now.');
 await expect(area).toHaveValue(EDITED_PROMPT);
 await expect(editedToggle(page)).toHaveCount(0);
});

test('cancel and Escape send nothing and leave the composer draft untouched',async({page})=>{
 const state=seed();await route(page,state);
 const draft=page.locator('.composer textarea');await draft.fill('Unsent draft kept.');
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');await area.fill(EDITED_PROMPT);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(area).toHaveCount(0);
 await editButton(page).click();await area.press('Escape');
 await expect(area).toHaveCount(0);
 expect(state.commands.filter(command=>command.type==='message.editRerun')).toHaveLength(0);
 await expect(draft).toHaveValue('Unsent draft kept.');
});

test('Ctrl+Enter submits once while plain Enter inserts a newline',async({page})=>{
 const state=seed();await route(page,state);
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await area.press('Enter');
 await expect(area).toBeVisible();
 await expect(area).not.toHaveValue(PROMPT);
 expect(state.commands.filter(command=>command.type==='message.editRerun')).toHaveLength(0);
 await area.fill(EDITED_PROMPT);
 await area.press('Control+Enter');
 await expect(editedToggle(page)).toBeVisible();
 expect(state.commands.filter(command=>command.type==='message.editRerun')).toHaveLength(1);
});

test('unchanged or blank replacements stay client-side',async({page})=>{
 const state=seed();await route(page,state);
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await rerunButton(page).click();
 await expect(page.getByRole('alert')).toContainText('Enter a changed prompt');
 await area.fill('   ');
 await rerunButton(page).click();
 await expect(page.getByRole('alert')).toContainText('Enter a changed prompt');
 expect(state.commands.filter(command=>command.type==='message.editRerun')).toHaveLength(0);
});

test('the control is offered only on the newest user prompt of an idle main thread',async({page})=>{
 const state=seed();
 state.snapshot.messages=[
  {id:'m-user-old',threadId:'one',role:'user',content:'Earlier synthetic prompt.',createdAt:stamp,runId:null},
  {id:'m-reply-old',threadId:'one',role:'assistant',content:'Earlier synthetic reply.',createdAt:stamp,runId:null},
  ...state.snapshot.messages,
 ];
 await route(page,state);
 await expect(editButton(page)).toHaveCount(1);
 await expect(page.locator('[data-message-id="m-user-old"]')).not.toContainText('Edit');
});

test('a running thread offers no prompt editing',async({page})=>{
 const state=seed(true);await route(page,state);
 await expect(page.locator('.message-user')).toContainText(PROMPT);
 await expect(editButton(page)).toHaveCount(0);
});

test('editor and disclosure stay usable at 320px in light theme with reduced motion',async({page},info)=>{
 const state=seed();state.snapshot.settings.theme='light';await route(page,state);
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
 await page.setViewportSize({width:320,height:700});
 const out=info.outputPath('screenshots');await mkdir(out,{recursive:true});
 await editButton(page).click();
 const area=page.locator('.prompt-edit-editor textarea');
 await expect(area).toHaveValue(PROMPT);
 await expect(page.getByText('Files are not reverted.',{exact:true})).toBeVisible();
 await area.fill(EDITED_PROMPT);
 await rerunButton(page).click();
 await editedToggle(page).click();
 const region=page.getByRole('region',{name:'Earlier prompt versions'});
 await expect(region).toContainText(PROMPT);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`${out}/edited-320-light-reduced.png`});
});
