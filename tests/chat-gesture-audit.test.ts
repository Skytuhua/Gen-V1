import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser} from '@playwright/test';
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatView} from './packages/ui-shell/ChatView';createRoot(document.getElementById('root')).render(<ChatView header="Conversation"><textarea aria-label="Message"/></ChatView>);`;
describe('chat gesture lifecycle',()=>{
 let browser:Browser,script:string;
 beforeAll(async()=>{script=(await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0]!.text;browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});});
 afterAll(async()=>{await browser?.close();});
 it('cancels an active drag on window blur',async()=>{const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});try{await page.setContent('<div id="root" style="width:1000px;height:700px"></div>');await page.addScriptTag({content:script});await page.getByRole('button',{name:'Detach chat'}).click();const handle=page.getByRole('button',{name:'Move chat panel'});const box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await expect.poll(()=>page.getByRole('main',{name:'Chat'}).getAttribute('data-tracking')).toBe('true');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect.poll(()=>page.getByRole('main',{name:'Chat'}).getAttribute('data-tracking')).toBe('false');await page.mouse.up();}finally{await page.close();}});
});
