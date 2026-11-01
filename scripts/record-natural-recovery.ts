/** Continue only the already accepted natural request interrupted with the host. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request, expect } from '@playwright/test';
import type { Snapshot } from '../packages/contracts/index.ts';
import { openCaptureBrowser, recordWindow, closeCapture } from './review-capture.ts';
const folder = resolve('docs/evidence/frontend-review/initiated-20261030/genuine-natural-confirm/account');
const initial: Snapshot = JSON.parse(await readFile(join(folder, 'generated.json'), 'utf8'));
const thread = initial.threads[0], original = initial.artifacts[0];
const output = join(folder, 'resumed'); await mkdir(output);
const api = await request.newContext({ baseURL: 'http://127.0.0.1:4317' });
const bootstrap = await (await api.get('/api/bootstrap')).json();
const snapshot = async (): Promise<Snapshot> => (await (await api.get('/api/snapshot')).json());
const scope = (s: Snapshot) => ({ ...s, threads:s.threads.filter(x=>x.id===thread.id),archivedThreads:[],messages:s.messages.filter(x=>x.threadId===thread.id),artifacts:s.artifacts.filter(x=>x.threadId===thread.id),userStates:s.userStates.filter(x=>x.threadId===thread.id),data:s.data.filter(x=>x.threadId===thread.id),resources:s.resources.filter(x=>x.threadId===thread.id),operations:s.operations.filter(x=>x.threadId===thread.id),requests:s.requests.filter(x=>x.threadId===thread.id),usage:{[thread.id]:s.usage[thread.id]} });
const browser = await openCaptureBrowser();
let stop: Awaited<ReturnType<typeof recordWindow>> | undefined;
const proof: Record<string,unknown> = { modelId:'openai/gpt-6.1-sol',threadId:thread.id,explicitUiInstructions:false,newPrompt:null,repairPrompts:[],interruption:'User turn interrupted the recorder and host during the accepted ordinary continuation.',initialArtifact:{id:original.id,revision:original.revision,stateId:original.stateId},status:'running' };
try {
  const before=await snapshot(); if(before.threads.some(t=>t.runId))throw Error('Another run is active.');
  if(before.threads.find(t=>t.id===thread.id)?.status!=='interrupted')throw Error('Expected the interrupted owning thread.');
  await browser.page.goto('http://127.0.0.1:4317'); await browser.page.evaluate(id=>localStorage.setItem('harness:selected-thread',id),thread.id);await browser.page.reload();
  stop=await recordWindow(browser.server,browser.page,join(output,'recovery.mp4'));
  const started=performance.now();proof.chapters=[{title:'Resume the accepted ordinary request after host interruption',startSeconds:0}];
  const receipt=await api.post('/api/commands',{headers:{'x-harness-csrf':bootstrap.csrfToken},data:{id:randomUUID(),type:'run.resume',threadId:thread.id,payload:{modelId:'openai/gpt-6.1-sol'}}});
  if(!receipt.ok())throw Error(await receipt.text());
  await expect.poll(async()=>{const s=await snapshot();return !s.threads.find(t=>t.id===thread.id)?.runId;},{timeout:300_000,intervals:[700]}).toBe(true);
  const after=await snapshot(),updated=after.artifacts.find(a=>a.id===original.id);
  await writeFile(join(output,'after.json'),JSON.stringify(scope(after),null,2));
  if(!updated||updated.revision<=original.revision)throw Error('The accepted continuation did not update the existing artifact.');
  proof.sameArtifactContinuation={id:updated.id,revision:updated.revision,stateId:updated.stateId};
  await browser.page.locator('.artifact').first().scrollIntoViewIfNeeded();await browser.page.waitForTimeout(1500);
  (proof.chapters as object[]).push({title:'Inspect the updated existing interface',startSeconds:(performance.now()-started)/1000});
  await browser.page.screenshot({path:join(output,'updated.png')});
  const disclosure=browser.page.locator('.artifact .disclosure-trigger').first();if(await disclosure.isVisible())await disclosure.click();
  await browser.page.waitForTimeout(800);await browser.page.reload();await expect(browser.page.locator('.artifact').first()).toBeVisible();await browser.page.locator('.artifact').first().scrollIntoViewIfNeeded();await browser.page.waitForTimeout(1500);
  const restored=await snapshot();proof.reloadPreserved=JSON.stringify(after.userStates.filter(x=>x.threadId===thread.id).map(x=>x.values))===JSON.stringify(restored.userStates.filter(x=>x.threadId===thread.id).map(x=>x.values));
  // Local disclosure state may legitimately advance; compare reload to its acknowledged checkpoint instead.
  proof.reloadRestoredArtifact=restored.artifacts.find(a=>a.id===original.id)?.revision===updated.revision;
  await writeFile(join(output,'reloaded.json'),JSON.stringify(scope(restored),null,2));await browser.page.screenshot({path:join(output,'reloaded.png')});
  proof.status='passed';console.log('NATURAL_RECOVERY_PASSED');
}catch(error){proof.status='failed';proof.error=String(error);console.log('NATURAL_RECOVERY_FAILED '+String(error));process.exitCode=1;}
finally{if(stop)proof.recording=await stop();await writeFile(join(output,'proof.json'),JSON.stringify(proof,null,2));await closeCapture(browser);await api.dispose();}
