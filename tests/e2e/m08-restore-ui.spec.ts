// Test-only spec: exercises the FileCheckpoints restore confirm/apply/conflict
// rendering with a stub adapter whose restore seam works and returns
// client-schema-shaped payloads. The live path could not reach this UI during
// M08 testing (see report: readRestorePlan strict-schema mismatch).
import {expect,test} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const review=async(page:import('@playwright/test').Page,mode='working')=>{
 await page.goto('/m08-restore?mode='+mode);
 await page.getByRole('button',{name:'Review Before a guarded file edit',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to History'})).toBeFocused();
 await expect(page.getByText('checkpoint-original').first()).toBeVisible();
};

test('plan shows confirmation with planned paths; cancel resets; confirm applies',async({page})=>{
 await review(page);
 const button=page.getByRole('button',{name:'Restore selected files',exact:true});
 await expect(button).toBeDisabled();
 await page.getByRole('checkbox',{name:'notes.txt',exact:true}).check();
 await page.getByRole('checkbox',{name:'docs/info.md',exact:true}).check();
 await expect(button).toBeEnabled();
 await button.click();
 const confirm=page.getByRole('region',{name:'Confirm file restore'});
 await expect(confirm).toBeVisible();
 await expect(confirm).toContainText('Restore 2 files from this checkpoint?');
 await expect(confirm.locator('li',{hasText:'notes.txt'})).toBeVisible();
 await expect(confirm.locator('li',{hasText:'docs/info.md'})).toBeVisible();
 await expect(page.locator('.__restoreCalls')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__restoreCalls.map((c:{kind:string})=>c.kind))).toEqual(['plan']);
 // Cancel resets back to the review with selection kept.
 await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('region',{name:'Confirm file restore'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Restore selected files',exact:true})).toBeEnabled();
 // Confirm applies and shows the APPLIED result.
 await page.getByRole('button',{name:'Restore selected files',exact:true}).click();
 await page.getByRole('button',{name:'Confirm restore',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Restore complete',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Checkpoint restore result'})).toContainText('APPLIED');
 await expect(page.locator('.file-checkpoints-list',{hasText:'Restored.'}).locator('li')).toHaveCount(2);
 const calls=await page.evaluate(()=>(window as any).__restoreCalls);
 expect(calls.map((c:{kind:string})=>c.kind)).toEqual(['plan','plan','apply']);
 expect(calls[2].planId).toBe('rst-fixture-1');
 expect(calls[2].approvalId).toBe(calls[1].approvalId);
});

test('conflict apply result names the skipped files',async({page})=>{
 await review(page,'conflict');
 await page.getByRole('checkbox',{name:'notes.txt',exact:true}).check();
 await page.getByRole('checkbox',{name:'docs/info.md',exact:true}).check();
 await page.getByRole('button',{name:'Restore selected files',exact:true}).click();
 await page.getByRole('button',{name:'Confirm restore',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Restore result',exact:true})).toBeVisible();
 const result=page.getByRole('region',{name:'Checkpoint restore result'});
 await expect(result).toContainText('CONFLICT');
 await expect(result).not.toContainText('Restored.');
 await expect(result.locator('li',{hasText:'notes.txt'})).toContainText('Not restored: the file changed since the plan was reviewed.');
});

test('uncertain partial recovery never claims files were restored',async({page})=>{
 await review(page,'partial');
 await page.getByRole('checkbox',{name:'notes.txt',exact:true}).check();
 await page.getByRole('button',{name:'Restore selected files',exact:true}).click();
 await page.getByRole('button',{name:'Confirm restore',exact:true}).click();
 const result=page.getByRole('region',{name:'Checkpoint restore result'});
 await expect(result).toContainText('PARTIAL_RECOVERY_REQUIRED');
 await expect(result).toContainText('Check the files and recovery checkpoint');
 await expect(result).not.toContainText('Restored.');
});

test('disabled restore adapter shows its reason and no file checkboxes',async({page})=>{
 await review(page,'disabled');
 await expect(page.getByRole('button',{name:'Restore selected files',exact:true})).toBeDisabled();
 await expect(page.getByText('Restore is unavailable until checkpoint recovery is connected',{exact:false})).toBeVisible();
 await expect(page.getByText('Files to restore')).toHaveCount(0);
});


test('actual App reports an uncertain restore without claiming success',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic checkpoint test'}}}});
 snapshot.threads[0].projectId='project';
 await serveTaskFixture(page,snapshot);
 const hash='a'.repeat(64),owner={projectId:'project',threadId:'task-thread',workingCopyId:'copy',binding:hash};
 const checkpoint={id:'checkpoint',label:'Before edit',createdAt:'2026-11-10T18:42:00Z',provenance:{kind:'guarded_write',operationId:'operation'},revision:hash,fileCount:1,expiresAt:null};
 const calls:string[]=[]; let approval='';
 await page.route('**/api/projects/project/**',async route=>{
  const url=new URL(route.request().url()); calls.push(url.pathname);
  if(route.request().method()==='POST'&&url.pathname.includes('/checkpoints/')){const body=route.request().postDataJSON();expect(body.owner).toEqual(owner);expect(body.threadId).toBe('task-thread');if(url.pathname.endsWith('/plan'))approval=body.approvalId;if(url.pathname.endsWith('/apply')){expect(body.planId).toBe('plan');expect(body.approvalId).toBe(approval);}}
  if(url.pathname.endsWith('/checkpoints/capability'))return route.fulfill({json:{available:true,restore:true,owner}});
  if(url.pathname.endsWith('/checkpoints/list'))return route.fulfill({json:{owner,items:[checkpoint],nextCursor:null}});
  if(url.pathname.endsWith('/checkpoints/detail'))return route.fulfill({json:{owner,checkpoint,files:[{path:'note.txt',targetHash:hash,bytes:4,restorable:true,reason:null}]}});
  if(url.pathname.endsWith('/checkpoints/review'))return route.fulfill({json:{owner,reviewId:'review',checkpointRevision:hash,expiresAt:'2099-01-01T00:00:00Z',files:[{path:'note.txt',currentHash:hash,targetHash:hash,diff:'-old\n+new',diffTruncated:false,status:'ready'}]}});
  if(url.pathname.includes('/checkpoints/restore/')){const body=route.request().postDataJSON();return route.fulfill({json:{version:1,id:'plan',checkpointId:checkpoint.id,scope:owner,currentRevision:hash,selectedPaths:['note.txt'],beforeDigests:[{path:'note.txt',digest:hash}],targetDigests:[{path:'note.txt',digest:hash}],preRestoreCheckpointId:'backup',approvalId:body.approvalId,state:url.pathname.endsWith('/plan')?'PREVIEW':'PARTIAL_RECOVERY_REQUIRED',conflicts:[],createdAt:'2026-11-10T18:42:00Z'}});}
  if(url.pathname.endsWith('/git'))return route.fulfill({json:{head:'a'.repeat(40),revision:hash,branch:'fixture',files:[],diff:'',stagedDiff:'',truncated:false,gitWrite:false}});
  return route.fulfill({status:404,json:{error:{code:'UNAVAILABLE',message:'Synthetic route unavailable'}}});
 });
 await page.route('**/m08-actual-app',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/apps/web/src/main.tsx');</script></body></html>`}));
 await page.goto('/m08-actual-app');
 await page.getByRole('button',{name:'Inspect changes',exact:true}).click();
 await page.getByRole('tab',{name:'History',exact:true}).click();
 await page.getByRole('button',{name:'Review Before edit',exact:true}).click();
 await page.getByRole('checkbox',{name:'note.txt',exact:true}).check();
 await page.getByRole('button',{name:'Restore selected files',exact:true}).click();
 await page.getByRole('button',{name:'Confirm restore',exact:true}).click();
 const result=page.getByRole('region',{name:'Checkpoint restore result'});
 await expect(result).toContainText('Check the files and recovery checkpoint');
 await expect(result).not.toContainText('Restored.');
 expect(calls.filter(path=>path.endsWith('/checkpoints/restore/apply'))).toHaveLength(1);
});
