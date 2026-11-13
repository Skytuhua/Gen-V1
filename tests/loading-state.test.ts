import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {chromium, type Browser, type Page} from '@playwright/test';

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectContextCard} from './apps/web/src/ProjectContextCard';
const context = {
 project:{id:'project',name:'Retained project',authority:{kind:'local'},rootPath:'C:/fixture',createdAt:'2026-11-05T00:00:00Z'},
 machineName:'Fixture machine',editor:{available:true,label:'Editor'},branch:'main',head:'a'.repeat(40),revision:'revision-one',
 changes:{added:2,removed:1,files:1},lineage:[],scripts:[],capabilities:{git:true,gitWrite:true,terminal:true,pullRequests:false}
};
function Fixture(){
 const [loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 window.setLoad=(value)=>setLoading(value); window.resolveLoad=()=>{setLoaded(true);setLoading(false);};
 window.failLoad=()=>{setError('Project read failed');setLoading(false);};
 return <ProjectContextCard context={loaded?context:null} loading={loading} error={error} onAction={(type,payload)=>new Promise((resolve,reject)=>{window.action={type,payload};window.acceptAction=resolve;window.rejectAction=()=>reject(Error('Project action failed'));})}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

type FixtureWindow = Window & {
  setLoad(value: boolean): void; resolveLoad(): void; failLoad(): void;
  acceptAction(): void; rejectAction(): void;
  savedInput?: Element | null;
};

describe('project leaf loading states', () => {
  let browser: Browser, script: string, css: string;
  beforeAll(async () => {
    script = (await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}})).outputFiles[0]!.text;
    css = (await readFile('apps/web/src/styles.css','utf8')).replace(/^@import[^;]+;/,await readFile('packages/ui-shell/tokens.css','utf8'));
    css += await readFile('apps/web/src/project-context.css','utf8');
    css += await readFile('apps/web/src/loading-state.css','utf8').catch(()=> '');
    browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  });
  afterAll(async () => { await browser?.close(); });
  async function open() {
    const page = await browser.newPage({viewport:{width:390,height:400}});
    const time=new Date('2026-11-05T12:00:00Z');
    await page.clock.install({time});
    await page.clock.pauseAt(new Date(time.getTime()+1000));
    await page.setContent('<html><body style="margin:0;--surface:#0f0f0f;--text:#eee;--muted:#aaa;--border:#333;--hover:#292929"><div id="root"></div></body></html>');
    await page.addStyleTag({content:css}); await page.addScriptTag({content:script});
    await page.locator('.project-context-card').waitFor();
    return page;
  }
  async function loaded(page: Page) {
    await page.evaluate(()=>(window as unknown as FixtureWindow).resolveLoad());
    await page.getByRole('button',{name:'main',exact:true}).waitFor();
  }

  it('reserves project rows immediately and reveals structural feedback only after 150ms', async () => {
    const page=await open();try {
      expect(await page.locator('.tool-loading-state [aria-busy="true"]').count()).toBe(1);
      expect(await page.locator('.loading-state-skeleton .loading-skeleton').count()).toBeGreaterThanOrEqual(3);
      expect(await page.getByText('No project connected.',{exact:true}).count()).toBe(0);
      expect(await page.locator('.loading-state-skeleton').isVisible()).toBe(false);
      await page.clock.runFor(149);
      expect(await page.locator('.loading-state-skeleton').isVisible()).toBe(false);
      await page.clock.runFor(1);
      expect(await page.locator('.loading-state-skeleton').isVisible()).toBe(true);
      expect(await page.getByRole('status').innerText()).toBe('Loading project…');
    }finally{await page.close();}
  });

  it('cancels delayed feedback for a fast load and shows real content immediately', async () => {
    const page=await open();try {
      await page.clock.runFor(100);await loaded(page);await page.clock.runFor(200);
      expect(await page.locator('.loading-state-skeleton').count()).toBe(0);
      expect(await page.getByRole('status').count()).toBe(0);
      expect(await page.getByText('Retained project',{exact:true}).isVisible()).toBe(true);
    }finally{await page.close();}
  });

  it('retains the loaded input, selection, focus and draft throughout refresh and read failure', async () => {
    const page=await open();try {
      await loaded(page);await page.getByRole('button',{name:'main',exact:true}).click();
      const input=page.getByRole('textbox',{name:'New branch'});await input.fill('unsent-branch');await input.focus();
      await page.evaluate(()=>{const input=document.querySelector('input')!;input.setSelectionRange(2,7);(window as unknown as FixtureWindow).savedInput=input;(window as unknown as FixtureWindow).setLoad(true);});
      await page.clock.runFor(160);
      expect(await page.locator('.loading-state-skeleton').count()).toBe(0);
      expect(await input.inputValue()).toBe('unsent-branch');
      expect(await input.evaluate(node=>node===document.activeElement&&(node as HTMLInputElement).selectionStart===2&&(node as HTMLInputElement).selectionEnd===7)).toBe(true);
      await page.evaluate(()=>(window as unknown as FixtureWindow).failLoad());
      await page.getByRole('alert').waitFor();
      expect(await input.evaluate(node=>node===(window as unknown as FixtureWindow).savedInput)).toBe(true);
      expect(await input.inputValue()).toBe('unsent-branch');
      expect(await page.getByRole('alert').innerText()).toBe('Project read failed');
    }finally{await page.close();}
  });

  it('marks the pending action busy immediately, keeps its label and draft, and recovers locally after rejection', async () => {
    const page=await open();try {
      await loaded(page);await page.getByRole('button',{name:'main',exact:true}).click();
      const input=page.getByRole('textbox',{name:'New branch'}),button=page.getByRole('button',{name:'Create branch',exact:true});
      await input.fill('preserve-on-failure');await button.click();
      expect(await button.getAttribute('aria-busy')).toBe('true');expect(await button.isDisabled()).toBe(true);
      expect(await button.innerText()).toBe('Create branch');expect(await input.inputValue()).toBe('preserve-on-failure');
      await page.clock.runFor(150);expect(await page.getByRole('status').innerText()).toBe('Updating project…');
      await page.evaluate(()=>(window as unknown as FixtureWindow).rejectAction());await page.getByRole('alert').waitFor();
      expect(await input.inputValue()).toBe('preserve-on-failure');expect(await button.isEnabled()).toBe(true);
      expect(await page.getByRole('alert').innerText()).toBe('Project action failed');
      await button.click();await page.evaluate(()=>(window as unknown as FixtureWindow).acceptAction());
      await input.waitFor({state:'hidden'});
    }finally{await page.close();}
  });

  it('ends first-load skeletons on error without inventing a connected project', async () => {
    const page=await open();try {
      await page.clock.runFor(160);await page.evaluate(()=>(window as unknown as FixtureWindow).failLoad());await page.getByRole('alert').waitFor();
      expect(await page.locator('.loading-state-skeleton').count()).toBe(0);
      expect(await page.getByRole('alert').innerText()).toBe('Project read failed');
      expect(await page.getByText('Retained project',{exact:true}).count()).toBe(0);
    }finally{await page.close();}
  });

  it('keeps skeletons static with reduced motion, app motion off and reduced transparency', async () => {
    const page=await open();try {
      const session=await page.context().newCDPSession(page);
      await session.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
      await page.evaluate(()=>{document.documentElement.className='app-shell';document.documentElement.dataset.panelAnimations='false';});await page.clock.runFor(160);
      expect(await page.locator('.loading-skeleton').count()).toBeGreaterThanOrEqual(3);
      const styles=await page.locator('.loading-skeleton').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);return {animation:style.animationName,background:style.backgroundColor,filter:style.backdropFilter};}));
      expect(styles.every(style=>style.animation==='none'&&style.filter==='none'&&style.background!=='rgba(0, 0, 0, 0)')).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }finally{await page.close();}
  });

  it('fills the tool width under the real app stylesheet instead of inheriting the legacy root loader flex layout', async () => {
    const page=await open();try {
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await page.clock.runFor(160);
      // Timer completion schedules a React commit; observe the committed state before geometry.
      await page.locator('.loading-state-skeleton[data-visible="true"]').waitFor({state:'visible'});
      const line=await page.locator('.loading-skeleton-line').first().boundingBox();
      expect(line?.width).toBeGreaterThan(180);
      expect(await page.locator('.loading-skeleton-line').first().isVisible()).toBe(true);
      await loaded(page);
      const row=await page.getByRole('button',{name:'main',exact:true}).boundingBox();
      expect(row?.width).toBeGreaterThan(340);
    }finally{await page.close();}
  });
});
