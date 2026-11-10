import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as browserExpect,type Browser,type Frame,type Locator} from '@playwright/test';
import {resolve} from 'node:path';
import {pluginToolsDockEntry,pluginToolsParent} from './fixtures/plugin-tools-dock';

let browser:Browser,javascript:string,css:string,presentationImports:string[];
beforeAll(async()=>{
 const pluginSource=resolve('plugins/personal-visuals/src');
 const bundle=await build({stdin:{contents:pluginToolsDockEntry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,metafile:true,outfile:'plugin.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},logOverride:{'empty-import-meta':'silent'},plugins:[{
  name:'shared-plugin-presentation',
  setup(builder){
   // Match the installed plug-in build. CI installs its own React package;
   // its hooks must still use the host renderer's React, as the SDK requires.
   builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>{
    if(args.resolveDir!==pluginSource)return;
    return {path:resolve(pluginSource,args.path==='react'?'react.ts':'jsx-runtime.ts')};
   });
  },
 }]});
 javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text;css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))!.text;
 presentationImports=Object.entries(bundle.metafile!.inputs).find(([path])=>path.replaceAll('\\','/')==='plugins/personal-visuals/src/frontend.tsx')![1].imports.map(value=>value.path.replaceAll('\\','/'));
 browser=await chromium.launch({headless:true,...(process.env.GEN_TEST_CHROMIUM_EXECUTABLE?{executablePath:process.env.GEN_TEST_CHROMIUM_EXECUTABLE}:{})});
},30000);
afterAll(async()=>{await browser?.close();});

it('uses the host presentation runtime instead of a plug-in-local React copy',()=>{
 expect(presentationImports).toEqual(expect.arrayContaining(['plugins/personal-visuals/src/react.ts','plugins/personal-visuals/src/jsx-runtime.ts']));
});

const legacy={x:1124,y:72,width:300,height:180,collapsed:false,floating:true};
async function fixture(width:number,saved:unknown=null,failReads=false,delayReads=false){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors:string[]=[];
 page.setDefaultTimeout(3000);
 page.on('pageerror',error=>errors.push(error.message));
 if(delayReads)await page.addInitScript(()=>{
  // Observe every frame, starting before the runtime mounts, so a fallback
  // split painted while journalRead is pending cannot escape the assertion.
  const frames:Record<string,{x:number;y:number;width:number;height:number}>[]=[];
  (window as any).dockFrames=frames;
  const sample=()=>{
   const dock=document.querySelector('.ui-tool-dock');
   if(dock?.getBoundingClientRect().width){
    const selectors={dock:'.ui-tool-dock',workarea:'#root',inspector:'.pv-inspector',canvas:'.pv-canvas',diagram:'.pv-canvas-viewport'};
    frames.push(Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{const {x,y,width,height}=document.querySelector(selector)!.getBoundingClientRect();return [name,{x,y,width,height}];})));
   }
   requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 });
 await page.route('http://127.0.0.1/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const body=path==='/plugin.js'?javascript:path==='/plugin.css'?css:path==='/plugin'?'<html data-theme="dark"><head><meta name="gen-plugin-id" content="personal-visuals"><link rel="stylesheet" href="/plugin.css"></head><body><div id="root"></div><script src="/plugin.js"></script></body></html>':pluginToolsParent.replace('window.saved=null;window.failReads=false;window.delayReads=false;',`window.saved=${JSON.stringify(saved)};window.failReads=${failReads};window.delayReads=${delayReads};`);
  return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://127.0.0.1/plugin-dock-test');
 const frame=page.frames().find(value=>value.parentFrame())!;
 try{
  // Document recovery emits ready independently of the dock's journal read.
  await page.waitForFunction(()=>(window as any).visualReady===true);
  await frame.getByRole('button',{name:'Edit',exact:true}).waitFor({state:'visible'});
 }catch(cause){
  await page.close();
  throw new Error(`Plug-in fixture failed before Edit became visible. Browser errors: ${errors.join('; ')||'none'}`,{cause});
 }
 return {page,frame,errors};
}
async function box(locator:Locator){const bounds=await locator.boundingBox();expect(bounds).not.toBeNull();return bounds!;}
async function disjoint(a:Locator,b:Locator){const first=await box(a),second=await box(b);expect(first.x+first.width<=second.x+1||second.x+second.width<=first.x+1||first.y+first.height<=second.y+1||second.y+second.height<=first.y+1).toBe(true);}
async function geometry(frame:Frame,width:number){
 const tool=frame.getByRole('region',{name:'Plugin tools window',exact:true}),inspector=frame.getByRole('complementary',{name:'Visual source inspector'});
 await tool.waitFor();
 for(const surface of [inspector,frame.locator('.pv-canvas'),frame.locator('.pv-canvas-tools'),frame.locator('.pv-header')])await disjoint(tool,surface);
 const bounds=await box(tool);expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(1000);
 for(const name of ['Fit','Zoom out diagram','Zoom in diagram'])await frame.getByRole('button',{name,exact:true}).click();
 const list=inspector.locator('details').filter({hasText:'Accessible document list'});
 if(await list.getAttribute('open')===null)await list.locator('summary').click();
 await inspector.getByRole('button',{name:'Database',exact:true}).click();
 expect(await inspector.locator('h2').textContent()).toBe('Database');
 return {tool,inspector};
}

