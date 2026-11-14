import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {chromium, type Browser, type Page} from '@playwright/test';

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ComposerAttachments} from './apps/web/src/ComposerAttachments';

function Fixture(){
 const [resources,setResources]=useState([{id:'r1',path:'/src/a.ts',label:'a.ts',writable:true,kind:'file'}]);
 window.drop=()=>setResources([]);
 return <>
  <ComposerAttachments resources={resources}/>
  <details><summary>Disclosure</summary><p>Body</p></details>
  <div role="tabpanel"><p>Panel</p></div>
  <div className="message" data-arrival="true"><p>New reply</p></div>
  <aside id="panel" className="workspace-right" data-state="closed" onAnimationEnd={event=>{if(event.animationName==='panel-exit')window.left=true;}} />
 </>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

describe('content motion', () => {
  let browser: Browser, server: Server, base: string, script: string, css: string;
  beforeAll(async () => {
    script = (await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},loader:{'.css':'empty'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0]!.text;
    css = await readFile('packages/ui-shell/tokens.css','utf8') + await readFile('packages/ui-shell/feedback.css','utf8') + await readFile('apps/web/src/styles.css','utf8') + await readFile('apps/web/src/shell.css','utf8') + await readFile('apps/web/src/loading-state.css','utf8');
    server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(`<style>${css}</style><div id="root"></div><script>${script}</script>`); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  });
  afterAll(async () => { await browser?.close(); server?.close(); });
  async function open(): Promise<Page> {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    return page;
  }

  it('animates attachment chips out before unmounting', async () => {
    const page = await open();
    await page.locator('.resource-chip').waitFor();
    await page.evaluate(`window.drop()`);
    const leaving = page.locator('.resource-chip[data-leaving]');
    await leaving.waitFor({state: 'attached'});
    expect(await leaving.getAttribute('aria-hidden')).toBe('true');
    await leaving.waitFor({state: 'detached', timeout: 3000});
    await expect.poll(() => page.locator('.resource-chip').count()).toBe(0);
    await page.close();
  });

  it('animates native details disclosure via ::details-content', async () => {
    const page = await open();
    const details = page.locator('details');
    await details.waitFor();
    const duration = await details.evaluate(el => getComputedStyle(el, '::details-content').transitionDuration);
    expect(parseFloat(duration)).toBeGreaterThan(0);
    await page.locator('summary').click();
    await expect.poll(async () => details.evaluate(el => getComputedStyle(el, '::details-content').blockSize)).not.toBe('0px');
    await page.close();
  });

  it('gives tab panels and arriving messages an entrance', async () => {
    const page = await open();
    const panel = page.locator('[role="tabpanel"]');
    await panel.waitFor();
    expect(await panel.evaluate(el => getComputedStyle(el).animationName)).toBe('ui-item-in');
    expect(await page.locator('.message[data-arrival]').evaluate(el => getComputedStyle(el).animationName)).toBe('ui-item-in');
    await page.close();
  });

  it('plays the workspace panel exit before unmount', async () => {
    const page = await open();
    const panel = page.locator('#panel');
    await panel.waitFor({state: 'attached'});
    expect(await panel.evaluate(el => getComputedStyle(el).animationName)).toBe('panel-exit');
    await expect.poll(() => page.evaluate(`Boolean(window.left)`), {timeout: 3000}).toBe(true);
    await page.close();
  });
});
