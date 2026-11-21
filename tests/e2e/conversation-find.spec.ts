import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {shellInit,shellRoute,shellSnapshot} from '../../scripts/capture-ui/shell-api';


import {scopedContext,scopedEnvelope,scopedMessage} from '../scoped-conversation-fixture';
import {serveTaskSplitLayout} from './task-interface-fixture';
async function setup(page:Page,count=3){
 const snapshot=shellSnapshot();snapshot.messages=Array.from({length:count},(_,i)=>({...snapshot.messages[0],id:'m'+i,content:i===0?'Review the **work**space, sidebar and composer.':i===1?'I reviewed the workspace and found two areas to check.':'The workspace panel starts closed.',role:i===0?'user':'assistant'}));
 await page.addInitScript(shellInit);await page.route('**/api/**',r=>shellRoute(r,snapshot,false));await serveTaskSplitLayout(page,snapshot);await page.goto('/fixture');await page.locator('.composer textarea').waitFor();return snapshot;
}
const phrase=(p:Page)=>p.getByRole('textbox',{name:'Find phrase'});
async function open(p:Page){await p.locator('.composer textarea').focus();await p.keyboard.press('Control+f');await expect(phrase(p)).toBeFocused();}
test('literal ranges cross formatting without modifying markup or copied code',async({page})=>{
 await setup(page);const before=await page.locator('.message-content').first().innerHTML();await open(page);await phrase(page).fill('workspace');await expect(page.getByRole('status').filter({hasText:'1 of 3'})).toBeVisible();
 expect(await page.locator('.message-content').first().innerHTML()).toBe(before);expect(await page.evaluate(()=>CSS.highlights.get('conversation-find-all')?.size)).toBe(3);
 await phrase(page).fill('[a].');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();await expect(page.getByLabel('Next match')).toBeDisabled();
});
test('find skips screen-reader-only labels without removing them from the transcript',async({page})=>{
 await setup(page);
 await page.locator('.message-content').first().evaluate(el=>{
  const role=document.createElement('span');role.className='sr-only';role.textContent='Assistant role label';el.prepend(role);
 });
 await open(page);
 await phrase(page).fill('Assistant role label');
 await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
 await expect(page.locator('.message-content .sr-only').first()).toHaveText('Assistant role label');
 await phrase(page).fill('workspace');
 await expect(page.getByRole('status').filter({hasText:'1 of 3'})).toBeVisible();
});
test('wraps both directions; Escape restores opener and draft caret',async({page})=>{
 await setup(page);const draft=page.locator('.composer textarea');await draft.fill('Retained draft workspace');await draft.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(3,3));await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');await expect(page.getByRole('status').filter({hasText:'2 of 3'})).toBeVisible();await page.keyboard.press('Shift+Enter');await page.keyboard.press('Shift+Enter');await expect(page.getByRole('status').filter({hasText:'3 of 3'})).toBeVisible();await page.keyboard.press('Escape');await expect(draft).toBeFocused();await expect(draft).toHaveValue('Retained draft workspace');expect(await draft.evaluate((el:HTMLTextAreaElement)=>el.selectionStart)).toBe(3);
});
test('ignores composing keyboard events',async({page})=>{
 await setup(page);await open(page);await phrase(page).fill('workspace');await phrase(page).dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.getByRole('status').filter({hasText:'1 of 3'})).toBeVisible();await phrase(page).dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(phrase(page)).toBeVisible();
});
test('extends loaded history beyond 100; keeps the selected range when older messages mount',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');await expect(page.getByRole('status').filter({hasText:'1 of 100'})).toBeVisible();await page.getByRole('button',{name:'Load older messages',exact:true}).click();await expect(page.locator('.message')).toHaveCount(125);await expect(page.getByRole('status').filter({hasText:'26 of 125'})).toBeVisible();await expect(page.getByText('Loaded messages',{exact:true})).toBeVisible();
});
test('scoped reader keeps partial scope and exposes real loading and retry errors',async({page})=>{
 let older=false,hold:()=>void=()=>{};let fail=false;const gate=new Promise<void>(resolve=>{hold=resolve;});await page.route('**/api/**',async r=>{const url=new URL(r.request().url());if(url.pathname==='/api/bootstrap')return r.fulfill({json:{csrfToken:'fixture'}});if(url.pathname.endsWith('/transcript')){if(url.searchParams.has('cursor')){await gate;older=true;if(fail)return r.fulfill({status:503,json:{error:{code:'UNAVAILABLE'}}});}return r.fulfill({json:{...scopedEnvelope,messages:[scopedMessage(older?'old':'m','workspace')],nextCursor:older?null:'older'}});}if(url.pathname.endsWith('/updates'))return r.fulfill({json:{...scopedEnvelope,fromSequence:scopedContext.sequence,owner:null,transcriptChanged:false}});return r.fulfill({json:scopedContext});});
 await page.goto('/fixture?scoped=1');await expect(page.locator('[data-message-id]')).toHaveCount(1);await page.getByLabel('Find in conversation',{exact:true}).click();await phrase(page).fill('workspace');await page.getByRole('search').getByText('Load older messages').click();await expect(page.getByRole('search').getByText('Loading older messages…')).toBeVisible();fail=true;hold();await expect(page.getByRole('search').getByRole('alert')).toContainText('Could not load');await expect(page.getByText('Loaded messages',{exact:true})).toBeVisible();
});
test('keyboard and reduced/off motion find paths are immediate at desktop and smoke widths',async({page},info)=>{
 await setup(page);await page.emulateMedia({reducedMotion:'reduce'});await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');
 const out=info.outputPath('screenshots');await mkdir(out,{recursive:true});
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:900});await expect(phrase(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.getByRole('search').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);await page.screenshot({path:`${out}/4-after-${width}.png`});}
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.style.setProperty('--ui-motion-scale','0');});await phrase(page).fill('no-matches');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
});

