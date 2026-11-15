// Test-only spec: .pr-checks rendering with a populated statusCheckRollup and
// a stale-head note (local head differs from headRefOid). Route mocks reuse the
// shared-panels fixture surface (no gh CLI on this box for a live check list).
import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:404,json:{error:{message:'Unconfigured fixture request'}}}));
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{csrfToken:'fixture'}}));
 await page.route('**/api/projects/project-one/git?*',route=>route.fulfill({json:{head:'a'.repeat(40),revision:'c'.repeat(64),branch:'gen/review',mode:'managed',gitWrite:true,files:[],diff:'',stagedDiff:'',truncated:false}}));
 await page.route('**/api/projects/project-one/pull-requests?*',route=>route.fulfill({json:{repo:'fixture/project',items:[{number:12,title:'PR 12',url:'https://github.com/fixture/project/pull/12',state:'OPEN'}]}}));
});
const rollups:Record<string,unknown[]>={populated:[
 {name:'build',status:'COMPLETED',conclusion:'SUCCESS'},
 {name:'lint',status:'COMPLETED',conclusion:'FAILURE'},
 {name:'docs',status:'COMPLETED',conclusion:'SKIPPED'},
 {name:'e2e',status:'IN_PROGRESS',conclusion:null},
 {workflowName:'Deploy gate',status:'COMPLETED',conclusion:'NEUTRAL'},
],empty:[]};

for(const [label,checks] of Object.entries(rollups))test(`pull-request panel renders .pr-checks (${label} rollup)`,async({page},testInfo)=>{
 await page.route('**/api/projects/project-one/pull-requests/*?*',route=>route.fulfill({json:{item:{number:12,title:'PR 12',headRefOid:'b'.repeat(40),state:'OPEN',files:[],statusCheckRollup:checks},head:'a'.repeat(40),revision:'c'.repeat(64),canReview:true}}));
 await page.goto('/shared-panels-check?project=1&pr-panels=pull-request');
 const panel=page.getByRole('region',{name:'first PR panel'});
 await panel.getByRole('button',{name:'#12 PR 12',exact:true}).click();
 const prChecks=panel.locator('.pr-checks');
 await expect(prChecks).toBeVisible();
 await expect(prChecks).toContainText('Checks against bbbbbbbbbb');
 await expect(prChecks).toContainText('stale: working copy is at aaaaaaaaaa');
 if(label==='empty'){await expect(prChecks).toContainText('No checks reported for the tested head.');await expect(prChecks.locator('.pr-check-list li')).toHaveCount(0);}
 else{
  const items=prChecks.locator('.pr-check-list li');
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toHaveAttribute('data-state','pass');
  await expect(items.nth(0)).toContainText('build');
  await expect(items.nth(0).locator('small')).toHaveText('SUCCESS');
  await expect(items.nth(1)).toHaveAttribute('data-state','fail');
  await expect(items.nth(2)).toHaveAttribute('data-state','skipped');
  await expect(items.nth(3)).toHaveAttribute('data-state','pending');
  await expect(items.nth(3).locator('small')).toHaveText('IN_PROGRESS');
  await expect(items.nth(4)).toHaveAttribute('data-state','skipped');
  await expect(items.nth(4)).toContainText('Deploy gate');
  await prChecks.screenshot({path:testInfo.outputPath('pr-checks-populated.png')});
 }
});
