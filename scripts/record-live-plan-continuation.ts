/** Records actual Pi plan/delegation behavior, separately from artifact-generation acceptance. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request,expect} from '@playwright/test';
import {openCaptureBrowser,recordWindow,closeCapture} from './review-capture.ts';
import type {Snapshot,Thread} from '../packages/contracts';
import {PlanRecordSchema,PLANNING_PROVENANCE} from '../packages/contracts/planning.ts';
const root=resolve('docs/evidence/frontend-review/smooth-expanded-20261030');
const prior=JSON.parse(await readFile(join(root,'genuine-confirmation/software/proof.json'),'utf8'));
const owner=prior.threadId as string,output=join(root,'live-plan');await mkdir(output);
const api=await request.newContext({baseURL:'http://127.0.0.1:4317'});await api.get('/api/bootstrap');
const state=async()=>await (await api.get('/api/snapshot')).json() as Snapshot;
const before=await state(),thread=before.threads.find(t=>t.id===owner);
if(!thread||before.threads.some(t=>t.runId))throw Error('Another task is active; no continuation sent');
const record=before.data.find(d=>d.threadId===owner&&d.provenance===PLANNING_PROVENANCE);
if(!record)throw Error('Actual Pi did not publish a task plan');const plan=PlanRecordSchema.parse(record.value);
if(plan.agents.length<2||plan.agents.some(a=>a.status!=='completed'))throw Error('The prior real readers did not complete');
const capture=await openCaptureBrowser();let stop:Awaited<ReturnType<typeof recordWindow>>|undefined;
const prompt='Also check how the proposed correction behaves for fractional quantities. Use an independent reader; keep the existing recommendation and do not modify files.';
const proof:Record<string,unknown>={modelId:thread.modelId,threadId:owner,prompt,genuinePi:true,artifactGenerationAccepted:false,note:'The prior ordinary request selected a persistent task plan and two read-only readers, but produced no interactive artifact. This records the plan/delegation feature only.',before:{id:record.id,revision:record.revision,jobs:plan.agents.map(a=>a.id)},chapters:[{title:'Actual existing plan and two completed readers',startSeconds:0}]};
try{
 await capture.page.goto('http://127.0.0.1:4317');await capture.page.evaluate(id=>localStorage.setItem('harness:selected-thread',id),owner);await capture.page.reload();await capture.page.getByRole('button',{name:'Thread options',exact:true}).click();await capture.page.getByRole('button',{name:'Show plan',exact:true}).click();await expect(capture.page.getByRole('region',{name:'Task plan',exact:true})).toBeVisible();
 stop=await recordWindow(capture.server,capture.page,join(output,'live-plan.mp4'));await capture.page.waitForTimeout(1400);const started=performance.now();
 await capture.page.getByRole('textbox',{name:'Message',exact:true}).fill(prompt);await capture.page.getByRole('button',{name:'Send message',exact:true}).click();
 let latest:Snapshot=before;
 const limit=performance.now()+180_000;
 while(performance.now()<limit){latest=await state();const t=latest.threads.find(t=>t.id===owner)!;if(['failed','interrupted','stopped'].includes(t.status))throw Error(t.error??t.status);if(!t.runId&&latest.seq>before.seq+2)break;await capture.page.waitForTimeout(700);}
 const after=latest.data.find(d=>d.id===record.id)!;const result=PlanRecordSchema.parse(after.value);
 if(latest.threads.find(t=>t.id===owner)?.runId)throw Error('Continuation exceeded three minutes');
 if(after.revision<=record.revision||result.agents.length<=plan.agents.length)throw Error('No new actual delegated job was recorded');
 proof.after={id:after.id,revision:after.revision,jobs:result.agents.map(({id,status,completedRequirementIds,requirements,usage,evidence})=>({id,status,completedRequirementIds,requirements,usage,evidence}))};proof.status='passed';
 (proof.chapters as object[]).push({title:'Same plan after the additional reader',startSeconds:(performance.now()-started)/1000});
 await capture.page.screenshot({path:join(output,'settled.png')});await capture.page.waitForTimeout(1800);proof.recording=await stop();stop=undefined;
}catch(error){proof.status='failed';proof.error=String(error);await capture.page.screenshot({path:join(output,'failure.png')}).catch(()=>{});if(stop){proof.recording=await stop();stop=undefined;}process.exitCode=1;
}finally{await writeFile(join(output,'proof.json'),JSON.stringify(proof,null,2));await closeCapture(capture);await api.dispose();}
console.log(JSON.stringify({status:proof.status,output,error:proof.error}));