it.each([768,1024,1440])('keeps tools, diagram controls and readable inspector separate at %ipx, including recovered free placement',async width=>{
 const {page,frame,errors}=await fixture(width,legacy);
 try{
  const {tool,inspector}=await geometry(frame,width);
  if(width>=1024){expect((await box(inspector)).width).toBeGreaterThanOrEqual(224);await browserExpect(inspector.getByText('Illustrative example',{exact:true})).toBeVisible();}
  await page.keyboard.press('Tab');
  const disclosure=tool.getByRole('button',{name:'Minimize Plugin tools',exact:true});await disclosure.focus();
  expect(await disclosure.evaluate(node=>{const style=getComputedStyle(node);return node.matches(':focus-visible')&&style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0;})).toBe(true);
  await page.keyboard.press('Tab');
  const summary=inspector.locator('summary').first();await summary.focus();expect(await summary.evaluate(node=>{const style=getComputedStyle(node);return node.matches(':focus-visible')&&parseFloat(style.outlineWidth)>0;})).toBe(true);
  expect(errors).toEqual([]);
 }finally{await page.close();}
});

it.each([
 {width:1024,saved:{...legacy,width:720},preferredWidth:720},
 {width:1440,saved:{...legacy,width:720},preferredWidth:720},
 {width:1024,saved:null,preferredWidth:400},
 {width:1440,saved:{...legacy,width:undefined},preferredWidth:400},
])('uses the settled split on its first visible frame after a delayed read at $width px (preferred $preferredWidth)',async({width,saved,preferredWidth})=>{
 const {page,frame,errors}=await fixture(width,saved,false,true);
 try{
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).pendingReads.length)).toBe(1);
  await frame.evaluate(async()=>{for(let count=0;count<4;count++)await new Promise(requestAnimationFrame);});
  expect(await frame.evaluate(()=>(window as any).dockFrames.length)).toBe(0);
  await browserExpect(frame.getByRole('complementary',{name:'Tools',exact:true})).toBeHidden();
  await expect(frame.evaluate(()=>(window as any).GenPluginUI.pluginFlush())).rejects.toThrow();
  expect(await page.evaluate(()=>(window as any).calls.filter((call:any)=>call.operation==='state.write'))).toEqual([]);
  await page.evaluate(()=>{(window as any).delayReads=false;for(const reply of (window as any).pendingReads.splice(0))reply();});
  await frame.getByRole('button',{name:'Minimize Plugin tools',exact:true}).waitFor();
  await frame.evaluate(async()=>{for(let count=0;count<12;count++)await new Promise(requestAnimationFrame);});
  const frames=await frame.evaluate(()=>(window as any).dockFrames) as Record<string,{x:number;y:number;width:number;height:number}>[];
  expect(frames.length).toBeGreaterThanOrEqual(12);
  expect(frames[0].dock.width).toBe(Math.min(preferredWidth,width-426));
  expect(frames[0].workarea.width).toBe(width-6-frames[0].dock.width);
  for(const snapshot of frames)expect(snapshot).toEqual(frames[0]);
  await geometry(frame,width);expect(errors).toEqual([]);
 }finally{await page.close();}
});

it('expands on reopening when an expansion request arrived while collapsed and closed',async()=>{
 const {page,frame,errors}=await fixture(1024,{...legacy,collapsed:true});
 try{
  const tool=frame.getByRole('region',{name:'Plugin tools window',exact:true,includeHidden:true}),draft=tool.getByRole('textbox',{name:'Tool draft'});
  await tool.getByRole('button',{name:'Expand Plugin tools',exact:true}).waitFor();
  await tool.getByRole('button',{name:'Close Plugin tools',exact:true}).click();await browserExpect(tool).toBeHidden();
  await frame.evaluate(async()=>{(window as any).setToolsExpandRequest(1);await new Promise(requestAnimationFrame);});
  await browserExpect(tool).toHaveAttribute('data-collapsed','true');
  await frame.evaluate(()=>(window as any).setToolsOpen(true));
  await browserExpect(draft).toBeVisible();await browserExpect(tool.getByRole('button',{name:'Minimize Plugin tools',exact:true})).toHaveAttribute('aria-expanded','true');
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).saved)).toEqual(legacy);expect(errors).toEqual([]);
 }finally{await page.close();}
});

