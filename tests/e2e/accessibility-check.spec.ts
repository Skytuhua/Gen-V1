import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {AUDIT_RUNNER} from '../../apps/desktop/accessibility-audit.ts';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import type {HostCommand} from '../../packages/contracts';

const require=createRequire(import.meta.url);
const AXE_PATH=require.resolve('axe-core/axe.min.js');
const VIOLATIONS_PAGE=resolve(import.meta.dirname,'fixtures/a11y-violations.html');
const RECORDED=resolve(import.meta.dirname,'../fixtures/axe-violations-4.14.json');
const SHOTS=resolve(import.meta.dirname,'../fixtures/a11y-shots');

const BROWSER_STATE={url:'https://app.example.com/dashboard',title:'Fixture app',canGoBack:false,canGoForward:false,loading:false};
const RULE_IMAGE={ruleId:'image-alt',impact:'critical',help:'Images must have alternative text',description:'img missing alt',helpUrl:'https://dequeuniversity.com/rules/axe/4.14/image-alt',wcag:['wcag111','wcag2a'],nodeCount:1,nodes:[{target:'img',html:'<img src="data:...">',failureSummary:'Fix any of the following: Element does not have an alt attribute'}]};
const RULE_CONTRAST={ruleId:'color-contrast',impact:'serious',help:'Elements must meet minimum color contrast ratio thresholds',description:'insufficient contrast',helpUrl:'https://dequeuniversity.com/rules/axe/4.14/color-contrast',wcag:['wcag143','wcag2aa'],nodeCount:2,nodes:[{target:'p.low',html:'<p class="low">Low contrast</p>',failureSummary:'Element has insufficient color contrast of 1.5'},{target:'p.dim',html:'<p class="dim">Dim text</p>',failureSummary:'Element has insufficient color contrast of 2.1'}]};
const result=(overrides:Record<string,unknown>={})=>({status:'completed',target:{kind:'browser',url:BROWSER_STATE.url,title:BROWSER_STATE.title},viewport:{width:1440,height:900},axeVersion:'4.14.1',standard:'WCAG 2.2 A/AA',startedAt:'2026-11-21T12:00:00.000Z',durationMs:410,counts:{critical:1,serious:1,moderate:0,minor:0},elementCount:3,rules:[RULE_IMAGE,RULE_CONTRAST],blockedRequests:0,truncated:false,...overrides});

/** Synthetic desktop bridge: the dock has a loaded page; audit runs resolve when the test pushes an outcome. */
async function bridge(page:Page,surface:Record<string,unknown>={kind:'main'}){
 await page.addInitScript(value=>{
  const w=window as unknown as Record<string,any>,windowId=value.kind==='main'?'main':'browser-window';
  const windows=[{id:'main',surface:{kind:'main'},ready:true,minimized:false},...(windowId==='main'?[]:[{id:windowId,surface:value,ready:true,minimized:false}])];
  const docked={browserId:'browser-1',state:{url:'https://app.example.com/dashboard',title:'Fixture app',canGoBack:false,canGoForward:false,loading:false}};
  const context=()=>({windowId,surface:value,windows,...(value.kind==='main'?{dockedBrowser:docked}:{browser:docked.state})});
  w.__audit={calls:[],resolve:null,outcomes:[...((value as any).outcomes??[])]};
  w.harnessDesktop={getContext:async()=>context(),ready:async()=>context(),list:async()=>windows,
   onState:(fn:(state:any)=>void)=>{w.__desktopState=fn;return()=>{};},
   onCloseRequested:()=>()=>{},
   detach:async()=>({}),reattach:async()=>{},minimize:async()=>{},resetBounds:async()=>{},focus:async()=>{},
   browser:async()=>{},
   accessibilityAudit:async(command:any)=>{
    w.__audit.calls.push(command);
    if(command.type==='capability')return{available:w.__audit.capable!==false};
    if(command.type==='cancel'){const resolve=w.__audit.resolve;w.__audit.resolve=null;resolve?.({status:'cancelled'});return {};}
    return await new Promise(res=>{w.__audit.resolve=res;if(w.__audit.outcomes.length)w.__audit.resolve(w.__audit.outcomes.shift());});
   }};
 },surface);
}

const capability=(page:Page,available=true)=>page.route('**/api/browser/accessibility-audit/capability',route=>route.fulfill({json:{available}}));
const fixture=()=>taskFixture({root:'field',elements:{field:{type:'Input',props:{stateKey:'name',label:'Review name'}}}});
const settle=(page:Page,outcome:unknown)=>page.evaluate(value=>{(window as any).__audit.resolve?.(value);},outcome);
const shot=async(page:Page,name:string)=>{mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:resolve(SHOTS,name+'.png')});};

