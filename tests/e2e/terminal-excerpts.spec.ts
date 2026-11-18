import {test,expect,type Page} from '@playwright/test';
import {shellInit,shellRoute,shellSnapshot} from '../../scripts/capture-ui/shell-api';


async function setup(page:Page,query=''){
 const snapshot=shellSnapshot(),sends:{content:string;id:string}[]=[],terminalCommands:unknown[]=[];let fail=false,rejected=false,release:(()=>void)|undefined;
 await page.addInitScript(shellInit);await page.route('**/api/**',async r=>{
  const url=new URL(r.request().url());if(url.pathname==='/api/terminals'){const body=r.request().postDataJSON();const output='\x1b[31mFAIL workspace.test.ts\x1b[0m\r\nExpected: 3 panels\r\nReceived: 2 panels\r\n at workspace.test.ts:91\r\n';return r.fulfill({json:{id:body.terminalId,projectId:body.projectId,threadId:body.threadId,output,start:query.includes('expired')?512:0,cursor:output.length+(query.includes('expired')?512:0),exited:true,exitCode:1}});}
  if(url.pathname.includes('/terminals/')&&url.pathname.endsWith('/commands')){terminalCommands.push(r.request().postDataJSON());return r.fulfill({json:{}});}
  if(url.pathname==='/api/commands'&&r.request().postDataJSON().type==='message.send'){const body=r.request().postDataJSON();sends.push({content:body.payload.content,id:body.id});if(release)await new Promise<void>(resolve=>{release=resolve;});if(rejected)return r.fulfill({status:409,json:{error:{code:'REJECTED',message:'Rejected before admission',details:{sendAccepted:false}}}});if(fail)return r.abort();}
  return shellRoute(r,snapshot,false);
 });await page.goto('/fixture'+query);await expect(page.locator('.xterm-screen')).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 return {sends,terminalCommands,reject:()=>{rejected=true;},uncertain:()=>{fail=true;},accept:()=>{fail=false;},hold:()=>{release=()=>{};},release:()=>{release?.();release=undefined;}};
}
async function select(page:Page){await page.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+Shift+a');await expect(page.getByRole('button',{name:'Add selection to prompt'})).toBeEnabled();}
async function add(page:Page){await select(page);await page.getByRole('button',{name:'Add selection to prompt'}).click();await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();}
test('real xterm selection is copied before focus/scroll, edited and persisted without terminal input or Send',async({page})=>{
 const f=await setup(page);await add(page);expect(f.sends).toEqual([]);expect(f.terminalCommands).toEqual([]);
 await page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true}).click();await expect(page.getByLabel('Excerpt text')).toContainText('Expected: 3 panels');await page.getByLabel('Excerpt text').fill('Reviewed failure output');await page.getByRole('button',{name:'Save excerpt'}).click();await expect(page.getByRole('dialog')).toBeHidden();await page.reload();await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>f.sends.length).toBe(1);expect(f.sends[0].content).toContain('Reviewed failure output');expect(f.sends[0].content).not.toContain('Expected:');await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeHidden();
});
test('keyboard selection and action are immediate; remove releases geometry immediately',async({page})=>{
 const f=await setup(page),composer=page.locator('.composer').last(),initial=await composer.boundingBox();await select(page);await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Add selection to prompt'})).toBeFocused();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Remove terminal excerpt capture-terminal'}).click();await expect(page.getByRole('group',{name:'Attachments',exact:true})).toBeHidden();expect(f.terminalCommands).toEqual([]);expect((await composer.boundingBox())!.height).toBe(initial!.height);
});
test('uncertain retry retains original serialized bytes while later text and excerpt edits survive acknowledgment',async({page})=>{
 const f=await setup(page);await add(page);f.uncertain();await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('button',{name:'Retry send'})).toBeVisible();await page.getByRole('textbox',{name:'Message',exact:true}).fill('New draft');await page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true}).click();await page.getByLabel('Excerpt text').fill('Newer excerpt');await page.getByRole('button',{name:'Save excerpt'}).click();const previous=f.sends.length;f.accept();await page.getByRole('button',{name:'Retry send'}).click();await expect.poll(()=>f.sends.length).toBe(previous+1);await expect(page.getByRole('button',{name:'Retry send'})).toBeHidden();expect(f.sends.at(-1)).toEqual(f.sends[0]);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('New draft');await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();
});
test('owner switch and read-only/unavailable composer do not transfer excerpts',async({page})=>{
 await setup(page);await add(page);await page.goto('/fixture?owner=other');await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeHidden();await page.goto('/fixture?readonly=1');await expect(page.getByRole('button',{name:'Add selection to prompt'})).toBeHidden();await page.goto('/fixture?unavailable=1');await expect(page.getByRole('button',{name:'Add selection to prompt'})).toBeHidden();
});
test('renders approved leaf UI at 1440/1024/768 and immediate reduced-motion attachment geometry',async({page},info)=>{
 await setup(page);await add(page);for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`3-after-${width}.png`)});}
 await page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true}).click();await page.screenshot({path:info.outputPath('review.png')});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Remove terminal excerpt capture-terminal'}).click();await expect(page.getByRole('group',{name:'Attachments',exact:true})).toBeHidden();
});