it('suppresses Close for minimize-only windows and keeps Escape minimizing',async()=>{
 const {page,frame,errors}=await fixture(1024,legacy);
 try{
  const tool=frame.getByRole('region',{name:'Plugin tools window',exact:true}),draft=tool.getByRole('textbox',{name:'Tool draft'});
  await draft.waitFor();await frame.evaluate(()=>(window as any).setToolsMinimizeOnly(true));
  await browserExpect(tool.getByRole('button',{name:'Close Plugin tools',exact:true})).toHaveCount(0);
  await draft.press('Escape');await browserExpect(draft).toBeHidden();await browserExpect(tool).toBeVisible();
  const disclosure=tool.getByRole('button',{name:'Expand Plugin tools',exact:true});await browserExpect(disclosure).toHaveAttribute('aria-expanded','false');
  await disclosure.press('Escape');await browserExpect(tool).toBeVisible();await browserExpect(draft).toBeHidden();
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).saved)).toEqual({...legacy,collapsed:true});expect(errors).toEqual([]);
 }finally{await page.close();}
});

it('keeps drafts mounted through collapse, resize and close; journals collapse without overwriting legacy coordinates',async()=>{
 const {page,frame,errors}=await fixture(1440,legacy);
 try{
  const tool=frame.getByRole('region',{name:'Plugin tools window',exact:true}),draft=tool.getByRole('textbox',{name:'Tool draft'});
  await draft.fill('Retain my edit');const original=await draft.elementHandle();
  expect(await page.evaluate(()=>(window as any).calls.filter((call:any)=>call.operation==='state.write'))).toEqual([]);
  await tool.getByRole('button',{name:'Minimize Plugin tools',exact:true}).focus();await page.keyboard.press('Enter');
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).saved)).toEqual({...legacy,collapsed:true});
  await tool.getByRole('button',{name:'Expand Plugin tools',exact:true}).press('Enter');
  for(const width of [1024,768,1440]){await page.setViewportSize({width,height:1000});await geometry(frame,width);}
  await browserExpect(draft).toHaveValue('Retain my edit');expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);
  await tool.getByRole('button',{name:'Close Plugin tools',exact:true}).click();await browserExpect(tool).toBeHidden();
  await browserExpect.poll(()=>frame.locator('#root').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(1440);
  await frame.evaluate(()=>(window as any).setToolsOpen(true));await browserExpect(draft).toHaveValue('Retain my edit');expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).saved)).toEqual(legacy);expect(errors).toEqual([]);
 }finally{await page.close();}
});

it('retains recovery and journal retry barriers for the dock',async()=>{
 const {page,frame}=await fixture(1024,legacy,true);
 try{
  await frame.getByRole('button',{name:'Retry recovery',exact:true}).waitFor();
  expect((await box(frame.getByRole('complementary',{name:'Tools',exact:true}))).width).toBe(400);
  await expect(frame.evaluate(()=>(window as any).GenPluginUI.pluginFlush())).rejects.toThrow();
  expect(await page.evaluate(()=>(window as any).calls.filter((call:any)=>call.operation==='state.write'))).toEqual([]);
  await page.evaluate(()=>{(window as any).failReads=false;(window as any).failWrites=true;});
  await frame.getByRole('button',{name:'Retry recovery',exact:true}).click();
  await frame.getByRole('button',{name:'Minimize Plugin tools',exact:true}).click();
  await frame.getByRole('button',{name:'Retry saving',exact:true}).waitFor();
  await expect(frame.evaluate(()=>(window as any).GenPluginUI.pluginFlush())).rejects.toThrow();
  await page.evaluate(()=>{(window as any).failWrites=false;});await frame.getByRole('button',{name:'Retry saving',exact:true}).click();
  await browserExpect.poll(()=>page.evaluate(()=>(window as any).saved)).toEqual({...legacy,collapsed:true});
  await frame.evaluate(()=>(window as any).GenPluginUI.pluginFlush());
 }finally{await page.close();}
});
