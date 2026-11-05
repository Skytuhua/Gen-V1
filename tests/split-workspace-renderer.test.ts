import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

describe.runIf(process.env.GEN_SPLIT_RENDERER_BROWSER==='1')('split renderer browser interaction',()=>{
let browser:Browser,script:string,css:string;
const fixture=`
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceSplitLayout} from './apps/web/src/WorkspaceSplitLayout.tsx';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from './packages/core/split-workspace-layout.ts';
let initial=createSplitWorkspaceLayout('test-layout');
initial=applySplitWorkspaceCommand(initial,'view.open',{view:{id:'one',kind:'thread',binding:{authority:{kind:'local'},threadId:'one'}}});
initial=applySplitWorkspaceCommand(initial,'pane.split',{paneId:'pane-main',newPaneId:'right',splitId:'columns',axis:'horizontal',view:{id:'two',kind:'thread',binding:{authority:{kind:'local'},threadId:'two'}}});
window.mounts={};window.commands=[];window.flushRejected=false;
function Editor({id,active}){const[value,setValue]=useState('');useEffect(()=>{window.mounts[id]=(window.mounts[id]||0)+1;},[]);return <div><label>{id}<input aria-label={'Draft '+id} value={value} onChange={e=>setValue(e.target.value)}/></label><iframe title={'Frame '+id} srcDoc='<input value="same renderer"/>'/><span>{active?'visible':'hidden'}</span></div>}
function Fixture(){const[layout,setLayout]=useState(initial);window.currentLayout=layout;window.issue=(type,payload)=>setLayout(current=>applySplitWorkspaceCommand(current,type,payload));return <WorkspaceSplitLayout layout={layout} showHistory={false} editorOptions={[{id:'thread',title:'Conversation'},{id:'diff',title:'Diff'}]} onSelectEditor={async()=>{}} onDropThread={async()=>{window.threadDrops=(window.threadDrops||0)+1;}} title={view=>view.id} prepare={async()=>{if(window.flushRejected)throw Error('Draft flush failed. Keep this view open.');}} onCommand={async(type,payload)=>{window.commands.push({type,payload});setLayout(current=>applySplitWorkspaceCommand(current,type,payload));}} renderView={(view,active)=><Editor id={view.id} active={active}/>}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
beforeAll(async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const bundled=await build({stdin:{contents:fixture,resolveDir:root,sourcefile:'split-renderer-fixture.tsx',loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},logLevel:'silent'});
 script=bundled.outputFiles[0]!.text;css=await readFile(new URL('../apps/web/src/workspace-split.css',import.meta.url),'utf8');
 browser=await chromium.launch({headless:true,...(process.env.GEN_TEST_BROWSER_CHANNEL?{channel:process.env.GEN_TEST_BROWSER_CHANNEL}:{})});
});
afterAll(async()=>{await browser?.close();});
async function page(){const page=await browser.newPage({viewport:{width:1440,height:900}});await page.setContent('<html><head></head><body style="margin:0"><div id="root" style="display:flex;height:100vh"></div></body></html>');await page.addStyleTag({content:css});await page.addScriptTag({content:script});await page.getByRole('textbox',{name:'Draft one'}).waitFor({state:'visible'});return page;}
async function issue(page:Page,type:string,payload:Record<string,unknown>){await page.evaluate(({type,payload})=>(window as unknown as {issue:(type:string,payload:Record<string,unknown>)=>void}).issue(type,payload),{type,payload});}

it('keeps editor DOM, values and iframe instance when moving and parking views',async()=>{
 const tab=await page();try{
  await tab.getByRole('textbox',{name:'Draft one'}).fill('keep this draft');
  await tab.evaluate(()=>{const globals=window as unknown as {savedInput:Element|null;savedFrame:Window|null};globals.savedInput=document.querySelector('[aria-label="Draft one"]');globals.savedFrame=(document.querySelector('[title="Frame one"]') as HTMLIFrameElement).contentWindow;});
  await issue(tab,'view.move',{viewId:'one',paneId:'right'});await tab.getByRole('textbox',{name:'Draft one'}).waitFor({state:'visible'});
  expect(await tab.getByRole('textbox',{name:'Draft one'}).inputValue()).toBe('keep this draft');
  expect(await tab.evaluate(()=>{const globals=window as unknown as {savedInput:Element|null;savedFrame:Window|null;mounts:Record<string,number>};return globals.savedInput===document.querySelector('[aria-label="Draft one"]')&&globals.savedFrame===(document.querySelector('[title="Frame one"]') as HTMLIFrameElement).contentWindow&&globals.mounts.one===1;})).toBe(true);
  await issue(tab,'view.park',{viewId:'one'});await tab.getByRole('textbox',{name:'Draft one'}).waitFor({state:'hidden'});
  await issue(tab,'view.move',{viewId:'one',paneId:'pane-main'});await tab.getByRole('textbox',{name:'Draft one'}).waitFor({state:'visible'});expect(await tab.getByRole('textbox',{name:'Draft one'}).inputValue()).toBe('keep this draft');
 }finally{await tab.close();}
});
it('supports keyboard divider movement and cancels pointer previews without a command',async()=>{
 const tab=await page();try{
  const divider=tab.getByRole('separator',{name:'Resize columns'});await divider.focus();await divider.press('ArrowRight');await tab.waitForFunction(()=>(window as unknown as {currentLayout:{root:{ratio:number}}}).currentLayout.root.ratio>.5);
  const before=await tab.evaluate(()=>(window as unknown as {commands:unknown[]}).commands.length),box=await divider.boundingBox();if(!box)throw Error('Missing divider bounds');
  await tab.mouse.move(box.x+box.width/2,box.y+120);await tab.mouse.down();await tab.mouse.move(box.x+100,box.y+120);await tab.keyboard.press('Escape');await tab.mouse.up();
  expect(await tab.evaluate(()=>(window as unknown as {commands:unknown[]}).commands.length)).toBe(before);
  expect(await divider.getAttribute('aria-valuenow')).toBe('51');
 }finally{await tab.close();}
});
it('retains layout when draft flush fails and restores desktop geometry after narrow mode',async()=>{
 const tab=await page();try{
  await tab.evaluate(()=>(window as unknown as {flushRejected:boolean}).flushRejected=true);
  await tab.locator('[data-split-pane="right"] .split-area-menu summary').click();await tab.getByRole('button',{name:'Join adjacent area'}).click();
  await tab.getByRole('alert').waitFor({state:'visible'});expect(await tab.locator('[data-split-pane]').count()).toBe(2);
  await tab.setViewportSize({width:500,height:900});await tab.getByRole('combobox',{name:'Active workspace area'}).waitFor({state:'visible'});expect(await tab.locator('[data-split-pane]').count()).toBe(1);
  await tab.setViewportSize({width:1440,height:900});await tab.waitForFunction(()=>document.querySelectorAll('[data-split-pane]').length===2);
  expect(await tab.evaluate(()=>(window as unknown as {mounts:Record<string,number>}).mounts)).toEqual({one:1,two:1});
 }finally{await tab.close();}
});
it('moves a dragged tab to the center target and minimizes to a reachable strip',async()=>{
 const tab=await page();try{
  const dataTransfer=await tab.evaluateHandle(()=>new DataTransfer());
  await tab.locator('[data-split-pane="right"] [role="tab"]').dispatchEvent('dragstart',{dataTransfer});
  const target=await tab.locator('[data-split-pane="pane-main"] .split-pane-slot').boundingBox();if(!target)throw Error('Missing target area');
  await tab.locator('.split-workspace').dispatchEvent('dragover',{dataTransfer,clientX:target.x+target.width/2,clientY:target.y+target.height/2});
  await tab.locator('.split-workspace').dispatchEvent('drop',{dataTransfer,clientX:target.x+target.width/2,clientY:target.y+target.height/2});
  await tab.waitForFunction(()=>(window as unknown as {currentLayout:{panes:Record<string,{activeViewId:string}>}}).currentLayout.panes['pane-main']!.activeViewId==='two');
  expect(await tab.evaluate(()=>(window as unknown as {mounts:Record<string,number>}).mounts)).toEqual({one:1,two:1});
  await tab.locator('[data-split-pane="right"]').getByRole('button',{name:'Minimize area'}).click();
  await tab.waitForFunction(()=>document.querySelector('[data-split-pane="right"]')!.getBoundingClientRect().width<=37);
  const restore=tab.locator('[data-split-pane="right"]').getByRole('button',{name:'Restore area'});expect(await restore.isVisible()).toBe(true);await restore.click();await tab.waitForFunction(()=>document.querySelector('[data-split-pane="right"]')!.getBoundingClientRect().width>100);
 }finally{await tab.close();}
});
it('rejects an incoming conversation that cannot fit its actual minimum',async()=>{
 const tab=await page();try{
  await issue(tab,'pane.join',{paneId:'right'});await tab.setViewportSize({width:600,height:700});await tab.waitForFunction(()=>document.querySelectorAll('[data-split-pane]').length===1);
  const target=await tab.locator('[data-split-pane="pane-main"] .split-pane-slot').boundingBox();if(!target)throw Error('Missing pane');
  const dataTransfer=await tab.evaluateHandle(()=>{const data=new DataTransfer();data.setData('application/x-gen-thread',JSON.stringify({threadId:'two',binding:{authority:{kind:'local'},threadId:'two'}}));return data;});
  await tab.locator('.split-workspace').dispatchEvent('drop',{dataTransfer,clientX:target.x+target.width-1,clientY:target.y+target.height/2});
  await tab.waitForTimeout(30);expect(await tab.evaluate(()=>(window as unknown as {threadDrops?:number}).threadDrops??0)).toBe(0);
  expect(await tab.getByRole('alert').textContent()).toContain('larger');
 }finally{await tab.close();}
});
it('keeps editor and recovery controls reachable inside a short pane',async()=>{
 const tab=await page();try{
  await issue(tab,'pane.join',{paneId:'right'});await tab.setViewportSize({width:900,height:270});await tab.locator('[data-split-pane="pane-main"] .split-area-menu summary').click();
  const bounds=await tab.locator('.split-area-menu-body').boundingBox(),pane=await tab.locator('[data-split-pane="pane-main"]').boundingBox();
  expect(bounds).not.toBeNull();expect(pane).not.toBeNull();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(pane!.y+pane!.height);
  await tab.getByRole('combobox',{name:'Recover parked view'}).scrollIntoViewIfNeeded();expect(await tab.getByRole('combobox',{name:'Recover parked view'}).isVisible()).toBe(true);
 }finally{await tab.close();}
});

});
