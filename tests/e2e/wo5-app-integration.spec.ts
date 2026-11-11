import {expect,test,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {EMPTY_USAGE} from '../../packages/contracts';
import {shellInit,shellRoute,shellSnapshot} from '../../scripts/capture-ui/shell-api';
import {projectContext} from '../../scripts/capture-ui/browser-data';

async function host(page:Page){
 const snapshot=shellSnapshot(),commands:{type:string;threadId:string;payload:{content?:string}}[]=[],unexpected:string[]=[];
 const workingCopy={id:'copy-one',path:'/synthetic/copy-one'};
 snapshot.threads[0].projectId='capture-project';snapshot.threads[0].projectName='Audit project';
 snapshot.messages=Array.from({length:125},(_,i)=>({...snapshot.messages[0],id:'message-'+i,content:'Workspace integration evidence '+i}));
 snapshot.memory=[{id:'note',threadId:'one',key:'decision',content:'Keep this owner note.',revision:1,author:'user',updatedAt:'2026-11-10T00:00:00Z'}];
 snapshot.usage.one={...EMPTY_USAGE,inputTokens:18321,outputTokens:791,cost:0.012345,sessionPercent:23.456,weeklyPercent:67.89,contextTokens:18000,contextWindow:100000};
 snapshot.data=[{id:'recorded',threadId:'one',revision:1,createdAt:'2026-11-10T00:00:00Z',provenance:'Synthetic executor record',value:{title:'Recorded comparison',before:'Old recorded value',after:'New recorded value'}}];
 await page.addInitScript(shellInit);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.origin!=='http://127.0.0.1:5527'){unexpected.push(url.origin+path);return route.abort('blockedbyclient');}
  if(!path.startsWith('/api/'))return route.continue();
  if(path.startsWith('/api/projects/capture-project/')){
   expect(url.searchParams.get('threadId')).toBe('one');
   if(path.endsWith('/context'))return route.fulfill({json:{...projectContext,threadId:'one',workingCopy}});
   if(path.endsWith('/git'))return route.fulfill({json:{head:'a'.repeat(40),revision:'b'.repeat(64),branch:'audit',files:[{path:'capture.txt',added:4,removed:2,index:' ',worktree:'M',staged:false}],diff:'Live same-owner diff',stagedDiff:'',truncated:false,gitWrite:false}});
   if(path.endsWith('/files'))return route.fulfill({json:{path:'',entries:[{name:'capture.txt',path:'capture.txt',kind:'file',bytes:24}],truncated:false}});
   if(path.endsWith('/file'))return route.fulfill({json:{text:'Synthetic integration file preview',binary:false,sha256:'a'.repeat(64)}});
  }
  if(path==='/api/terminals'){
   const body=route.request().postDataJSON();expect(body.projectId).toBe('capture-project');expect(body.threadId).toBe('one');
   const output='FAIL workspace.test.ts\r\nExpected 3 panels; received 2 panels\r\n';
   return route.fulfill({json:{id:body.terminalId,projectId:body.projectId,threadId:body.threadId,output,start:0,cursor:output.length,exited:true,exitCode:1}});
  }
  if(path==='/api/commands')commands.push(route.request().postDataJSON());
  const allowed=['/api/bootstrap','/api/snapshot','/api/shell-settings','/api/models','/api/workspace','/api/shell/navigation','/api/shell/settings','/api/shell/archive','/api/shell/resources','/api/plugins','/api/skills/available','/api/environment','/api/integrations','/api/commands','/api/split-workspace/profiles'];
  if(allowed.includes(path)||/^\/api\/shell\/navigation\/[^/]+$/.test(path))return shellRoute(route,snapshot,false);
  unexpected.push(path);return route.abort('blockedbyclient');
 });
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 return {snapshot,commands,unexpected,workingCopy};
}
async function panel(page:Page,name:string){
 const open=page.getByRole('button',{name:'Open workspace panel',exact:true});if(await open.count())await open.click();
 await page.getByRole('tab',{name,exact:true}).click();
}
for(const width of [1440,1024,768])test(`actual App keeps Files, find, Changes and Notes owners at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const h=await host(page);
 const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep my unsent integration draft');await draft.focus();await page.keyboard.press('Control+f');
 await page.getByRole('textbox',{name:'Find phrase'}).fill('workspace');await expect(page.getByRole('search')).toContainText('1 of 100');
 await page.getByRole('button',{name:'Load older messages',exact:true}).click();await expect(page.getByRole('search')).toContainText('26 of 125');
 await page.keyboard.press('Escape');await expect(draft).toBeFocused();await expect(draft).toHaveValue('Keep my unsent integration draft');
 await panel(page,'Files');await page.getByRole('button',{name:'capture.txt',exact:true}).click();await expect(page.locator('.files-preview')).toContainText('Synthetic integration file preview');
 await page.getByRole('button',{name:'Inspect changes',exact:true}).click();await expect(page.locator('.live-diff')).toContainText('Live same-owner diff');
 await page.getByRole('tab',{name:'Recorded',exact:true}).click();await expect(page.locator('.workspace-diffs')).toContainText('Recorded comparison');
 await page.getByRole('tab',{name:'History',exact:true}).click();await expect(page.getByRole('tabpanel').last()).toContainText('No checkpoint service is connected');
 await expect(page.getByRole('button',{name:'Restore selected files'})).toHaveCount(0);
 await panel(page,'Notes');const note=page.getByRole('textbox',{name:'Note decision',exact:true});await expect(note).toBeEnabled();await note.fill('Retain this unsaved owner note.');
 await panel(page,'Output');await expect(page.getByRole('region',{name:'Thread memory'})).toHaveCount(0);
 await panel(page,'Notes');await expect(note).toHaveValue('Retain this unsaved owner note.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(h.unexpected).toEqual([]);expect(h.commands.filter(c=>c.type==='message.send')).toEqual([]);
 const out=info.outputPath('screenshots');await mkdir(out,{recursive:true});await page.screenshot({path:`${out}/notes-${width}.png`,fullPage:true});
});
test('actual terminal selection reaches the same unsent composer and is serialized once by normal Send',async({page})=>{
 const h=await host(page);await panel(page,'Terminal');await expect(page.locator('.xterm-screen')).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+Shift+a');
 await page.getByRole('button',{name:'Add selection to prompt'}).click();
 const chip=page.getByRole('button',{name:/^Terminal selection ·/});await expect(chip).toBeVisible();expect(h.commands.filter(c=>c.type==='message.send')).toEqual([]);
 await chip.click();await page.getByLabel('Excerpt text').fill('Reviewed failure output');await page.getByRole('button',{name:'Save excerpt'}).click();
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>h.commands.filter(c=>c.type==='message.send').length).toBe(1);
 const sent=h.commands.find(c=>c.type==='message.send')!;expect(sent.threadId).toBe('one');expect(sent.payload.content?.match(/Reviewed failure output/g)).toHaveLength(1);await expect(chip).toHaveCount(0);expect(h.unexpected).toEqual([]);
});
test('production overview and compact usage retain their exact destinations under reduced motion and light zoom',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const h=await host(page);
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion='off';document.documentElement.style.zoom='1.5';});
 await page.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(page.locator('.project-context-card')).toContainText('Audit project');
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await page.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(page.locator('.floating-usage-details dl')).toHaveCount(0);
 const open=page.getByRole('button',{name:'Open Usage',exact:true});await open.focus();await page.keyboard.press('Enter');
 const usage=page.getByRole('dialog',{name:'Usage',exact:true});await expect(usage).toContainText('Audit the workspace');await expect(usage).toContainText('0.012345');
 await usage.getByRole('tab',{name:'Tokens',exact:true}).click();await expect(usage).toContainText('18,321');await usage.getByRole('tab',{name:'Limits',exact:true}).click();await expect(usage).toContainText('67.89%');
 await page.keyboard.press('Escape');await expect(open).toBeFocused();expect(h.unexpected).toEqual([]);
});

for(const width of [1440,1024,768])test(`QA r1 actual App saves, restores and deletes named drafts at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const h=await host(page),input=page.getByRole('textbox',{name:'Message',exact:true});
 await input.fill('Saved original prompt');const drafts=page.getByRole('button',{name:'Drafts',exact:true});await expect(drafts).toBeEnabled();await drafts.click();
 await page.getByRole('button',{name:'Save current prompt',exact:true}).click();await page.getByRole('textbox',{name:'Draft name',exact:true}).fill('Integration prompt');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt',exact:true})).toBeHidden();
 await input.fill('Keep my current prompt');await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('Integration prompt');
 await page.getByRole('button',{name:'Restore',exact:true}).click();await expect(page.getByRole('dialog',{name:'Restore saved draft',exact:true})).toContainText('Saved original prompt');
 await page.screenshot({path:info.outputPath(`saved-drafts-${width}.png`),fullPage:true});await page.getByRole('button',{name:'Replace text',exact:true}).click();await expect(input).toHaveValue('Saved original prompt');await expect(input).toBeFocused();
 await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('Keep my current prompt');await page.keyboard.press('Escape');await page.reload();await expect(input).toHaveValue('Saved original prompt');await drafts.click();
 await page.getByRole('button',{name:'Delete draft Integration prompt',exact:true}).click();await page.getByRole('button',{name:'Delete draft',exact:true}).click();await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).not.toContainText('Integration prompt');
 expect(h.commands.filter(command=>command.type==='message.send')).toEqual([]);expect(h.unexpected).toEqual([]);
});

