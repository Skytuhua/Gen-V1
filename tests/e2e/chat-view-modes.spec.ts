import {test,expect,type Page} from '@playwright/test';
import {serveChatFixture} from './chat-view-modes-fixture';
import {CHAT_LAYOUT_KEY,type ChatMode} from '../../packages/ui-shell/chat-layout';

const names={full:'Full page',drawer:'Side drawer',popup:'Pop-up'};
const panel=(page:Page)=>page.getByRole('main',{name:'Chat',exact:true});
const input=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
async function open(page:Page,long=false){await serveChatFixture(page,long);await page.goto('/');await expect(input(page)).toBeEnabled();}
async function mode(page:Page,value:ChatMode){
 await page.getByRole('button',{name:'Switch layout',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:names[value],exact:true}).click();
 await expect(panel(page)).toHaveAttribute('data-chat-mode',value);
 await expect.poll(()=>panel(page).evaluate(element=>element.getAnimations().filter(effect=>effect.playState==='running'||effect.playState==='paused').map(effect=>({state:effect.playState,time:effect.currentTime})))).toEqual([]);
}
async function drag(page:Page,label:string,dx:number,dy:number,release=true){
 const box=await page.getByRole('button',{name:label,exact:true}).boundingBox();if(!box)throw Error('Missing handle '+label);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:12});if(release)await page.mouse.up();
}
async function bounds(page:Page){const box=await panel(page).boundingBox();if(!box)throw Error('Missing chat');return box;}

