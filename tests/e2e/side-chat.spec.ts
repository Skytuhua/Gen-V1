import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import type {HostCommand,Thread} from '../../packages/contracts';

async function fixture(page:Page){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'The main investigation stays here.'}}}});snapshot.settings.theme='dark';snapshot.threads[0].status='working';snapshot.threads[0].runId='main-run';
 const host=await serveTaskFixture(page,snapshot);let next=0,fail=false;
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON() as HostCommand;host.commands.push(command);let result:unknown={};
  if(fail&&command.type==='message.send'){fail=false;return route.fulfill({status:409,json:{error:{code:'RUN_BUSY',message:'Side response is still working.'}}});}
  if(command.type==='thread.create'){
   const thread:Thread={...snapshot.threads[0],id:'side-'+(++next),title:'Side question',mode:'plan',sideParentId:String(command.payload.sideParentId),runId:null,status:'ready',sessionPath:null};snapshot.threads.push(thread);result=thread;
  }else if(command.type==='message.send'){
   snapshot.messages.push({id:'side-message-'+snapshot.seq,threadId:command.threadId!,role:'user',content:String(command.payload.content),createdAt:new Date().toISOString(),runId:null});const thread=snapshot.threads.find(item=>item.id===command.threadId)!;thread.status='working';thread.runId='side-run';
  }else if(command.type==='run.stop'){const thread=snapshot.threads.find(item=>item.id===command.threadId)!;thread.status='stopped';thread.runId=null;}
  snapshot.seq++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result}});
 });
 return {...host,failNext:()=>{fail=true;},settle:async()=>{const side=snapshot.threads.find(item=>item.sideParentId)!;side.runId=null;side.status='ready';snapshot.messages.push({id:'side-answer-'+snapshot.seq,threadId:side.id,role:'assistant',content:'This explains the failure without stopping the main task.',createdAt:new Date().toISOString(),runId:'side-run'});await host.publish();}};
}
async function openSide(page:Page){
 const main=page.getByRole('textbox',{name:'Message',exact:true});await main.fill('/side');await main.press('Enter');
 await expect(page.getByRole('region',{name:'Side conversation window',exact:true})).toBeVisible();
}
test('/btw opens independent floating conversation while the main run and Stop remain available',async({page})=>{
 const host=await fixture(page);await page.goto('/');const main=page.getByRole('textbox',{name:'Message',exact:true});await main.fill('/btw Why does this fail?');await main.press('Enter');
 const side=page.getByRole('region',{name:'Side conversation window',exact:true});await expect(side).toBeVisible();await expect(side.getByText('Why does this fail?',{exact:true})).toBeVisible();
 await expect(main).toHaveValue('');await expect(page.getByRole('button',{name:'Stop agent',exact:true})).toBeVisible();await expect(page.locator('.breadcrumb')).toContainText('Source-bound task fixture');
 expect(host.commands.find(command=>command.type==='thread.create')?.payload.sideParentId).toBe('task-thread');expect(host.commands.find(command=>command.type==='message.send')?.threadId).toBe('side-1');
 await side.getByRole('button',{name:'Stop side response',exact:true}).click();expect(host.commands.filter(command=>command.type==='run.stop').map(command=>command.threadId)).toEqual(['side-1']);
 expect(await page.locator('.sidebar .thread-list').innerText()).not.toContain('Side question');
});
test('side drafts, history and same-session continuation survive reload without touching the main draft',async({page})=>{
 const host=await fixture(page);await page.goto('/');const main=page.getByRole('textbox',{name:'Message',exact:true});await main.fill('/side');await main.press('Enter');
 const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});await input.fill('A draft for the side.');await page.reload();await openSide(page);await expect(input).toHaveValue('A draft for the side.');
 await side.getByRole('button',{name:'Send side question',exact:true}).click();await expect(side.getByRole('button',{name:'Stop side response',exact:true})).toBeVisible();await host.settle();await expect(side.getByText('This explains the failure without stopping the main task.',{exact:true})).toBeVisible();
 await main.fill('Keep my main draft');await input.fill('Explain the second point');await input.press('Enter');await expect(input).toHaveValue('');expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(1);expect(host.commands.filter(command=>command.type==='message.send').map(command=>command.threadId)).toEqual(['side-1','side-1']);await expect(main).toHaveValue('Keep my main draft');
});
for(const event of [{key:'Enter',isComposing:true,keyCode:13},{key:'Enter',isComposing:false,keyCode:229}]){
 test(`IME Enter preserves a side draft (isComposing=${event.isComposing}, keyCode=${event.keyCode})`,async({page})=>{
  const host=await fixture(page);await page.goto('/');await openSide(page);
  const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});
  await expect(input).toBeEnabled();await input.fill('Keep this question.');await input.dispatchEvent('keydown',event);
  await expect(input).toHaveValue('Keep this question.');await expect(input).toBeFocused();
  expect.soft(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);expect.soft(host.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
  await page.reload();await openSide(page);await expect(input).toBeEnabled();await expect(input).toHaveValue('Keep this question.');
  expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);expect(host.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
 });
}
test('genuine side Enter sends once',async({page})=>{
 const host=await fixture(page);await page.goto('/');await openSide(page);
 const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});
 await expect(input).toBeEnabled();await input.fill('Keep this question.');await input.dispatchEvent('keydown',{key:'Enter',keyCode:13,isComposing:false});
 await expect(input).toHaveValue('');await expect(side.getByRole('button',{name:'Stop side response',exact:true})).toBeVisible();
 expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(1);
 expect(host.commands.filter(command=>command.type==='message.send').map(command=>({threadId:command.threadId,content:command.payload.content}))).toEqual([{threadId:'side-1',content:'Keep this question.'}]);
});
test('Shift+Enter adds a side-question newline without sending',async({page})=>{
 const host=await fixture(page);await page.goto('/');await openSide(page);
 const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});
 await expect(input).toBeEnabled();await input.fill('Keep this question.');await input.press('Shift+Enter');await expect(input).toHaveValue('Keep this question.\n');
 expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);expect(host.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
});
test('a failed side send preserves the question after reload',async({page})=>{
 const host=await fixture(page);await page.goto('/');await openSide(page);const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});await input.fill('Keep this question.');
 host.failNext();await side.getByRole('button',{name:'Send side question',exact:true}).click();await expect(side.getByRole('alert')).toContainText('Side response is still working.');await expect(input).toHaveValue('Keep this question.');await page.reload();await openSide(page);await expect(input).toHaveValue('Keep this question.');
});

test('typing during first side creation migrates the newest draft and only submits the original question',async({page})=>{
 const host=await fixture(page);let release!:()=>void,entered=false;
 const gate=new Promise<void>(done=>{release=done;});
 await page.route('**/api/commands',async route=>{if(route.request().postDataJSON().type==='thread.create'){entered=true;await gate;}await route.fallback();});
 await page.goto('/');await openSide(page);
 const side=page.getByRole('region',{name:'Side conversation window',exact:true}),input=side.getByRole('textbox',{name:'Side question',exact:true});
 await input.fill('Original question');await side.getByRole('button',{name:'Send side question',exact:true}).click();await expect.poll(()=>entered).toBe(true);
 await input.fill('Newer unsent question');release();
 await expect(side.getByText('Original question',{exact:true})).toBeVisible();await expect(input).toHaveValue('Newer unsent question');
 expect(host.commands.filter(command=>command.type==='message.send').map(command=>command.payload.content)).toEqual(['Original question']);
 await page.reload();await openSide(page);await expect(input).toHaveValue('Newer unsent question');
});