test('QA r1 actual App fences named libraries by thread account and working copy',async({page})=>{
 const h=await host(page),input=page.getByRole('textbox',{name:'Message',exact:true}),drafts=page.getByRole('button',{name:'Drafts',exact:true});
 await input.fill('Private local owner text');await drafts.click();await page.getByRole('button',{name:'Save current prompt',exact:true}).click();await page.getByLabel('Draft name',{exact:true}).fill('Owner library');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save prompt',exact:true})).toBeHidden();
 h.workingCopy.id='copy-two';await page.reload();await expect(drafts).toBeEnabled();await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('No saved drafts yet.');await page.keyboard.press('Escape');
 h.workingCopy.id='copy-one';h.snapshot.threads[0].accountId='other-account';await page.reload();await expect(drafts).toBeEnabled();await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('No saved drafts yet.');await page.keyboard.press('Escape');
 h.snapshot.threads[0].accountId=null;await page.reload();await expect(drafts).toBeEnabled();await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('Owner library');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Review keyboard navigation Ready',exact:true}).click();await expect(drafts).toBeEnabled();await drafts.click();await expect(page.getByRole('dialog',{name:'Saved drafts',exact:true})).toContainText('No saved drafts yet.');expect(h.commands.filter(command=>command.type==='message.send')).toEqual([]);expect(h.unexpected).toEqual([]);
});