test('real axe reports exactly the fixture violations and the raw output is recorded',async({page})=>{
 await page.goto('file://'+VIOLATIONS_PAGE);
 await page.addScriptTag({path:AXE_PATH});
 const started=Date.now();
 const raw=await page.evaluate(`(${AUDIT_RUNNER})`) as {version:string;url:string;title:string;width:number;height:number;violations:{id:string}[]};
 const elapsed=Date.now()-started;
 expect(raw.version).toBe('4.14.1');
 expect(raw.violations.map(rule=>rule.id).sort()).toEqual(['button-name','color-contrast','html-has-lang','image-alt','label']);
 expect(elapsed,'axe run must finish well under the 15 s acceptance').toBeLessThan(15000);
 console.log(`axe fixture run: ${elapsed}ms`);
 mkdirSync(resolve(RECORDED,'..'),{recursive:true});
 writeFileSync(RECORDED,JSON.stringify(raw,null,2)+'\n');
});

async function openDocked(page:Page){
 await serveTaskFixture(page,fixture());
 await capability(page);
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Accessibility check',exact:true})).toBeVisible({timeout:15000});
}

test('flow 1: menu, check this page, results, expand, fix in thread',async({page})=>{
 await bridge(page);await openDocked(page);
 const commands:HostCommand[]=[];
 await page.route('**/api/commands',route=>{const command=route.request().postDataJSON() as HostCommand;commands.push(command);void route.fulfill({json:{commandId:command.id,seq:2,result:{}}});});
 // ≤2 interactions to results: Accessibility check -> Check this page.
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await expect(page.getByText('Running checks…',{exact:true})).toBeVisible();
 await shot(page,'running');
 await settle(page,result());
 await expect(page.getByText('2 issues on 3 elements',{exact:true})).toBeVisible();
 await expect(page.locator('.a11y-chips .a11y-badge-critical')).toHaveText('1 Critical');
 await expect(page.locator('.a11y-chips .a11y-badge-serious')).toHaveText('1 Serious');
 await shot(page,'results-collapsed');
 await page.getByRole('button',{name:'Expand color-contrast',exact:true}).click();
 await expect(page.getByRole('button',{name:'Collapse color-contrast',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(page.getByText('p.low',{exact:true})).toBeVisible();
 await expect(page.locator('li',{has:page.getByRole('button',{name:'Collapse color-contrast',exact:true})}).getByRole('link',{name:'Learn more'})).toHaveAttribute('href','https://dequeuniversity.com/rules/axe/4.14/color-contrast');
 await shot(page,'rule-expanded');
 // One more interaction: Fix in thread.
 await page.getByRole('button',{name:'Fix in thread',exact:true}).click();
 await expect.poll(()=>commands.map(command=>command.type)).toContain('message.send');
 const send=commands.find(command=>command.type==='message.send')!;
 expect(send.threadId).toBe('task-thread');
 expect((send.payload as {content:string}).content.startsWith('Fix these accessibility issues found by an automated WCAG 2.2 A/AA check (axe-core 4.14.1)')).toBe(true);
 await expect(page.getByRole('status').filter({hasText:'Sent to Source-bound task fixture'})).toBeVisible();
});

test('flows are completable keyboard-only',async({page})=>{
 await bridge(page);await openDocked(page);
 const button=page.getByRole('button',{name:'Accessibility check',exact:true});
 await button.focus();await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menu',{name:'Accessibility check',exact:true})).toBeVisible();
 await page.keyboard.press('Enter'); // Check this page is the first item
 await settle(page,result());
 await expect(page.getByText('2 issues on 3 elements',{exact:true})).toBeVisible();
 // Tab to a rule disclosure, expand it, then reach Fix in thread.
 await page.getByRole('button',{name:'Expand image-alt',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Collapse image-alt',exact:true})).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Fix in thread',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('status').filter({hasText:'Sent to'})).toBeVisible();
});

test('flow 2: local app dialog validates, remembers and runs a local check',async({page})=>{
 await bridge(page);await openDocked(page);
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check a local app…',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 await shot(page,'local-dialog');
 await dialog.getByLabel('Local app address', {exact:true}).fill('https://public.example.com/app');
 await dialog.getByRole('button',{name:'Check',exact:true}).click();
 await expect(dialog.getByText('Use a localhost address. Public pages can be checked from the browser with Check this page.')).toBeVisible();
 await dialog.getByLabel('Local app address',{exact:true}).fill('http://localhost:5173/');
 await dialog.getByRole('button',{name:'Check',exact:true}).click();
 await expect(dialog).toBeHidden();
 await expect(page.getByText('Loading page…',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).__audit.calls.at(-1))).toEqual({type:'run',target:{kind:'local',url:'http://localhost:5173/',viewport:'desktop'}});
 // Cancel stops within the UI and reports the state.
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByText('Check cancelled.',{exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).__audit.calls.map((call:any)=>call.type))).toContain('cancel');
 // The URL is remembered per project and prefilled.
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check a local app…',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('Local app address',{exact:true})).toHaveValue('http://localhost:5173/');
});

test('empty, error and check again states',async({page})=>{
 await bridge(page);await openDocked(page);
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result({counts:{critical:0,serious:0,moderate:0,minor:0},elementCount:0,rules:[]}));
 await expect(page.getByText('No WCAG A or AA violations found by automated checks.',{exact:true})).toBeVisible();
 await expect(page.getByText('Automated checks find some issues, not all. Test with a keyboard and a screen reader too.',{exact:true})).toBeVisible();
 await shot(page,'empty');
 // Check again re-runs the same target.
 await page.getByRole('button',{name:'Check again',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__audit.calls.filter((call:any)=>call.type==='run').length)).toBe(2);
 await settle(page,{status:'failed',code:'LOAD_FAILED',message:"Couldn't load https://app.example.com/dashboard: ERR_CONNECTION_REFUSED. Is the dev server running?"});
 await expect(page.getByRole('alert')).toContainText('Is the dev server running?');
 await shot(page,'error');
 // Retry from the error runs the same target a third time.
 await page.getByRole('complementary',{name:'Accessibility',exact:true}).getByRole('button',{name:'Retry',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__audit.calls.filter((call:any)=>call.type==='run').length)).toBe(3);
});

test('no button when the flag is off, and no bridge calls are made',async({page})=>{
 await bridge(page);
 await serveTaskFixture(page,fixture());
 await capability(page,false);
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Accessibility check',exact:true})).toHaveCount(0);
 await page.waitForTimeout(300);
 expect(await page.evaluate(()=>(window as any).__audit.calls.length)).toBe(0); // flag off: no audit IPC traffic
});

test('detached browser surface fixes stay disabled without a thread',async({page})=>{
 await bridge(page,{kind:'browser',browserId:'browser-1'});
 await serveTaskFixture(page,fixture());
 await capability(page);
 await page.goto('/');
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result());
 const fix=page.getByRole('button',{name:'Fix in thread',exact:true});
 await expect(fix).toBeDisabled();
 await expect(fix).toHaveAttribute('title','Open a thread to send fixes');
});

