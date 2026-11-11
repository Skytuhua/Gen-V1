import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {createWorkspaceCanvas} from '../../packages/core/workspace-layout';
import {planDataId,PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const fixtureModule='/@fs/'+encodeURI(resolve(import.meta.dirname,'workspace-app-fixture.tsx').replaceAll('\\','/'));
async function fixture(page:Page){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Authored cleanup fixture'}}}});
 snapshot.artifacts=[];snapshot.userStates=[];snapshot.settings.theme='dark';snapshot.threads[0]={...snapshot.threads[0],title:'Original conversation',projectId:'project',projectName:'Original project'};
 snapshot.messages=[{id:'owner-message',threadId:'task-thread',role:'user',content:'Keep this original conversation readable while project details and live usage are expanded. '.repeat(3),runId:null,createdAt:'2026-11-04'}];
 snapshot.usage['task-thread']={inputTokens:1200,outputTokens:80,contextTokens:3000,contextWindow:100000,cost:0.002,activity:'idle',sessionPercent:null,weeklyPercent:null};
 const host=await serveTaskFixture(page,snapshot);
 await page.route('**/api/workspace',route=>route.fulfill({json:{projects:[{id:'project',name:'Original project',authority:{kind:'local'},createdAt:'2026-11-04'}],state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}}}}));
 await page.route('**/api/projects/project/context?*',route=>route.fulfill({json:{project:{id:'project',name:'Original project',authority:{kind:'local'},createdAt:'2026-11-04'},threadId:'task-thread',machineName:'Fixture',editor:{available:false,label:'Editor'},branch:null,head:null,changes:{added:null,removed:null,files:null},lineage:[{id:'previous',title:'Previous agent',status:'ready'}],scripts:[],capabilities:{git:false,terminal:false,pullRequests:false}}}));
 await page.route('**/compact-tools-check',route=>route.fulfill({contentType:'text/html',body:`<html><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureModule}');</script></html>`}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/compact-tools-check');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();return host;
}
test('expanded protected tools stay compact and clear the original conversation and composer',async({page})=>{
 await page.addInitScript(()=>{for(const id of ['plan','usage'])localStorage.setItem(`harness:floating:${id}:v1`,JSON.stringify({x:300,y:300,width:900,height:700,collapsed:false,floating:true}));});
 await fixture(page);
 const context=page.getByRole('region',{name:'Project context window',exact:true}),usage=page.getByRole('region',{name:'Live usage',exact:true});
 await expect(context).toHaveAttribute('data-collapsed','false');await expect(usage).toHaveAttribute('data-collapsed','false');
 const c=(await context.boundingBox())!,u=(await usage.boundingBox())!;
 expect(c.width).toBeLessThanOrEqual(280);expect(c.height).toBeLessThanOrEqual(270);expect(u.width).toBeLessThanOrEqual(248);expect(u.height).toBeLessThanOrEqual(145);
 const overlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
 const bubble=(await page.locator('.message-user>.message-content').boundingBox())!,composer=(await page.locator('.composer').boundingBox())!;
 expect(overlap(c,bubble)).toBe(false);expect(overlap(u,composer)).toBe(false);
 const workspace=(await page.locator('main.workspace').boundingBox())!,header=(await page.locator('.workspace-header').boundingBox())!;expect(header.width).toBe(workspace.width);
 await expect(context.getByRole('button',{name:/Close|Move|Resize|Detach/})).toHaveCount(0);await expect(usage.getByRole('button',{name:/Close|Move|Resize|Detach/})).toHaveCount(0);
 await page.screenshot({path:'.harness-ui-cleanup-20261104/compact-ui/expanded-desktop.png'});
 await context.getByRole('button',{name:'Minimize Project context',exact:true}).click();await usage.getByRole('button',{name:'Minimize live usage',exact:true}).click();expect(await page.locator('main.workspace').evaluate(node=>getComputedStyle(node).paddingRight)).toBe('0px');
});
test('only the sidebar owns collapse while the header preserves reopen and mobile access',async({page})=>{
 await fixture(page);const sidebar=page.getByRole('complementary',{name:'Thread navigation',exact:true}),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep this original draft');
 await expect(sidebar.getByRole('button',{name:'Collapse sidebar',exact:true})).toBeVisible();await expect(page.locator('.workspace-header .desktop-sidebar-toggle')).toHaveCount(0);
 await sidebar.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await page.getByRole('button',{name:'Open sidebar',exact:true}).click();await expect(sidebar.getByRole('button',{name:'Collapse sidebar',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(sidebar).toBeVisible();await sidebar.getByRole('button',{name:'Close navigation',exact:true}).click();await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeVisible();
 await expect(draft).toHaveValue('Keep this original draft');
});

for(const width of [1280,1100,960,700,390])test(`expanded tools leave chat usable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.addInitScript(()=>{for(const id of ['plan','usage'])localStorage.setItem(`harness:floating:${id}:v1`,JSON.stringify({x:0,y:0,width:900,height:700,collapsed:false,floating:true}));});
 await fixture(page);const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Still writing in the original chat');
 const context=page.getByRole('region',{name:'Project context window',exact:true}),usage=page.getByRole('region',{name:'Live usage',exact:true});
 for(const tool of [context,usage]){await expect(tool).toBeVisible();const rect=(await tool.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(rect.y+rect.height).toBeLessThanOrEqual(844);}
 const composer=(await page.locator('.composer').boundingBox())!,bubble=(await page.locator('.message-user>.message-content').boundingBox())!;
 for(const tool of [context,usage]){const rect=(await tool.boundingBox())!;for(const target of [composer,bubble])expect(rect.x>=target.x+target.width||rect.x+rect.width<=target.x||rect.y>=target.y+target.height||rect.y+rect.height<=target.y).toBe(true);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(draft).toHaveValue('Still writing in the original chat');
 await page.screenshot({path:`.harness-ui-cleanup-20261104/compact-ui/expanded-${width}.png`});
});

test('a ready long plan expands the compact context without taking draft focus',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true}),context=page.getByRole('region',{name:'Project context window',exact:true});
 await expect(context).toHaveAttribute('data-collapsed','true');await draft.fill('Keep writing as the plan arrives');await draft.focus();
 host.snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-04T00:00:00Z',value:{version:1,title:'Review the next steps',steps:Array.from({length:15},(_,i)=>({id:'step-'+i,title:`Review source step ${i+1}`,status:i===0?'working':'pending',requirements:[],agentIds:[]})),agents:[]}});
 await host.publish();await expect(context).toHaveAttribute('data-collapsed','false');await expect(context.getByText('Review source step 1',{exact:true})).toBeVisible();await expect(draft).toBeFocused();await expect(draft).toHaveValue('Keep writing as the plan arrives');
 expect((await context.boundingBox())!.height).toBeLessThanOrEqual(360);await context.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(context).toHaveAttribute('data-collapsed','true');await context.getByRole('button',{name:'Expand Project context',exact:true}).click();await expect(context).toHaveAttribute('data-collapsed','false');await context.getByText('Review source step 15',{exact:true}).scrollIntoViewIfNeeded();await expect(context.getByText('Review source step 15',{exact:true})).toBeVisible();
 await page.screenshot({path:'.harness-ui-cleanup-20261104/compact-ui/ready-plan.png'});
});

test('minimized tools leave the first message and composer clear without reserving a chat column',async({page})=>{
 await fixture(page);for(const width of [1280,1440]){
  await page.setViewportSize({width,height:1000});const context=(await page.getByRole('region',{name:'Project context window',exact:true}).boundingBox())!,usage=(await page.getByRole('region',{name:'Live usage',exact:true}).boundingBox())!,bubble=(await page.locator('.message-user>.message-content').boundingBox())!,composer=(await page.locator('.composer').boundingBox())!;
  for(const [tool,target] of [[context,bubble],[usage,composer]])expect(tool.x>=target.x+target.width||tool.x+tool.width<=target.x||tool.y>=target.y+target.height||tool.y+tool.height<=target.y).toBe(true);
  expect(await page.locator('main.workspace').evaluate(node=>getComputedStyle(node).paddingRight)).toBe('0px');
 }
 await page.screenshot({path:'.harness-ui-cleanup-20261104/compact-ui/minimized-desktop.png'});
});