test('owner switch clears find and excluded composer text is never counted',async({page})=>{
 await setup(page);await page.locator('.composer textarea').fill('unique-draft-phrase');await open(page);await phrase(page).fill('unique-draft-phrase');await expect(page.getByRole('status').filter({hasText:'0 results'})).toBeVisible();
 await phrase(page).fill('workspace');await page.getByRole('button',{name:/^Review keyboard navigation, Ready/}).click();await expect(phrase(page)).toBeHidden();expect(await page.evaluate(()=>CSS.highlights.get('conversation-find-all')?.size??0)).toBe(0);
});
test('retains active match and reading position on rendered background additions',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');await page.keyboard.press('Enter');const top=await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop);
 await page.locator('.conversation').evaluate(el=>{const message=document.createElement('div');message.className='message';message.innerHTML='<div class="message-content">New workspace update</div>';el.append(message);});
 await expect(page.getByRole('status').filter({hasText:'2 of 101'})).toBeVisible();expect(await page.locator('.conversation-scroll').evaluate(el=>el.scrollTop)).toBe(top);
});

test('Enter activates the focused previous, close and history buttons',async({page})=>{
 await setup(page,125);await open(page);await phrase(page).fill('workspace');
 await page.getByRole('button',{name:'Previous match',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('status').filter({hasText:'100 of 100'})).toBeVisible();
 await page.getByRole('button',{name:'Load older messages',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.message')).toHaveCount(125);
 await page.getByRole('button',{name:'Close find',exact:true}).focus();await page.keyboard.press('Enter');await expect(phrase(page)).toBeHidden();
});
test('Escape and Close restore the rendered Find trigger',async({page})=>{
 await setup(page);const trigger=page.getByRole('button',{name:'Find in conversation',exact:true});await trigger.focus();await page.keyboard.press('Enter');await expect(phrase(page)).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close find',exact:true}).click();await expect(trigger).toBeFocused();
});
