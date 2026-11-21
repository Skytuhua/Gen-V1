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
 window.restore=()=>setResources([{id:"r2",path:"/src/b.ts",label:"b.ts",writable:true,kind:"file"}]);
 window.snapshot=()=>setResources(previous=>previous.map(resource=>({...resource})));
 window.readd=()=>setResources([{id:'r1',path:'/src/a.ts',label:'a.ts',writable:true,kind:'file'}]);
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
    css = (await Promise.all(['packages/ui-shell/tokens.css','packages/ui-shell/feedback.css','apps/web/src/styles.css','apps/web/src/shell.css','apps/web/src/loading-state.css','apps/web/src/composer-entry.css','apps/web/src/appearance.css'].map(path=>readFile(path,'utf8')))).join('\n');
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

  it('does not resurrect an attachment removed while motion was reduced', async () => {
    const page = await open();
    try {
      await page.locator('.resource-chip').waitFor();
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate('window.drop()');
      await page.locator('.resource-chip').waitFor({state:'detached'});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(`{
        const style = document.createElement('style');
        style.textContent = '.resource-chip {animation-play-state:paused!important}';
        document.head.append(style);
        window.restore();
      }`);
      await page.getByText('b.ts',{exact:true}).waitFor();
      expect(await page.locator('.resource-chip').allTextContents()).toEqual(['b.ts']);
    } finally { await page.close(); }
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

  it('retains chip identity through polling and reverses removal without remounting',async()=>{
    const page=await open();
    try{
      const chip=page.locator('.composer-attachment-item');await chip.waitFor();const identity=await chip.elementHandle();
      const result=await chip.evaluate(async node=>{
        for(const animation of node.getAnimations())animation.finish();
        const events:string[]=[];node.addEventListener('animationstart',event=>events.push((event as AnimationEvent).animationName));
        (window as unknown as {snapshot:()=>void}).snapshot();
        await new Promise(requestAnimationFrame);
        const replay=node.getAnimations().length;
        (window as unknown as {drop:()=>void}).drop();await new Promise(requestAnimationFrame);
        const exit=node.getAnimations()[0];exit.pause();exit.currentTime=50;
        const before=getComputedStyle(node).opacity;
        (window as unknown as {readd:()=>void}).readd();await new Promise(requestAnimationFrame);
        const insertion=node.getAnimations()[0];insertion.pause();insertion.currentTime=0;
        return {replay,before,after:getComputedStyle(node).opacity,events};
      });
      expect(result.replay).toBe(0);expect(result.events).toEqual([]);expect(Number(result.after)).toBeCloseTo(Number(result.before),2);
      expect(await chip.evaluate((node,original)=>node===original,identity)).toBe(true);
      expect(await page.locator('.resource-chip').count()).toBe(1);
      await chip.evaluate(node=>node.getAnimations().forEach(animation=>animation.finish()));
      await expect.poll(()=>chip.getAttribute('data-leaving')).toBeNull();
    }finally{await page.close();}
  });

  for(const policy of ['system','reduced','off','os'] as const)it(`chip motion obeys ${policy} and can empty the band`,async()=>{
    const page=await open();
    try{
      await page.locator('.resource-chip').waitFor();
      const frames=await page.evaluate(async policy=>{
        document.documentElement.dataset.motion=policy==='os'?'system':policy;
        if(policy==='os')return null;
        (window as unknown as {restore:()=>void}).restore();await new Promise(requestAnimationFrame);
        return document.querySelector('.composer-attachment-item:not([data-leaving])')!.getAnimations().flatMap(animation=>{animation.pause();return (animation.effect as KeyframeEffect).getKeyframes();});
      },policy);
      if(policy==='os')await page.emulateMedia({reducedMotion:'reduce'});
      else if(policy==='off')expect(frames).toEqual([]);
      else if(policy==='reduced')expect(frames!.every(frame=>!('transform' in frame)&&!('width' in frame))).toBe(true);
      else expect(frames!.some(frame=>frame.transform==='scale(0.96)')).toBe(true);
      await page.evaluate(()=>{document.querySelectorAll('.composer-attachment-item').forEach(node=>node.getAnimations().forEach(animation=>animation.finish()));(window as unknown as {drop:()=>void}).drop();});
      await page.locator('.composer-attachment-band').waitFor({state:'detached'});
    }finally{await page.close();}
  });

  it('removes panel travel monotonically without an overshoot',async()=>{
    const page=await open();
    try{
      const frames=await page.locator('#panel').evaluate(node=>{
        (node as HTMLElement).dataset.state='open';
        return node.getAnimations().flatMap(animation=>(animation.effect as KeyframeEffect).getKeyframes()).filter(frame=>frame.transform).map(frame=>new DOMMatrix(frame.transform as string).m41);
      });
      expect(frames.length).toBeGreaterThan(1);expect(frames.every(value=>value>=0&&value<=14)).toBe(true);expect(frames.at(-1)).toBe(0);
    }finally{await page.close();}
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