for(const from of ['full','drawer','popup'] as const)for(const to of ['full','drawer','popup'] as const){
 if(from===to)continue;
 test(`${from} → ${to} keeps the live composer, draft, selection, messages, attachments and scroll`,async({page})=>{
  await open(page,true);
  await mode(page,from);await input(page).fill('Keep this draft and its selection');
  await page.evaluate(()=>{
   const textarea=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;textarea.setSelectionRange(5,9);
   const scroll=document.querySelector<HTMLElement>('.conversation-scroll')!;scroll.scrollTop=140;
   Object.assign(window,{chatNodes:{textarea,scroll,composer:document.querySelector('.composer'),message:document.querySelector('.message')}});
  });
  await mode(page,to);await expect(page.getByRole('group',{name:'Attachments',exact:true})).toContainText('notes.txt');await expect(input(page)).toHaveValue('Keep this draft and its selection');await expect(input(page)).toBeFocused();
  const state=await page.evaluate(()=>{
   const nodes=(window as unknown as {chatNodes:{textarea:HTMLTextAreaElement;scroll:HTMLElement;composer:Element;message:Element}}).chatNodes;
   return {same:nodes.textarea===document.querySelector('textarea[aria-label="Message"]')&&nodes.scroll===document.querySelector('.conversation-scroll')&&nodes.composer===document.querySelector('.composer')&&nodes.message===document.querySelector('.message'),top:nodes.scroll.scrollTop,selection:[nodes.textarea.selectionStart,nodes.textarea.selectionEnd]};
  });
  expect(state.same).toBe(true);expect(state.top).toBeCloseTo(140,0);expect(state.selection).toEqual([5,9]);
 });
}
test('keyboard menu, checked state, Escape, shortcut and pop-up expand keep focus in chat',async({page})=>{
 await open(page);const trigger=page.getByRole('button',{name:'Switch layout',exact:true});await trigger.focus();await trigger.press('ArrowDown');
 await expect(page.getByRole('menuitemcheckbox',{name:'Full page',exact:true})).toHaveAttribute('aria-checked','true');
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(panel(page)).toHaveAttribute('data-chat-mode','drawer');await expect(input(page)).toBeFocused();
 await input(page).press('Control+Shift+L');await expect(panel(page)).toHaveAttribute('data-chat-mode','popup');
 await page.getByRole('button',{name:'Dock chat to side drawer'}).focus();await page.keyboard.press('Enter');
 await expect(panel(page)).toHaveAttribute('data-chat-mode','drawer');await expect(input(page)).toBeFocused();
});
test('rapid switching retargets from the visible rect and reduced motion settles instantly, including mid-flight',async({page})=>{
 await open(page);
 await page.getByRole('button',{name:'Switch layout',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Side drawer',exact:true}).click();
 await input(page).press('Control+Shift+L');await expect(panel(page)).toHaveAttribute('data-chat-mode','popup');
 await page.emulateMedia({reducedMotion:'reduce'});await mode(page,'full');await mode(page,'drawer');
 expect(await panel(page).evaluate(element=>element.getAnimations().length)).toBe(0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'Switch layout',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Pop-up',exact:true}).click();
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>panel(page).evaluate(element=>element.getAnimations().length)).toBe(0);
});
for(const value of ['drawer','popup'] as const)test(`${value} edge/corner resize tracks via transform, clamps, and remembers its own size`,async({page})=>{
 await open(page);await mode(page,value);const before=await bounds(page),layoutWidth=await panel(page).evaluate(element=>(element as HTMLElement).style.width);
 await drag(page,'Resize chat left',-72,0,false);await expect(panel(page)).toHaveAttribute('data-tracking','true');
 expect(await panel(page).evaluate(element=>(element as HTMLElement).style.width)).toBe(layoutWidth);
 expect((await bounds(page)).width).toBeCloseTo(before.width+72,0);await page.mouse.up();
 const edge=await bounds(page);await drag(page,'Resize chat top left',-40,40);const corner=await bounds(page);
 expect(corner.width).toBeCloseTo(edge.width+40,0);expect(corner.height).toBeCloseTo(edge.height-40,0);
 await mode(page,value==='drawer'?'popup':'drawer');await mode(page,value);expect((await bounds(page)).width).toBeCloseTo(corner.width,0);
 await page.reload();await expect(input(page)).toBeEnabled();expect((await bounds(page)).width).toBeCloseTo(corner.width,0);
 await page.getByRole('button',{name:'Resize chat left',exact:true}).focus();await page.keyboard.press('Shift+ArrowLeft');expect((await bounds(page)).width).toBeCloseTo(corner.width+32,0);
 await drag(page,'Resize chat top left',-5000,-5000);const clamped=await bounds(page);expect(clamped.x).toBeGreaterThanOrEqual(20);expect(clamped.y).toBeGreaterThanOrEqual(20);expect(clamped.width).toBeLessThanOrEqual(1400);
 await drag(page,'Resize chat top left',5000,5000);const minimum=await bounds(page);expect(minimum.width).toBe(320);expect(minimum.height).toBe(300);
});
test('header drag is 1:1, stores position, cancels cleanly, and snaps to the dock target',async({page})=>{
 await open(page);await mode(page,'popup');const before=await bounds(page);
 await drag(page,'Move chat panel',-220,-100);const moved=await bounds(page);expect(moved.x).toBeCloseTo(before.x-220,0);expect(moved.y).toBeCloseTo(before.y-100,0);
 await page.reload();await expect(input(page)).toBeEnabled();expect((await bounds(page)).x).toBeCloseTo(moved.x,0);
 await drag(page,'Move chat panel',-80,-40,false);await page.keyboard.press('Escape');await page.mouse.up();expect((await bounds(page)).x).toBeCloseTo(moved.x,0);
 await page.getByRole('button',{name:'Move chat panel',exact:true}).focus();await page.keyboard.press('Shift+ArrowLeft');expect((await bounds(page)).x).toBeCloseTo(moved.x-32,0);
 const handle=await page.getByRole('button',{name:'Move chat panel',exact:true}).boundingBox();if(!handle)throw Error('No header');
 await page.mouse.move(handle.x+12,handle.y+12);await page.mouse.down();await page.mouse.move(1420,150,{steps:15});
 await expect(page.locator('.chat-dock-target')).toHaveAttribute('data-active','true');await page.mouse.up();
 await expect(panel(page)).toHaveAttribute('data-chat-mode','drawer');await expect(panel(page)).toHaveAttribute('data-detached','false');
});
test('detach/dock button and keyboard paths preserve the live draft and drawer size',async({page})=>{
 await open(page);await input(page).fill('This draft travels with me');await mode(page,'drawer');await drag(page,'Resize chat left',-64,0);const drawer=await bounds(page);
 await page.getByRole('button',{name:'Detach chat',exact:true}).click();await expect(panel(page)).toHaveAttribute('data-chat-mode','popup');await expect(input(page)).toHaveValue('This draft travels with me');
 await page.getByRole('button',{name:'Dock chat to side drawer'}).click();await expect.poll(async()=>Math.round((await bounds(page)).width)).toBe(Math.round(drawer.width));
 await page.getByRole('button',{name:'Detach chat',exact:true}).focus();await page.keyboard.press('Enter');await expect(input(page)).toBeFocused();
 await page.getByRole('button',{name:'Dock chat to side drawer'}).focus();await page.keyboard.press('Enter');await expect(input(page)).toBeFocused();
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).mode,CHAT_LAYOUT_KEY)).toBe('drawer');
});
for(const width of [1440,1024,768])test(`every mode fits ${width}px and stays usable after viewport shrink`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);
 for(const value of ['drawer','popup','full'] as const){
  await mode(page,value);const rect=await bounds(page);expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(rect.y+rect.height).toBeLessThanOrEqual(900);
  await expect(input(page)).toBeVisible();await expect(page.getByRole('button',{name:'Switch layout',exact:true})).toBeInViewport();
 }
 await mode(page,'popup');await page.setViewportSize({width:768,height:420});await expect.poll(async()=>Math.round((await bounds(page)).y+(await bounds(page)).height)).toBeLessThanOrEqual(400);
});