test('authenticated precommit rejection retains excerpts for review and a fresh Send',async({page})=>{
 const f=await setup(page);await add(page);f.reject();await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Rejected before admission');await expect(page.getByRole('button',{name:'Retry send'})).toBeHidden();await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();
});

test('disabled program fixture metadata requires an exact known thread and a read request',async({page})=>{
 await setup(page);
 const responses=await page.evaluate(async()=>{
  const requests=[
   {path:'/api/threads/one/tool-programs',method:'GET'},
   {path:'/api/threads/two/tool-programs',method:'GET'},
   {path:'/api/threads/unknown/tool-programs',method:'GET'},
   {path:'/api/threads//tool-programs',method:'GET'},
   {path:'/api/threads/one/tool-programs/',method:'GET'},
   {path:'/api/threads/one/tool-programs/program/results/ref',method:'GET'},
   {path:'/api/threads/one/tool-programs?owner=two',method:'GET'},
   {path:'/api/threads/one/tool-programs',method:'POST'},
   {path:'/api/threads/one/tool-programs',method:'DELETE'},
  ];
  return Promise.all(requests.map(async request=>{const response=await fetch(request.path,{method:request.method});return{...request,status:response.status,body:await response.json()};}));
 });
 const empty={programs:[],kernels:[],available:{javascript:false,python:false,replay:false},resetNotice:'Reset clears variables. It does not undo files or prior remote effects. Previous cells are never replayed.'};
 for(const response of responses.slice(0,2)){expect(response.status).toBe(200);expect(response.body).toEqual(empty);}
 for(const response of responses.slice(2,7))expect(response.status).toBe(404);
 for(const response of responses.slice(7))expect(response.status).toBe(405);
});

test('expired host output is captured from the current xterm selection, without rereading old output',async({page})=>{
 const f=await setup(page,'?expired=1');await add(page);await page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true}).click();await expect(page.getByLabel('Excerpt text')).toHaveValue(/Earlier output expired/);expect(f.sends).toEqual([]);
});

async function editExcerpt(page:Page,text:string){
 await page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true}).click();await page.getByLabel('Excerpt text').fill(text);await page.getByRole('button',{name:'Save excerpt',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
}
async function excerptRecord(page:Page){return page.evaluate(async()=>{const path='/apps/web/src/journal.ts';const journal=await import(path);return journal.journalReadRecord('draft-excerpts:one');});}
test('uncertain retry retains a newer A to B to A generation from another window after reload',async({page,context})=>{
 const f=await setup(page);await add(page);const sent=await excerptRecord(page);const original=sent.value[0].text;
 f.uncertain();await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('button',{name:'Retry send',exact:true})).toBeVisible();
 const other=await context.newPage();await setup(other);await editExcerpt(other,'B');await editExcerpt(other,original);const newer=await excerptRecord(other);expect(newer.generation).not.toBe(sent.generation);expect(newer.value).toEqual(sent.value);
 await page.reload();await expect(page.getByRole('button',{name:'Retry send',exact:true})).toBeEnabled();const previous=f.sends.length;f.accept();await page.getByRole('button',{name:'Retry send',exact:true}).click();await expect.poll(()=>f.sends.length).toBe(previous+1);await expect(page.getByRole('button',{name:'Retry send',exact:true})).toBeHidden();
 expect(f.sends.at(-1)).toEqual(f.sends[0]);await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeVisible();expect((await excerptRecord(page)).generation).toBe(newer.generation);
});
test('real scoped retry permits review, edit and removal without changing the frozen send',async({page})=>{
 const f=await setup(page,'?scoped=1');await add(page);f.uncertain();await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Retry send',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Remove terminal excerpt capture-terminal',exact:true})).toBeEnabled();await editExcerpt(page,'Reviewed while retrying');await page.getByRole('button',{name:'Remove terminal excerpt capture-terminal',exact:true}).click();await expect(page.getByRole('group',{name:'Attachments',exact:true})).toBeHidden();
 const previous=f.sends.length;f.accept();f.hold();await page.getByRole('button',{name:'Retry send',exact:true}).click();await expect.poll(()=>f.sends.length).toBe(previous+1);try{await add(page);await expect(page.getByRole('button',{name:'Terminal selection · capture-terminal',exact:true})).toBeEnabled();await editExcerpt(page,'Edited during held retry');await page.getByRole('button',{name:'Remove terminal excerpt capture-terminal',exact:true}).click();await expect(page.getByRole('group',{name:'Attachments',exact:true})).toBeHidden();}finally{f.release();}await expect.poll(()=>page.evaluate(async()=>{const path='/apps/web/src/journal.ts';return (await (await import(path)).journalReadRecord('agents-pending:one'))?.value;})).toBeNull();expect(f.sends.at(-1)).toEqual(f.sends[0]);expect((await excerptRecord(page)).value).toEqual([]);
});
