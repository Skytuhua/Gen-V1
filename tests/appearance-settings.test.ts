import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser,type Page} from '@playwright/test';

let browser:Browser,script:string;
beforeAll(async()=>{
 const output=await build({stdin:{contents:`import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppearanceSettings} from './apps/web/src/AppearanceSettings';
import {DEFAULT_PREFERENCES} from './packages/contracts/preferences';
window.createImageBitmap=()=>new Promise(resolve=>{window.releaseImage=()=>resolve({width:1,height:1,close(){}});});
const Reader=window.FileReader;
window.FileReader=class extends Reader {constructor(){super();this.addEventListener('loadend',()=>queueMicrotask(()=>window.imageRead=true));}};
createRoot(document.getElementById('root')).render(<AppearanceSettings preferences={DEFAULT_PREFERENCES} theme="dark" threads={[]} busy={false} save={async patch=>{window.savedAppearance=patch;return true;}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
 script=output.outputFiles[0]!.text;
 browser=await chromium.launch({headless:true,...(process.env.GEN_TEST_BROWSER_CHANNEL?{channel:process.env.GEN_TEST_BROWSER_CHANNEL}:{})});
},60000);
afterAll(async()=>{await browser?.close();});
async function fixture(){const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});await page.getByRole('button',{name:'violet accent',exact:true}).waitFor();return page;}
async function beginUpload(page:Page){
 await page.locator('input[type=file]').setInputFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(()=>typeof(window as any).releaseImage==='function');
}
async function finishUpload(page:Page){await page.evaluate(()=>(window as any).releaseImage());await page.waitForFunction(()=>(window as any).imageRead===true);}

describe('appearance image upload races',()=>{
 it('preserves later accent edits when a pending image read completes',async()=>{
  const page=await fixture();try{
   await beginUpload(page);await page.getByRole('button',{name:'violet accent',exact:true}).click();await finishUpload(page);
   expect(await page.getByRole('button',{name:'violet accent',exact:true}).getAttribute('aria-pressed')).toBe('true');
   await page.getByRole('button',{name:'Apply',exact:true}).click();
   expect(await page.evaluate(()=>(window as any).savedAppearance)).toMatchObject({appearanceAccent:'violet',backgroundStyle:'image'});
  }finally{await page.close();}
 });
 it('keeps Reset appearance effective after a pending image read completes',async()=>{
  const page=await fixture();try{
   await beginUpload(page);await page.getByRole('button',{name:'Reset appearance',exact:true}).click();await finishUpload(page);
   expect(await page.getByRole('combobox',{name:'Workspace background',exact:true}).inputValue()).toBe('solid');
  }finally{await page.close();}
 });
});
