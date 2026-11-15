// Test-only spec: exercises the FileCheckpoints restore confirm/apply/conflict
// rendering with a stub adapter whose restore seam works and returns
// client-schema-shaped payloads. The live path could not reach this UI during
// M08 testing (see report: readRestorePlan strict-schema mismatch).
import {expect,test} from '@playwright/test';

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
 await expect(result.locator('li',{hasText:'docs/info.md'})).toContainText('Restored.');
 await expect(result.locator('li',{hasText:'notes.txt'})).toContainText('Not restored: the file changed since the plan was reviewed.');
});

test('disabled restore adapter shows its reason and no file checkboxes',async({page})=>{
 await review(page,'disabled');
 await expect(page.getByRole('button',{name:'Restore selected files',exact:true})).toBeDisabled();
 await expect(page.getByText('Restore is unavailable until checkpoint recovery is connected',{exact:false})).toBeVisible();
 await expect(page.getByText('Files to restore')).toHaveCount(0);
});
