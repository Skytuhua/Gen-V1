/** Inspect already generated objects and exercise only their visible local controls. No inference. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { request, expect } from '@playwright/test';
import type { Snapshot } from '../packages/contracts/index.ts';
import { openCaptureBrowser, recordWindow, closeCapture } from './review-capture.ts';
const root=resolve('docs/evidence/frontend-review/initiated-20261030');
const cases=[{id:'account',source:'genuine-natural-confirm/account/resumed/after.json'},{id:'agreement',source:'genuine-agreement-confirm/agreement/continued.json'},{id:'conflict',source:'genuine-conflict-confirm/conflict/continued.json'}];
const requested=process.argv.indexOf('--case'),outputIndex=process.argv.indexOf('--output');
const api=await request.newContext({baseURL:'http://127.0.0.1:4317'});await api.get('/api/bootstrap');
const snapshot=async():Promise<Snapshot>=>await(await api.get('/api/snapshot')).json();
const browser=await openCaptureBrowser();
try{for(const item of cases.filter(item=>requested<0||item.id===process.argv[requested+1])){
  const original:Snapshot=JSON.parse(await readFile(join(root,item.source),'utf8')),threadId=original.threads[0].id,artifactId=original.artifacts[0].id;
  const folder=join(root,outputIndex<0?'inspection':process.argv[outputIndex+1],item.id);await mkdir(folder,{recursive:true});
  await browser.page.goto('http://127.0.0.1:4317');await browser.page.evaluate(id=>localStorage.setItem('harness:selected-thread',id),threadId);await browser.page.reload();
  const artifact=browser.page.locator('.artifact').first();await expect(artifact).toBeVisible();await artifact.evaluate(node=>node.scrollIntoView({block:'start'}));await browser.page.waitForTimeout(1000);
  const stop=await recordWindow(browser.server,browser.page,join(folder,'inspection.mp4')),started=performance.now();
  const proof:Record<string,unknown>={case:item.id,threadId,artifactId,inference:false,source:item.source,status:'running',chapters:[{title:'Inspect the existing Pi-created interface',startSeconds:0}]};
  const scope=(s:Snapshot)=>({...s,threads:s.threads.filter(x=>x.id===threadId),archivedThreads:[],messages:s.messages.filter(x=>x.threadId===threadId),artifacts:s.artifacts.filter(x=>x.threadId===threadId),userStates:s.userStates.filter(x=>x.threadId===threadId),data:s.data.filter(x=>x.threadId===threadId),resources:s.resources.filter(x=>x.threadId===threadId),operations:s.operations.filter(x=>x.threadId===threadId),requests:s.requests.filter(x=>x.threadId===threadId),usage:{[threadId]:s.usage[threadId]}});
  try{
    await browser.page.waitForTimeout(1700);
    if(item.id==='agreement'){
      const radio=artifact.getByRole('radio',{name:'legal@studio.example',exact:false});await radio.scrollIntoViewIfNeeded();await radio.click();
      const live=(await snapshot()).artifacts.find(a=>a.id===artifactId)!,preview=Object.values(live.spec!.elements).find(n=>n.type==='DocumentPreview')!;
      const key=(preview.props.fieldStateKeys as Record<string,string>).Email;
      await expect.poll(async()=>(await snapshot()).userStates.find(s=>s.id===live.stateId)?.values[key]).toBe('legal@studio.example');
      const focus=artifact.getByRole('button',{name:'Go to Notices email',exact:true});if(await focus.count())await focus.click();
      await expect(artifact.locator('.document-preview').getByRole('status')).toContainText(/preview.*Page/);await browser.page.waitForTimeout(1300);
      proof.localAction={label:'legal@studio.example',stateKey:key,savedValue:'legal@studio.example',previewBindingRetained:true,operationExecuted:false};
      (proof.chapters as object[]).push({title:'Apply the agent-proposed notices address locally',startSeconds:(performance.now()-started)/1000});
    }else if(item.id==='conflict'){
      await expect(artifact.locator('.task-graph-vertical')).toBeVisible();await artifact.locator('.task-graph').scrollIntoViewIfNeeded();await browser.page.waitForTimeout(1800);
      const diff=artifact.locator('.diff');if(await diff.count()){await diff.scrollIntoViewIfNeeded();await browser.page.waitForTimeout(1800);}proof.verticalGraph=true;
    }else{
      const question=artifact.locator('.disclosure-trigger').first();if(await question.isVisible())await question.click();await browser.page.waitForTimeout(1200);
    }
    await artifact.evaluate(node=>node.scrollIntoView({block:'start'}));await browser.page.waitForTimeout(800);await browser.page.screenshot({path:join(folder,'working.png')});
    // Compare the acknowledged state after local actions, never a pre-edit baseline.
    const before=await snapshot();await writeFile(join(folder,'before-reload.json'),JSON.stringify(scope(before),null,2));
    await browser.page.reload();await expect(artifact).toBeVisible();await artifact.evaluate(node=>node.scrollIntoView({block:'start'}));
    if(item.id==='agreement')await expect(artifact.locator('.document-preview').getByRole('status')).toContainText(/preview.*Page/);
    await browser.page.waitForTimeout(1400);const after=await snapshot();
    const values=(s:Snapshot)=>s.userStates.filter(s=>s.threadId===threadId).map(s=>({id:s.id,revision:s.revision,values:s.values}));
    if(JSON.stringify(values(before))!==JSON.stringify(values(after)))throw Error('Reload changed acknowledged user state.');
    proof.reloadPreserved=true;proof.artifactRevision=after.artifacts.find(a=>a.id===artifactId)?.revision;proof.status='passed';
    await writeFile(join(folder,'reloaded.json'),JSON.stringify(scope(after),null,2));await browser.page.screenshot({path:join(folder,'reloaded.png')});await browser.page.waitForTimeout(1700);console.log('INSPECTED '+item.id);
  }catch(error){proof.status='failed';proof.error=String(error);console.log('INSPECTION_FAILED '+item.id+': '+String(error));process.exitCode=1;}
  finally{proof.recording=await stop();await writeFile(join(folder,'proof.json'),JSON.stringify(proof,null,2));}
}}finally{await closeCapture(browser);await api.dispose();}
