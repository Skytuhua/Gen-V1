import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser,type Page} from '@playwright/test';

const fixture=`
import React,{Suspense,startTransition,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SavedDrafts} from './apps/web/src/SavedDrafts';
const never=new Promise(()=>{});
function Block({suspend}){if(suspend){window.attempted=true;throw never;}return null;}
function App(){
 const[state,setState]=useState({disabled:false,suspend:false}),input=useRef(null);
 window.suspend=()=>startTransition(()=>setState({disabled:true,suspend:true}));
 window.disable=()=>setState({disabled:true,suspend:false});
 window.enable=()=>setState({disabled:false,suspend:false});
 return <Suspense fallback="fallback"><form><textarea ref={input}/><SavedDrafts owner={{threadId:'a',projectId:'p'}} input={input} disabled={state.disabled}/></form><Block suspend={state.suspend}/></Suspense>;
}
createRoot(document.getElementById('root')).render(<App/>);`;
const stubs:Record<string,string>={
 saved:`
const draft={id:'draft-a',name:'Saved A',text:'saved text',updatedAt:'2026-01-01',resourceRefs:[],skills:[],excerpts:[]};
export const savedDraftOwnerKey=()=> 'owner';
export const loadSavedDrafts=async()=>({library:{version:1,records:[draft]},generation:'g',nextExpiry:null});
export const subscribeSavedDrafts=()=>()=>{};
export const planDraftRestore=()=>new Promise(resolve=>{window.finishPlan=()=>resolve({draft,active:{value:'current'}})});
export const disabledReferenceValidation={enabled:false};
export const deleteSavedDraft=async()=>{};
export const restoreSavedDraftText=async()=>0;
export const saveNamedDraft=async()=>{};`,
 popover:`import React from 'react';export function Popover({open,children,contentRef}){return open?<div ref={contentRef}>{children}</div>:null}`,
 modal:`import React from 'react';export function Modal({open,title,children}){return open?<div role="dialog" aria-label={title}>{children}</div>:null}`,
};
type FixtureWindow=Window&{suspend:()=>void;disable:()=>void;enable:()=>void;finishPlan?:()=>void;attempted?:boolean};

describe('saved draft committed ownership',()=>{
 let browser:Browser,script:string;
 beforeAll(async()=>{
  script=(await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'stubs',setup(b){
   b.onResolve({filter:/^(\.\/saved-drafts|\.\.\/\.\.\/\.\.\/packages\/ui-shell\/(Popover|Modal))$/},args=>({path:args.path.endsWith('saved-drafts')?'saved':args.path.endsWith('Popover')?'popover':'modal',namespace:'stub'}));
   b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));
  }}]})).outputFiles[0]!.text;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 });
 afterAll(async()=>{await browser?.close();});
 async function pendingRestore(page:Page){
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});
  await page.getByRole('button',{name:'Saved drafts',exact:true}).click();
  await page.getByRole('button',{name:'Restore',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as FixtureWindow).finishPlan)).toBe('function');
 }
 it('keeps a pending restore available when a disabled render suspends',async()=>{
  const page=await browser.newPage();try{
   await pendingRestore(page);await page.evaluate(()=>(window as unknown as FixtureWindow).suspend());
   await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as FixtureWindow).attempted))).toBe(true);
   expect(await page.getByRole('button',{name:'Saved drafts',exact:true}).isEnabled()).toBe(true);
   await page.evaluate(()=>(window as unknown as FixtureWindow).finishPlan!());
   await expect.poll(()=>page.getByRole('dialog',{name:'Restore saved draft'}).count()).toBe(1);
  }finally{await page.close();}
 });
 it('blocks the pending restore when disabled commits and recovers after enabling',async()=>{
  const page=await browser.newPage();try{
   await pendingRestore(page);await page.evaluate(()=>(window as unknown as FixtureWindow).disable());
   await expect.poll(()=>page.getByRole('button',{name:'Saved drafts',exact:true}).isDisabled()).toBe(true);
   await page.evaluate(()=>(window as unknown as FixtureWindow).finishPlan!());
   await expect.poll(()=>page.getByText('Saving…',{exact:true}).count()).toBe(0);
   expect(await page.getByRole('dialog',{name:'Restore saved draft'}).count()).toBe(0);
   await page.evaluate(()=>(window as unknown as FixtureWindow).enable());
   await expect.poll(()=>page.getByRole('button',{name:'Restore',exact:true}).isEnabled()).toBe(true);
   await page.getByRole('button',{name:'Restore',exact:true}).click();
   await page.evaluate(()=>(window as unknown as FixtureWindow).finishPlan!());
   await expect.poll(()=>page.getByRole('dialog',{name:'Restore saved draft'}).count()).toBe(1);
  }finally{await page.close();}
 });
});