test('panel shrinks the slot and never overlaps it; bottom layout under 720px',async({page})=>{
 await bridge(page);await openDocked(page);
 const slot=page.locator('.a11y-browser-slot');
 const before=(await slot.boundingBox())!;
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result());
 const panel=page.locator('.a11y-panel');
 await expect(panel).toBeVisible();
 // The dock (~520px) is under the 720px container breakpoint, so the panel
 // stacks below the slot and the slot shrinks vertically without overlap.
 const after=(await slot.boundingBox())!;
 const panelBox=(await panel.boundingBox())!;
 expect(after.height).toBeLessThan(before.height);
 expect(panelBox.y).toBeGreaterThan(after.y+after.height-1);
 await shot(page,'narrow-bottom');
 // A wide detached surface gets the side-by-side layout instead.
 await page.setViewportSize({width:1100,height:800});
 await bridge(page,{kind:'browser',browserId:'browser-2'});
 await page.goto('/');
 await expect(page.locator('.a11y-browser-slot')).toBeVisible();
 const wideSlot=page.locator('.a11y-browser-slot');
 const wideBefore=(await wideSlot.boundingBox())!;
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result());
 const wideAfter=(await wideSlot.boundingBox())!;
 const widePanelBox=(await page.locator('.a11y-panel').boundingBox())!;
 expect(wideAfter.width).toBeLessThan(wideBefore.width);
 expect(wideBefore.width-wideAfter.width).toBeCloseTo(widePanelBox.width,0);
 expect(wideAfter.x+wideAfter.width).toBeLessThanOrEqual(widePanelBox.x+0.5); // no overlap
});

test('reduced motion removes transitions and transforms',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await bridge(page);await openDocked(page);
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result());
 const probe=await page.locator('.a11y-rule').first().evaluate(element=>{
  const style=getComputedStyle(element);
  return{duration:parseFloat(style.transitionDuration)||0,animation:style.animationName,transform:style.transform};
 });
 expect(probe.duration).toBeLessThanOrEqual(0.08);
 expect(probe.animation).toBe('none');
 expect(probe.transform).toBe('none');
});

test('screenshots: light and dark results',async({page})=>{
 await bridge(page);await openDocked(page);
 await page.getByRole('button',{name:'Accessibility check',exact:true}).click();
 await page.getByRole('menuitem',{name:'Check this page',exact:true}).click();
 await settle(page,result());
 await expect(page.getByText('2 issues on 3 elements',{exact:true})).toBeVisible();
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
 await shot(page,'results-light');
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
 await shot(page,'results-dark');
});
