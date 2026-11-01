import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {expect,type Page,type Locator} from '@playwright/test';
import type {Operation} from '../packages/contracts/index.ts';
import {openCaptureBrowser,recordWindow,closeCapture,installThemeAudit,captureTheme} from './review-capture.ts';
import {humanClick,reviewPrivateToken} from './review-actions.ts';
import {SYNTHETIC_REVIEW_TOKEN} from './review-fixtures.ts';
import {EXPANDED_COMPONENT_COVERAGE,EXPANDED_PROVENANCE,openExpandedReviewHost,type ExpandedScenario} from './expanded-review-host.ts';

type Host=Awaited<ReturnType<typeof openExpandedReviewHost>>;
const scenarios:ExpandedScenario[]=['debugging','software','images','planning','everyday','interactions'];
const titles:Record<ExpandedScenario,string>={debugging:'Debugging and proposed changes',software:'API contracts and release checks',images:'Before / after image comparison',planning:'Floating plan, agents and usage',everyday:'Statistics, comparison and private token entry',interactions:'Review, edit and adjust'};
const coverage:Record<ExpandedScenario,string[]>={debugging:['Diagnostics','ChangeSet'],software:['ApiExplorer','Pipeline'],images:['ImageCompare'],planning:['PlanStatus','PlanningQuestion','LiveUsage','FloatingWindow'],everyday:['Stats','Comparison','CredentialEntry','ComposerToolbar','SentenceReveal'],interactions:['ReviewQueue','EditableTable','ParameterControls']};
export function expandedCoverage(selected:ExpandedScenario[]){const recorded=new Set(selected.flatMap(name=>coverage[name]));return {componentCoverage:EXPANDED_COMPONENT_COVERAGE.filter(name=>recorded.has(name)),shellCoverage:['PlanStatus','PlanningQuestion','LiveUsage','FloatingWindow','ComposerToolbar','SentenceReveal'].filter(name=>recorded.has(name))};}
const captions:Record<ExpandedScenario,string>={debugging:'Scripted composition. The named node test and native approval are real; the proposed patch is not applied.',software:'Scripted composition with supplied illustrative API and CI records. No API request, build or release is executed.',images:'Two original procedural PNG fixtures, granted through the real host. Source images are not edited.',planning:'Real coordinator jobs and durable decision commands with scripted child/model responses. Token figures are fixture telemetry; no subscription model is invoked.',everyday:'Scripted composition with illustrative project observations and plan terms. A clearly synthetic token exercises real session-only save/remove; no external request, credential validation, purchase or API billing is enabled.',interactions:'Scripted composition over illustrative notes, delivery records and export parameters. Reviews and typed proposals are durably submitted to the owning fixture task; no source file, external record, release or export is changed.'};
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
async function idle(host:Host,id:string){await expect.poll(()=>host.service.thread(id).runId,{timeout:30000}).toBeNull();}
async function tab(page:Page,name:string){await humanClick(page,page.getByRole('tab',{name,exact:true}),1000);}
async function inspectAppearance(page:Page,captureTheme:'light'|'dark'){
  await humanClick(page,button(page,'Settings'),500);await page.getByRole('searchbox',{name:'Search all settings'}).fill('Color scheme');
  await expect(page.getByRole('combobox',{name:'Color scheme',exact:true})).toHaveValue(captureTheme);await page.waitForTimeout(800);await humanClick(page,button(page,'Close settings'),650);
}
async function show(page:Page,locator:Locator){await locator.scrollIntoViewIfNeeded();await expect(locator).toBeVisible();await page.waitForTimeout(800);}
async function moveWindow(page:Page,locator:Locator,dx:number,dy:number){
  const box=await locator.boundingBox();if(!box)throw new Error('Floating window has no move handle');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:30});await page.mouse.up();await page.waitForTimeout(750);
}
async function actions(name:ExpandedScenario,page:Page,host:Host,id:string,chapter:(title:string)=>Promise<void>,captureTheme:'dark'|'light'){
  if(name==='debugging'){
    await idle(host,id);await expect(page.locator('.software-diagnostics')).toBeVisible();await chapter('Named local test: exact approval');
    await humanClick(page,button(page,'Run named local test'),700);
    const approval=page.locator('.decision[data-operation-id]').filter({has:button(page,'Approve operation')}).first();await expect(approval).toBeVisible();
    await humanClick(page,approval.getByText('Changes and preconditions',{exact:true}),1000);await humanClick(page,approval.getByText('Changes and preconditions',{exact:true}),350);await humanClick(page,approval.getByRole('button',{name:'Approve operation',exact:true}),700);
    await expect.poll(()=>host.store.all<Operation>('operation',id)[0]?.status,{timeout:30000}).toBe('failed');await idle(host,id);
    const artifact=page.locator('.artifact').first();await artifact.scrollIntoViewIfNeeded();await chapter('Actual failure and source selection');
    await tab(page,'empty basket returns zero');await tab(page,'includes item quantity');await show(page,page.getByLabel('Source context',{exact:true}));
    await chapter('Proposed multi-file change');await tab(page,'Changes');await tab(page,'checkout.test.mjs');await tab(page,'total.mjs');
  }else if(name==='software'){
    await idle(host,id);await chapter('Contract navigation without network execution');await tab(page,'GET /orders/{id}');await tab(page,'POST /orders');
    await tab(page,'Response 409');await expect(page.locator('.software-response')).toContainText('idempotency_conflict');
    await chapter('Source-reported checks and logs');await tab(page,'Release checks');for(const stage of ['Typecheck','Tests','Build','Publish'])await tab(page,stage);
    await tab(page,'Typecheck');await chapter('Selection survives appearance inspection');await inspectAppearance(page,captureTheme);await expect(page.getByRole('tab',{name:'Typecheck',exact:true})).toHaveAttribute('aria-selected','true');await page.waitForTimeout(1100);
  }else if(name==='images'){
    await idle(host,id);const stage=page.locator('.image-compare-stage');await expect(stage).toHaveAttribute('data-ready','true');await chapter('Pointer and keyboard reveal');
    const bounds=await stage.boundingBox();if(!bounds)throw new Error('Comparison has no geometry');
    await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5,{steps:14});await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.83,bounds.y+bounds.height*.5,{steps:34});await page.waitForTimeout(650);await page.mouse.move(bounds.x+bounds.width*.22,bounds.y+bounds.height*.5,{steps:38});await page.mouse.up();await page.waitForTimeout(700);
    const slider=page.getByRole('slider',{name:'Comparison position',exact:true});await slider.focus();await slider.press('ArrowRight');await page.waitForTimeout(500);
    await chapter('Spring split view and preserved selection');await humanClick(page,button(page,'Side by side'),1400);await inspectAppearance(page,captureTheme);await expect(button(page,'Side by side')).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(1000);await humanClick(page,button(page,'Overlay'),1200);
  }else if(name==='everyday'){
    await idle(host,id);await chapter('Selected statistics and honest unknowns');const stats=page.locator('.everyday-stats');await expect(stats).toBeVisible();
    for(const metric of ['Response time','Availability','Cost','Requests'])await humanClick(page,stats.getByRole('tab',{name:metric,exact:true}),900);
    await chapter('Compare supplied options and save a preference');await tab(page,'Compare plans');const comparison=page.locator('.everyday-comparison');await humanClick(page,comparison.getByRole('button',{name:'Select Studio',exact:true}),650);await humanClick(page,comparison.getByRole('checkbox',{name:'Differences only',exact:true}),700);
    await humanClick(page,comparison.getByRole('button',{name:'Save selected plan',exact:true}),500);await idle(host,id);await expect(page.locator('.task-status')).toContainText('Studio selected');
    await chapter('Selection survives appearance inspection');await inspectAppearance(page,captureTheme);await expect(comparison.getByRole('button',{name:'Select Studio',exact:true})).toHaveAttribute('aria-pressed','true');
    await chapter('Private host-session token: synthetic save and removal');await tab(page,'Private token');await reviewPrivateToken(page,page.locator('.credential-entry'));
    expect(JSON.stringify(host.store.snapshot())).not.toContain(SYNTHETIC_REVIEW_TOKEN);
    await tab(page,'Statistics');
  }else if(name==='interactions'){
    await idle(host,id);const review=page.locator('.review-queue');await expect(review).toBeVisible();await chapter('Review each item with a useful decision');
    await humanClick(page,review.getByRole('radio',{name:'Accept',exact:true}),600);await humanClick(page,review.getByRole('button',{name:'Next item',exact:true}),650);
    await humanClick(page,review.getByRole('radio',{name:'Request changes',exact:true}),500);await review.getByRole('textbox',{name:'Review comment',exact:true}).pressSequentially('Specify which callers were checked.',{delay:30});await humanClick(page,review.getByRole('button',{name:'Next item',exact:true}),650);
    await humanClick(page,review.getByRole('radio',{name:'Defer',exact:true}),500);await humanClick(page,review.getByRole('button',{name:'Send review',exact:true}),700);await idle(host,id);
    await chapter('Typed record edits remain proposals');await tab(page,'Edit records');const table=page.locator('.editable-table');await table.getByRole('spinbutton',{name:'Prints · Quantity',exact:true}).fill('6');await table.getByRole('combobox',{name:'Prints · Priority',exact:true}).selectOption('urgent');await table.getByRole('combobox',{name:'Prints · Ready',exact:true}).selectOption('true');await page.waitForTimeout(900);await humanClick(page,table.getByRole('button',{name:'Submit changes',exact:true}),750);await idle(host,id);
    await chapter('Immediate parameter controls and durable Apply');await tab(page,'Parameters');const parameters=page.locator('.parameter-controls');const quality=parameters.getByRole('slider',{name:'Quality',exact:true});await quality.focus();await quality.press('ArrowRight');await parameters.getByRole('spinbutton',{name:'Width',exact:true}).fill('1920');await parameters.getByRole('combobox',{name:'Format',exact:true}).selectOption('webp');await parameters.getByRole('combobox',{name:'Include metadata',exact:true}).selectOption('true');await page.waitForTimeout(800);await humanClick(page,parameters.getByRole('button',{name:'Apply settings',exact:true}),750);await idle(host,id);
    await chapter('Reload and appearance inspection preserve edits');await page.reload();await expect(parameters.getByRole('spinbutton',{name:'Width',exact:true})).toHaveValue('1920');await inspectAppearance(page,captureTheme);
  }else{
    const rail=page.getByRole('region',{name:'Task plan',exact:true});await expect(rail.getByText('Repair checkout failures',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeFocused();await chapter('The actual plan opens without moving composer focus');
    await chapter('Working agents and their finishing requirements');await humanClick(page,rail.getByRole('button',{name:'Inspect Test investigator',exact:true}),250);
    const progress=rail.getByRole('progressbar',{name:'Test investigator progress',exact:true});
    await expect(progress).toHaveAttribute('aria-valuenow','50',{timeout:20000});await chapter('One of two actual requirements complete');
    await expect(progress).toHaveAttribute('aria-valuenow','100',{timeout:20000});await chapter('Both reported requirements complete');await idle(host,id);await page.waitForTimeout(900);
    await chapter('Content-fit Plan: move and minimize');const planWindow=page.getByRole('region',{name:'Task plan window',exact:true});await moveWindow(page,planWindow.getByRole('button',{name:'Move Task plan',exact:true}),0,38);await expect(planWindow.getByRole('separator')).toHaveCount(0);
    await chapter('Reset the Plan window position');await humanClick(page,planWindow.getByRole('button',{name:'Reset Task plan position',exact:true}),700);
    await humanClick(page,planWindow.getByRole('button',{name:'Minimize Task plan',exact:true}),700);await humanClick(page,planWindow.getByRole('button',{name:'Expand Task plan',exact:true}),700);await humanClick(page,planWindow.getByRole('button',{name:'Close Task plan',exact:true}),500);
    await chapter('Explain, examples and more options');const question=page.getByRole('region',{name:'Which repair should we explore?',exact:true});await show(page,question);
    await humanClick(page,question.getByRole('radio',{name:'Focused repair',exact:true}),500);await humanClick(page,question.getByRole('button',{name:'Explain Focused repair',exact:true}),400);await expect(question.getByText(/^Keep the public API and repair only/)).toBeVisible({timeout:15000});await idle(host,id);await page.waitForTimeout(900);
    await humanClick(page,question.getByRole('button',{name:'Examples for Focused repair',exact:true}),500);await expect(question.getByText('For four items at 3 credits each, the result should be 12.',{exact:true})).toBeVisible({timeout:15000});await idle(host,id);await page.waitForTimeout(900);
    await humanClick(page,question.getByRole('button',{name:'More options',exact:true}),400);await expect(question.getByRole('radio',{name:'Test-first repair',exact:true})).toBeVisible({timeout:15000});await idle(host,id);
    await chapter('Custom decision and durable continuation');await humanClick(page,question.getByRole('button',{name:'Add my own option',exact:true}),450);await question.getByRole('textbox',{name:'Your option',exact:true}).pressSequentially('Fix quantity only, then verify both tests.',{delay:30});await page.waitForTimeout(900);await humanClick(page,question.getByRole('button',{name:'Continue',exact:true}),650);await idle(host,id);
    await chapter('Floating reported usage and preference');await humanClick(page,button(page,'Show live usage'),400);const usage=page.getByRole('region',{name:'Live usage',exact:true});await humanClick(page,usage.getByRole('button',{name:'Inspect live usage',exact:true}),1100);await moveWindow(page,usage.getByRole('button',{name:'Move Live usage',exact:true}),0,-34);await humanClick(page,usage.getByRole('button',{name:'Close live usage details',exact:true}),700);
    await humanClick(page,button(page,'Thread options'),350);await humanClick(page,button(page,'Show plan'),500);await expect(planWindow).toBeVisible();await chapter('Reopen Plan from Thread options');await humanClick(page,planWindow.getByRole('button',{name:'Close Task plan',exact:true}),500);
    await humanClick(page,button(page,'Settings'),500);await page.getByRole('searchbox',{name:'Search all settings'}).fill('Live usage');await humanClick(page,page.getByRole('switch',{name:'Live usage',exact:true}),700);await humanClick(page,button(page,'Close settings'),700);await expect(usage).toHaveCount(0);
    await humanClick(page,button(page,'Settings'),500);await page.getByRole('searchbox',{name:'Search all settings'}).fill('Live usage');await humanClick(page,page.getByRole('switch',{name:'Live usage',exact:true}),600);await humanClick(page,button(page,'Close settings'),700);await expect(usage).toBeVisible();
  }
}

export async function recordExpandedReview(options:{output:string;scenarios?:ExpandedScenario[];theme?:'dark'|'light'}){
  const theme=captureTheme(options.theme);
  const output=resolve(options.output);await mkdir(dirname(output),{recursive:true});await mkdir(output,{recursive:false});
  const host=await openExpandedReviewHost(join(output,'fixture-'+randomUUID().slice(0,8))),browser=await openCaptureBrowser();
  await browser.page.emulateMedia({colorScheme:theme});const themeAudit=await installThemeAudit(browser.page,theme);
  const captures:Record<string,unknown>[]=[];const selected=options.scenarios??scenarios;const manifest={version:1,source:EXPANDED_PROVENANCE,theme,genuinePi:false,...expandedCoverage(selected),captures};
  try{
    let index=0;
    for(const name of selected){
      const thread=host.threads[name];await host.service.command({id:randomUUID(),type:'settings.update',payload:{theme,modelId:'review/expanded-fixture',preferences:{showUsageFooter:true,archiveConfirmation:false}}});themeAudit.reset();
      await browser.page.goto('http://127.0.0.1:4348');await browser.page.evaluate(id=>{localStorage.setItem('harness:selected-thread',id);for(const key of ['harness:plan-floating-open','harness:shell-layout:v1','harness:floating:plan:v1','harness:floating:usage:v1'])localStorage.removeItem(key);},thread.id);await browser.page.reload();await expect(browser.page.getByRole('combobox',{name:'Model',exact:true})).toHaveText('Local scripted UI review');
      await expect.poll(()=>browser.page.evaluate(()=>document.documentElement.dataset.theme)).toBe(theme);themeAudit.reset();
      await themeAudit.assert();
      const filename=`${String(++index).padStart(2,'0')}-${name}.mp4`,chapters:{title:string;startSeconds:number;frame:string}[]=[],stop=await recordWindow(browser.server,browser.page,join(output,filename)),started=performance.now();
      const chapter=async(title:string)=>{await themeAudit.assert();const frame=`${name}-chapter-${chapters.length+1}.png`;chapters.push({title,startSeconds:(performance.now()-started)/1000,frame});await browser.page.screenshot({path:join(output,frame)});};
      try{
        await browser.page.waitForTimeout(1000);const prompt=({debugging:'Investigate the checkout quantity test.',software:'Help me understand the order contract and release checks.',images:'Compare these two interface images.',planning:'Plan a careful repair for checkout failures.',everyday:'Help me understand this project and choose a plan.',interactions:'Review these notes and adjust the delivery details.'})[name];
        if(name==='everyday'){
          await chapter('Composer actions preserve the draft');const draft=browser.page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep my project context.');await humanClick(browser.page,button(browser.page,'Create PR'),650);await expect(draft).toHaveValue(/Create a pull request.*Keep my project context/s);await draft.fill('');await chapter('Sentence arrivals from the scripted adapter');
        }
        await browser.page.getByRole('textbox',{name:'Message',exact:true}).pressSequentially(prompt,{delay:25});if(name==='planning'){await browser.page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await browser.page.waitForTimeout(300);}else await humanClick(browser.page,button(browser.page,'Send message'),700);await actions(name,browser.page,host,thread.id,chapter,theme);await chapter('Settled result');await browser.page.waitForTimeout(1200);
        const settledFrame=`${name}-settled.png`;await browser.page.screenshot({path:join(output,settledFrame)});const poster=name==='planning'?(chapters.find(chapter=>chapter.title==='One of two actual requirements complete')?.frame??settledFrame):settledFrame;await themeAudit.assert();const probe=await stop();await themeAudit.assert();captures.push({scenario:name,title:titles[name],theme,themeAudit:themeAudit.records(),file:filename,poster,settledFrame,fixture:true,caption:captions[name],componentCoverage:coverage[name],chapters,probe});
        console.log('RECORDED '+name+': '+filename);
      }catch(error){const probe=await stop();await browser.page.screenshot({path:join(output,`${name}-failed.png`)}).catch(()=>{});captures.push({scenario:name,theme,themeAudit:themeAudit.records(),file:filename,failed:true,error:String(error),probe});throw error;}
      finally{await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));await writeFile(join(output,'snapshot.json'),JSON.stringify(host.store.snapshot(),null,2));}
    }
    const esc=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    await writeFile(join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Expanded interface review</title><style>body{max-width:1100px;margin:40px auto;padding:0 24px;background:#111;color:#ddd;font:15px/1.6 system-ui}video{width:100%;border:1px solid #333;border-radius:12px}section{margin:48px 0}small{color:#aaa}a{color:#9ebcff}h1,h2{font-weight:550}</style><h1>Software, images, planning and everyday tools</h1><p>${esc(EXPANDED_PROVENANCE)}</p><p>1920 × 1080 H.264 at 30 output fps. Compositor frames are sampled against wall time; delayed or unchanged frames are held, without interpolation. These are deterministic demonstrations; genuine Pi evidence belongs to the main review package.</p>${captures.map(capture=>`<section><h2>${esc(capture.title)}</h2><p>${esc(capture.caption)}</p><video controls preload="metadata" poster="${esc(capture.poster)}" src="${esc(capture.file)}"></video><ul>${(capture.chapters as {title:string;startSeconds:number}[]).map(chapter=>`<li>${chapter.startSeconds.toFixed(1)}s — ${esc(chapter.title)}</li>`).join('')}</ul><small>Coverage: ${(capture.componentCoverage as string[]).map(esc).join(', ')}</small></section>`).join('')}<p><a href="manifest.json">Capture and coverage manifest</a></p></html>`);
    await writeFile(join(output,'README.md'),`# Expanded interface review\n\n${EXPANDED_PROVENANCE}\n\nOpen index.html to review the embedded clips. No subscription inference or external publishing occurs here. When the debugging clip is included, native approval runs only the named disposable checkout.test.mjs. Its nonzero test exit and failed operation receipt are preserved. Proposed changes are not applied.\n\nCapture metadata and chapters: manifest.json. Snapshot: snapshot.json. Recorded catalog components: ${manifest.componentCoverage.join(', ')||'None in this subset'}. Recorded shell surfaces: ${manifest.shellCoverage.join(', ')||'None in this subset'}.\n`);
    console.log('EXPANDED_REVIEW_OUTPUT '+output);return manifest;
  }finally{await closeCapture(browser);await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const arg=(key:string)=>{const position=process.argv.indexOf(key);return position<0?undefined:process.argv[position+1];};
  const selected=arg('--scenario')?.split(',');if(selected?.some(name=>!scenarios.includes(name as ExpandedScenario)))throw new Error('Unknown expanded-review scenario');
  const theme=captureTheme(arg('--theme'));
  if(process.argv.includes('--dry-run'))console.log(JSON.stringify({source:EXPANDED_PROVENANCE,theme,scenarios:selected??scenarios,...expandedCoverage(selected as ExpandedScenario[]|undefined??scenarios)},null,2));
  else await recordExpandedReview({output:arg('--output')??`docs/evidence/expanded-review/run-${new Date().toISOString().replace(/[:.]/g,'-')}`,scenarios:selected as ExpandedScenario[]|undefined,theme});
}
