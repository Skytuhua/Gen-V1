import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {chromium, type Browser, type Page} from '@playwright/test';

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {toast, Toaster} from './packages/ui-shell/Toast';
import {TooltipLayer} from './packages/ui-shell/Tooltip';
import {ErrorState, BusyButton} from './packages/ui-shell/Feedback';

window.toast = toast;
function Fixture(){
 return <>
  <Toaster/><TooltipLayer/>
  <button id="tip" title="Save the current draft">Save</button>
  <ErrorState message="The save did not finish. Retry." onRetry={() => {window.retried = true;}} />
  <BusyButton id="busy" busy>Sending</BusyButton>
 </>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

describe('feedback primitives', () => {
  let browser: Browser, script: string, css: string;
  beforeAll(async () => {
    script = (await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},loader:{'.css':'empty'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0]!.text;
    css = await readFile('packages/ui-shell/tokens.css','utf8') + await readFile('packages/ui-shell/feedback.css','utf8');
    browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  });
  afterAll(async () => { await browser?.close(); });
  async function open(): Promise<Page> {
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style><div id="root"></div>`);
    await page.addScriptTag({content: script});
    return page;
  }

  it('shows, deduplicates, acts on and dismisses toasts', async () => {
    const page = await open();
    await page.evaluate(`window.toast('Draft saved')`);
    const item = page.locator('.ui-toast', {hasText: 'Draft saved'});
    await item.waitFor();
    expect(await item.getAttribute('role')).toBe('status');
    await page.evaluate(`window.toast('Draft saved')`);
    expect(await page.locator('.ui-toast').count()).toBe(1);
    await page.evaluate(`window.toast('Failed', {tone:'error'})`);
    await page.locator('.ui-toast[role="alert"]').waitFor();
    await page.evaluate(`window.toast('With action', {action:{label:'Undo', onClick(){window.acted = true}}})`);
    await page.locator('.ui-toast button', {hasText: 'Undo'}).click();
    expect(await page.evaluate(`Boolean(window.acted)`)).toBe(true);
    await expect.poll(() => page.locator('.ui-toast').count()).toBe(2);
    await page.locator('.ui-toast [aria-label="Dismiss notification"]').first().click();
    await expect.poll(() => page.locator('.ui-toast').count()).toBe(1);
    await page.close();
  });

  it('expires toasts after their duration', async () => {
    const page = await open();
    await page.evaluate(`window.toast('Short', {durationMs: 60})`);
    const item = page.locator('.ui-toast');
    await item.waitFor();
    await item.waitFor({state: 'detached', timeout: 4000});
    await page.close();
  });

  it('adopts title attributes as tooltips on hover', async () => {
    const page = await open();
    const target = page.locator('#tip');
    await target.hover();
    const tip = page.locator('.ui-tooltip');
    await tip.waitFor();
    expect(await tip.innerText()).toBe('Save the current draft');
    expect(await target.getAttribute('title')).toBeNull();
    await page.mouse.move(0, 0);
    await tip.waitFor({state: 'detached', timeout: 3000});
    await page.close();
  });

  it('strips a trailing retry instruction when a retry button is present', async () => {
    const page = await open();
    const error = page.locator('.ui-error');
    await error.waitFor();
    expect(await error.getAttribute('role')).toBe('alert');
    expect(await error.locator('p').innerText()).toBe('The save did not finish.');
    await error.getByRole('button', {name: 'Retry'}).click();
    expect(await page.evaluate(`Boolean(window.retried)`)).toBe(true);
    const busy = page.locator('#busy');
    expect(await busy.getAttribute('aria-busy')).toBe('true');
    expect(await busy.isDisabled()).toBe(true);
    await page.close();
  });

  it('uses brief opacity-only fades under reduced motion', async () => {
    const page = await open();
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(`window.toast('Reduced')`);
    const item = page.locator('.ui-toast');
    await item.waitFor();
    const duration = await item.evaluate(el => getComputedStyle(el).animationDuration);
    expect(duration).toBe('0.08s');
    await page.close();
  });
});
