import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { openReviewHost, type Scenario } from './review-host.ts';
import { openCaptureBrowser, recordWindow, closeCapture, installThemeAudit, captureTheme } from './review-capture.ts';
import { runReviewActions } from './review-actions.ts';
import { assertCatalogCoverage, catalogSpec, REVIEW_PROVENANCE } from './review-fixtures.ts';
import { MOTION_PROBE_SOURCE } from './motion-probe.ts';

const arg = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
const theme=captureTheme(arg('--theme'));
const output = resolve(arg('--output') ?? `docs/evidence/frontend-review/run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const host = await openReviewHost(join(output, 'fixture-' + randomUUID().slice(0, 8)));
const browser = await openCaptureBrowser();
await browser.page.emulateMedia({colorScheme:theme});
const themeAudit=await installThemeAudit(browser.page,theme);
let motionChunks: unknown[] = [];
await browser.page.exposeBinding('__reviewMotionSink', (_source, chunk: unknown) => { motionChunks.push(chunk); });
await browser.page.addInitScript({ content: MOTION_PROBE_SOURCE });
const scenarios = (arg('--scenario')?.split(',') ?? ['signing', 'pr-dark', 'pr-light', 'migration', 'context', 'faq', 'map', 'catalog', 'shell']) as Scenario[];
const manifest: Record<string, unknown> = { source: REVIEW_PROVENANCE, theme, generation: 'Explicit deterministic renderer fixture; genuine Pi proof is recorded separately.', catalogCoverage: arg('--exploration-only')==='1'?['ImageAnnotator','SchedulePicker','LogExplorer']:assertCatalogCoverage(catalogSpec('pdf', 'png')), captures: [] };
const captures = manifest.captures as Record<string, unknown>[];
const prompts: Record<Scenario, string> = { signing: 'Can we e-sign this service agreement?', 'pr-dark': 'Review this pull request and its conflicts.', 'pr-light': 'Show these branch conflicts and help resolve them.', migration: 'Run the reviewed workspace migration on this local database.', context: 'Inspect context and compact this illustrative session.', faq: 'Help me understand this account with follow-up questions.', map: 'Find a quiet café near the park where I can work.', catalog: 'Show the interactive component catalog.', shell: 'Show the workspace and settings.' };
try {
  let index = 0;
  for (const scenario of scenarios) {
    const thread = host.threads.get(scenario); if (!thread) throw new Error('Unknown review scenario: ' + scenario);
    await host.service.command({ id: randomUUID(), type: 'settings.update', payload: { theme, modelId: 'review/local-fixture', preferences: { archiveConfirmation: false } } });
    themeAudit.reset();
    await browser.page.goto('http://127.0.0.1:4347');
    await browser.page.evaluate(id => { localStorage.setItem('harness:selected-thread', id); localStorage.removeItem('harness:shell-layout:v1'); }, thread.id); await browser.page.reload();
    await expect(browser.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(browser.page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Local UI demo · no model inference');
    await expect.poll(()=>browser.page.evaluate(()=>document.documentElement.dataset.theme)).toBe(theme);
    // Bootstrap precedes the video. From this point, reloads and transient
    // opposite-theme changes remain part of the continuous capture audit.
    themeAudit.reset();
    await themeAudit.assert();
    const filename = `${String(++index).padStart(2, '0')}-${scenario}.mp4`, path = join(output, filename);
    motionChunks = [];
    const stop = await recordWindow(browser.server, browser.page, path);
    const started = performance.now(), chapters: { title: string; startSeconds: number }[] = [{ title: 'Intent and composition', startSeconds: 0 }];
    const chapter = async (title: string) => {
      await themeAudit.assert();
      chapters.push({ title, startSeconds: (performance.now() - started) / 1000 });
      await browser.page.screenshot({ path: join(output, `${scenario}-chapter-${chapters.length}.png`) });
    };
    try {
      await browser.page.waitForTimeout(800); await browser.page.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially(prompts[scenario], { delay: 22 });
      await browser.page.getByRole('button', { name: 'Send message', exact: true }).click();
      if (scenario !== 'context') await expect(browser.page.locator('.artifact').first()).toBeVisible({ timeout: 25000 });
      await expect.poll(() => host.store.get<{ runId: string | null }>('thread', thread.id)?.runId, { timeout: 30000 }).toBeNull();
      await browser.page.waitForTimeout(1100); await runReviewActions(scenario, browser.page, host, chapter,arg('--exploration-only')==='1',theme);
      if (scenario === 'shell') {
        const group = browser.page.locator('.thread-group').filter({ has: browser.page.locator('.sidebar-thread-row.active') });
        const toggle = group.locator('h2 button'), row = group.locator('.sidebar-thread-row').first(), original = await row.elementHandle();
        await chapter('Thread groups fold without replacing their rows');
        await toggle.hover(); await browser.page.waitForTimeout(160); await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(await original!.evaluate(node => node.isConnected)).toBe(true);
        await browser.page.waitForTimeout(700); await expect(row).toBeHidden();
        await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await browser.page.waitForTimeout(700); await expect(row).toBeVisible();
        expect(await row.evaluate((node, before) => node === before, original)).toBe(true);
      }
      await chapter('Settled result');await browser.page.waitForTimeout(1200); await browser.page.screenshot({ path: join(output, `${scenario}-settled.png`), fullPage: false });
      await themeAudit.assert();
      const probe = await stop();
      await themeAudit.assert();
      const motionFile = `${scenario}-motion.json`;
      await browser.page.evaluate(() => (window as unknown as {__motionProbe:{flush:()=>void}}).__motionProbe.flush());
      await writeFile(join(output, motionFile), JSON.stringify({ chunks: motionChunks, recording: probe.capture }));
      captures.push({ scenario, title:scenario==='pr-light'?'Vertical branch conflicts':scenario==='pr-dark'?'Vertical pull request review':undefined, theme, themeAudit:themeAudit.records(), file: filename, threadId: thread.id, fixture: true, poster: `${scenario}-settled.png`, chapters, probe, motionFile });
      console.log(`RECORDED ${scenario}: ${filename}`);
      if(scenario==='catalog'&&arg('--capture-variants')==='1'){
        const variants=[{name:'light',theme:'light',width:1920,height:1080},{name:'dark',theme:'dark',width:1920,height:1080},{name:'narrow',theme,width:390,height:844}] as const;
        for(const variant of variants){
          await browser.page.setViewportSize({width:variant.width,height:variant.height});
          await host.service.command({id:randomUUID(),type:'settings.update',payload:{theme:variant.theme}});
          await expect.poll(()=>browser.page.evaluate(()=>document.documentElement.dataset.theme)).toBe(variant.theme);
          for(const [label,name]of [['Image feedback','annotations'],['Schedule','schedule'],['Logs','logs']] as const){
            const tab=browser.page.getByRole('tab',{name:label,exact:true});await tab.scrollIntoViewIfNeeded();await tab.click();
            const surface=browser.page.locator(label==='Image feedback'?'.image-annotator':label==='Schedule'?'.schedule-picker':'.log-explorer');
            await surface.scrollIntoViewIfNeeded();if(label==='Image feedback')await expect(browser.page.getByRole('button',{name:'Add pin',exact:true})).toBeEnabled();await browser.page.waitForTimeout(700);
            await browser.page.screenshot({path:join(output,`${name}-${variant.name}.png`)});
          }
        }
      }
    } catch (error) {
      const probe = await stop(); await browser.page.screenshot({ path: join(output, `${scenario}-failed.png`) }).catch(() => {});
      captures.push({ scenario, theme, themeAudit:themeAudit.records(), file: filename, failed: true, error: String(error), probe }); throw error;
    } finally { await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2)); await writeFile(join(output, 'snapshot.json'), JSON.stringify(host.store.snapshot(), null, 2)); }
  }
  console.log('REVIEW_OUTPUT ' + output);
} finally { await closeCapture(browser); await host.close(); }
