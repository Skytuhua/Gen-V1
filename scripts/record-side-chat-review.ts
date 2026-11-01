/** Recording fixture only: real Service authority and HTTP/SSE, scripted inference. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {expect} from '@playwright/test';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {buildServer} from '../apps/server/server.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun,RunContext,Thread} from '../packages/contracts/index.ts';
import {openCaptureBrowser,closeCapture,recordWindow,installThemeAudit} from './review-capture.ts';
import {humanClick} from './review-actions.ts';

class ScriptedConversation implements RuntimeAdapter{
 callbacks!:RuntimeCallbacks; input?:StartRun; cancelled:RunContext[]=[]; stopped=false;
 constructor(readonly side=false){}
 configure(callbacks:RuntimeCallbacks){this.callbacks=callbacks;}
 async models(){return [{id:'review/side-fixture',provider:'Recording fixture',name:'Local scripted side conversation'}];}
 async history(){return [];}
 async compact(){throw Error('Not part of this recording');}
 async start(input:StartRun){
  this.input=input;this.stopped=false;
  const event=(type:string,extra:Record<string,unknown>={})=>this.callbacks.onEvent({...input,type,...extra});
  event('input.processing',{inputIds:input.inputIds});
  const messageId=randomUUID();
  const chunks=this.side?['An idempotency key identifies one intended order. ','Retry the same order with the same key; ','inspect its saved result before creating a different order.']:['I’m tracing the failing checkout assertion. ','The main task stays active while you ask a separate question.'];
  for(const delta of chunks){await pause(480);if(this.stopped)return;event('assistant.delta',{messageId,delta});}
  event('assistant.message',{messageId,content:chunks.join(''),inputIds:input.inputIds});
  if(this.side&&!input.prompt.toLowerCase().includes('wait for me'))await this.finish();
 }
 async finish(){if(!this.input||this.stopped)return;await this.callbacks.onTool({name:'task_finish',args:{outcome:this.side?'Explained the retry decision.':'Investigation paused after the side question review.',evidence:[]}},this.input);this.callbacks.onEvent({...this.input,type:'settled',aborted:false});}
 async followUp(input:StartRun){await this.start(input);}
 async cancel(ctx:RunContext){this.cancelled.push(ctx);this.stopped=true;}
 async dispose(){this.stopped=true;}
}

const index=process.argv.indexOf('--output'),output=resolve(index<0?'docs/evidence/dark-micro-motion-20261031/side':process.argv[index+1]);
await mkdir(output,{recursive:false});
const store=new Store(join(output,'fixture-state')),main=new ScriptedConversation(),sides:ScriptedConversation[]=[];
const service=new Service(store,main,{sideRuntimeFactory:()=>{const side=new ScriptedConversation(true);sides.push(side);return side;}});
await service.recover();
const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:randomUUID(),type,payload,threadId});
await send('settings.update',{theme:'dark',modelId:'review/side-fixture'});
const parent=(await send('thread.create',{title:'Investigate checkout retries',projectName:'Side conversation review'})).result as Thread;
const port=4349,app=await buildServer(service,{port,dev:false}),browser=await openCaptureBrowser();
await app.listen({port,host:'127.0.0.1'});
const page=browser.page;await page.emulateMedia({colorScheme:'dark'});const audit=await installThemeAudit(page,'dark');
const captures:Record<string,unknown>[]=[],manifest={theme:'dark',genuinePi:false,provenance:'Real isolated local Service and HTTP/SSE, independent scripted read-only adapters. No model, external execution or credentials.',captures};
let stop:undefined|(()=>Promise<Record<string,unknown>>);
try{
 await page.goto('http://127.0.0.1:'+port);await page.evaluate(id=>localStorage.setItem('harness:selected-thread',id),parent.id);await page.reload();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();await audit.assert();
 const file='01-side-chat.mp4';stop=await recordWindow(browser.server,page,join(output,file));const started=performance.now(),chapters:{title:string;startSeconds:number;frame:string}[]=[];
 const chapter=async(title:string)=>{await audit.assert();const frame=`side-chat-chapter-${chapters.length+1}.png`;chapters.push({title,startSeconds:(performance.now()-started)/1000,frame});await page.screenshot({path:join(output,frame)});};
 await pause(1000);const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.pressSequentially('Investigate the checkout retry failure.',{delay:25});await humanClick(page,page.getByRole('button',{name:'Send message',exact:true}),900);
 await expect.poll(()=>service.thread(parent.id).runId).not.toBeNull();const mainRun=service.thread(parent.id).runId;
 await chapter('Main task continues');
 await composer.pressSequentially('/btw What does an idempotency key do?',{delay:26});await composer.press('Enter');
 const window=page.getByRole('region',{name:'Side conversation window',exact:true});await expect(window).toBeVisible();await expect(window.getByText(/Retry the same order/)).toBeVisible();
 await expect.poll(()=>store.all<Thread>('thread').find(thread=>thread.sideParentId)?.runId).toBeNull();expect(service.thread(parent.id).runId).toBe(mainRun);
 await chapter('Independent read-only question and progressive reply');
 const draft=window.getByRole('textbox',{name:'Side question',exact:true});await draft.pressSequentially('Keep the same key if the first response is missing?',{delay:25});await draft.press('Enter');await pause(2100);
 await chapter('Same side conversation, meaningful follow-up');
 await draft.fill('Keep this unsent side question.');await pause(600);await page.reload();await humanClick(page,page.getByRole('button',{name:'Open side conversation',exact:true}),700);await expect(window.getByRole('textbox',{name:'Side question',exact:true})).toHaveValue('Keep this unsent side question.');expect(service.thread(parent.id).runId).toBe(mainRun);
 await chapter('Side draft and history recovered without stopping the main task');
 await window.getByRole('textbox',{name:'Side question',exact:true}).fill('Wait for me while I inspect this.');await window.getByRole('textbox',{name:'Side question',exact:true}).press('Enter');await expect(window.getByRole('button',{name:'Stop side response',exact:true})).toBeVisible();await humanClick(page,window.getByRole('button',{name:'Stop side response',exact:true}),700);
 expect(main.cancelled).toHaveLength(0);expect(service.thread(parent.id).runId).toBe(mainRun);await chapter('Stop targets only the side response');
 await humanClick(page,window.getByRole('button',{name:'Minimize Side conversation',exact:true}),650);await humanClick(page,window.getByRole('button',{name:'Expand Side conversation',exact:true}),650);await humanClick(page,window.getByRole('button',{name:'Close Side conversation',exact:true}),650);
 await main.finish();await expect.poll(()=>service.thread(parent.id).runId).toBeNull();await chapter('Settled main task and preserved side history');await pause(1200);await audit.assert();
 const poster='side-chat-settled.png';await page.screenshot({path:join(output,poster)});const probe=await stop();stop=undefined;
 captures.push({scenario:'side-chat',title:'Side chat without interrupting the main task',theme:'dark',themeAudit:audit.records(),file,poster,chapters,probe,fixture:true,caption:manifest.provenance});
 await writeFile(join(output,'snapshot.json'),JSON.stringify(store.snapshot(),null,2));
}catch(error){if(stop)await stop();await page.screenshot({path:join(output,'side-chat-failed.png')}).catch(()=>{});throw error;}
finally{await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));await closeCapture(browser);await app.close();await service.dispose();store.close();}
console.log('SIDE_REVIEW_OUTPUT '+output);
