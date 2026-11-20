import {test,expect,type Page} from '@playwright/test';
import {serveChatFixture} from './chat-view-modes-fixture';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../../packages/core/split-workspace-layout';

// The retired full/drawer/pop-up ChatView geometry is replaced by the canonical split
// plane (T02/T03). These tests preserve the original intent — one live conversation body
// whose composer, draft, selection, reading position and focus survive layout changes —
// against real durable pane placement instead of the removed overlay modes.
test.use({viewport:{width:1600,height:1000}});
const view=(page:Page)=>page.locator('[data-split-view="thread:task-thread"]');
const input=(page:Page)=>view(page).getByRole('textbox',{name:'Message',exact:true});
// Baseline and candidate both exceeded five seconds loading the dev app; this is startup readiness, not a geometry wait.
async function open(page:Page,long=false){await serveChatFixture(page,long);await page.goto('/');await expect(input(page)).toBeEnabled({timeout:15000});}

test('the conversation lives in the split plane with its messages, composer and attachments',async({page})=>{
 await open(page,true);
 await expect(page.locator('.split-workspace')).toBeVisible();
 await expect(view(page).getByText('Help me keep this conversation close while I work.')).toBeVisible();
 await expect(page.getByRole('group',{name:'Attachments',exact:true})).toContainText('notes.txt');
 await expect(input(page)).toBeEnabled();
});

for(const presentation of ['floating','docked'] as const)test(`/model opens the picker in a ${presentation} secondary conversation`,async({page},info)=>{
 const host=await serveChatFixture(page);
 let owner='task-thread';
 if(presentation==='docked'){
  owner='secondary-thread';host.snapshot.threads.push({...host.snapshot.threads[0],id:owner,title:'Secondary conversation'});
  let layout=createSplitWorkspaceLayout();
  layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'thread:task-thread',kind:'thread',binding:{authority:{kind:'local'},threadId:'task-thread'}}});
  layout=applySplitWorkspaceCommand(layout,'pane.split',{paneId:'pane-main',newPaneId:'secondary',splitId:'columns',axis:'horizontal',view:{id:'thread:'+owner,kind:'thread',binding:{authority:{kind:'local'},threadId:owner}}});
  await page.route('**/api/split-workspace?*',route=>route.fulfill({json:layout}));
  await page.route('**/api/split-workspace/commands',route=>{const command=route.request().postDataJSON();layout=applySplitWorkspaceCommand(layout,command.type.replace(/^split-workspace\./,''),command.payload);return route.fulfill({json:{commandId:command.id,eventSeq:host.snapshot.seq,result:layout}});});
 }
 await page.goto('/');
 const conversation=page.locator(`[data-split-view="thread:${owner}"]`),composer=conversation.getByRole('textbox',{name:'Message',exact:true});
 await expect(composer).toBeEnabled({timeout:15000});
 if(presentation==='floating'){
  await page.getByRole('button',{name:'Move chat',exact:true}).click();await page.getByRole('menuitem',{name:'Float',exact:true}).click();
  await expect(conversation).toHaveAttribute('data-floating','true');
 }
 await expect(conversation.locator('.composer-toolbar')).toHaveCount(0);
 await composer.fill('/model');await expect(page.getByRole('option',{name:'/model Choose a model',exact:true})).toBeVisible();await composer.press('Enter');
 const search=page.getByRole('searchbox',{name:'Search models',exact:true});await expect(search).toBeVisible();await expect(composer).toHaveValue('');
 await page.screenshot({path:info.outputPath(`${presentation}-model-picker.png`)});
 await search.press('Escape');await expect(search).toBeHidden();await expect(conversation.getByRole('combobox',{name:'Model',exact:true})).toBeFocused();
});

test('draft, selection and reading position survive the workspace panel opening',async({page})=>{
 await open(page,true);
 await input(page).fill('Keep this draft and its selection');
 await page.evaluate(()=>{
  const scope=document.querySelector('[data-split-view="thread:task-thread"]')!;
  const textarea=scope.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;textarea.setSelectionRange(5,9);
  const scroll=scope.querySelector<HTMLElement>('.conversation-scroll')!;scroll.scrollTop=140;
  Object.assign(window,{chatNodes:{textarea,scroll,composer:scope.querySelector('.composer'),message:scope.querySelector('.message')}});
 });
 await page.getByRole('button',{name:'Open panel',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'Workspace panel',exact:true})).toBeVisible();
 await expect(input(page)).toHaveValue('Keep this draft and its selection');
 const state=await page.evaluate(()=>{
  const nodes=(window as unknown as {chatNodes:{textarea:HTMLTextAreaElement;scroll:HTMLElement;composer:Element;message:Element}}).chatNodes;
  const scope=document.querySelector('[data-split-view="thread:task-thread"]')!;
  return {same:nodes.textarea===scope.querySelector('textarea[aria-label="Message"]')&&nodes.scroll===scope.querySelector('.conversation-scroll')&&nodes.composer===scope.querySelector('.composer')&&nodes.message===scope.querySelector('.message'),top:nodes.scroll.scrollTop,selection:[nodes.textarea.selectionStart,nodes.textarea.selectionEnd]};
 });
 expect(state.same).toBe(true);expect(state.top).toBeCloseTo(140,0);expect(state.selection).toEqual([5,9]);
});

test('reduced motion settles instantly and keyboard focus stays in the composer',async({page})=>{
 await open(page);
 await page.emulateMedia({reducedMotion:'reduce'});
 await input(page).focus();
 await expect(input(page)).toBeFocused();
 await expect.poll(()=>view(page).evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
});