test('a pointer transition retargets exactly from its visible bounds and animates only transform',async({page})=>{
 await page.addInitScript(()=>{
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(...args){const effect=animate.apply(this,args);if(this.matches('.chat-view-surface')){effect.pause();effect.currentTime=0;}return effect;};
 });
 await open(page);await page.getByRole('button',{name:'Switch layout',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Side drawer',exact:true}).click();
 await panel(page).evaluate(element=>{element.getAnimations()[0].currentTime=120;});const before=await bounds(page);
 await page.getByRole('button',{name:'Switch layout',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Pop-up',exact:true}).click();const after=await bounds(page);
 for(const key of ['x','y','width','height'] as const)expect(after[key]).toBeCloseTo(before[key],0);
 const effect=await panel(page).evaluate(element=>{const animation=element.getAnimations()[0];return {duration:animation.effect!.getTiming().duration,keys:Object.keys((animation.effect as KeyframeEffect).getKeyframes()[0])};});
 expect(effect.duration).toBe(360);expect(effect.keys.filter(key=>!['offset','computedOffset','easing','composite'].includes(key))).toEqual(['transform']);
 await panel(page).evaluate(element=>element.getAnimations()[0].finish());
});

test('pointer cancellation rolls back a resize and writes no in-flight preference',async({page})=>{
 await open(page);await mode(page,'popup');const before=await bounds(page),saved=await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY);
 await drag(page,'Resize chat left',-120,0,false);expect(await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY)).toBe(saved);
 await page.getByRole('button',{name:'Resize chat left',exact:true}).evaluate(element=>element.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
 await page.mouse.up();const after=await bounds(page);expect(after.width).toBeCloseTo(before.width,0);expect(after.x).toBeCloseTo(before.x,0);
});

test('dragging the docked header detaches it and the dock button restores its right anchor',async({page})=>{
 await open(page);await mode(page,'drawer');const before=await bounds(page),header=panel(page).locator('.chat-view-header');
 const box=await header.boundingBox();if(!box)throw Error('Missing header');
 await page.mouse.move(box.x+60,box.y+22);await page.mouse.down();await page.mouse.move(box.x-140,box.y+22,{steps:10});await page.mouse.up();
 await expect(panel(page)).toHaveAttribute('data-detached','true');expect((await bounds(page)).x).toBeCloseTo(before.x-200,0);
 await page.getByRole('button',{name:'Dock chat to side drawer'}).click();await expect.poll(async()=>Math.round((await bounds(page)).x)).toBe(Math.round(before.x));
});

test('blocked preference storage keeps every mode and resize usable',async({page})=>{
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('blocked');};Storage.prototype.setItem=()=>{throw Error('blocked');};});
 await open(page);await mode(page,'popup');await drag(page,'Resize chat left',-60,0);expect((await bounds(page)).width).toBe(410);await mode(page,'drawer');await mode(page,'full');
});
