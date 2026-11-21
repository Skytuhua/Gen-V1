import {afterAll,beforeAll,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as browserExpect,type Browser} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

let browser:Browser,server:Server,origin:string;
beforeAll(async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{startTransition,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
  import {PluginFloatingWindow} from './apps/web/src/PluginFloatingWindow';
  const held=new Promise(()=>{});function Gate({id,hidden}){if(id==='suspended'||hidden){window.speculativeRendered=true;throw held}return null}
  function App(){const [id,setId]=useState('A'),[hidden,setHidden]=useState(false);window.switchWindow=setId;window.suspendWindow=()=>startTransition(()=>setId('suspended'));window.hideWindow=()=>flushSync(()=>setHidden(true));window.revealWindow=()=>flushSync(()=>setHidden(false));return <React.Suspense fallback={<p>Loading</p>}><span>Owner {id}</span><PluginFloatingWindow id={id} title={id}><p>Content {id}</p></PluginFloatingWindow><Gate id={id} hidden={hidden}/></React.Suspense>}
  createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},plugins:[{name:'synthetic-journal',setup(builder){
  builder.onResolve({filter:/plugin-frame-client$/},args=>args.importer.endsWith('PluginFloatingWindow.tsx')?{path:'journal',namespace:'fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
   const intents=new Map();window.fixtureJournal={};
   export const journalRead=async()=>{window.fixtureJournal.reads=(window.fixtureJournal.reads??0)+1;if(location.search.includes('hold-read'))return new Promise((resolve,reject)=>{window.fixtureJournal.resolveRead=()=>resolve({width:320,collapsed:false});window.fixtureJournal.rejectRead=()=>reject(Error('synthetic read failure'));});return {width:320,collapsed:false}};export const journalReadRetainingIntent=journalRead;
   export const journalLocalIntent=key=>intents.get(key);
   export function journalWrite(key,value){let reject;const pending=new Promise((_,fail)=>{reject=fail});const entry={value,pending,identity:{}};intents.set(key,entry);window.fixtureJournal.reject=()=>reject(Error('synthetic failure'));void pending.catch(()=>{if(intents.get(key)===entry)entry.pending=null});return pending;}
   export const registerEditorHandoff=()=>()=>{};export const retryJournalWrites=async()=>{};
  `}));
 }}]});
 server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(`<div id="root"></div><script>${bundle.outputFiles[0]!.text}</script>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;browser=await chromium.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
it('keeps B clean and restores A\'s failed layout after a late write failure',async()=>{
 const page=await browser.newPage();try{
  await page.goto(origin);await page.getByRole('button',{name:'Minimize A'}).click();await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();
  await page.evaluate(()=>window.switchWindow('B'));await browserExpect(page.getByRole('button',{name:'Minimize B'})).toBeVisible();
  await page.evaluate(()=>window.fixtureJournal.reject!());await browserExpect(page.getByRole('status')).toHaveCount(0);
  await page.evaluate(()=>window.switchWindow('A'));await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();await browserExpect(page.getByRole('status')).toContainText('could not be saved');
 }finally{await page.close();}
});
it('keeps the committed owner when a replacement render suspends',async()=>{
 const page=await browser.newPage();try{
  await page.goto(origin);await page.getByRole('button',{name:'Minimize A'}).click();await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();
  await page.evaluate(()=>window.suspendWindow());await page.waitForFunction(()=>window.speculativeRendered===true);
  await page.evaluate(()=>window.fixtureJournal.reject!());await browserExpect(page.getByRole('status')).toContainText('could not be saved');
  await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();
 }finally{await page.close();}
});

it.each(['success','failure'] as const)('retains pending recovery %s through an urgent Suspense hide and reveal',async outcome=>{
 const page=await browser.newPage();try{
  await page.goto(origin+'?hold-read');await browserExpect(page.getByText('Owner A',{exact:true})).toBeVisible();
  await page.waitForFunction(()=>window.fixtureJournal.reads===1);
  await page.evaluate(()=>window.hideWindow());
  await browserExpect(page.getByText('Loading',{exact:true})).toBeVisible();await browserExpect(page.getByText('Owner A',{exact:true})).toBeHidden();
  await page.evaluate(async outcome=>{const journal=window.fixtureJournal;journal[outcome==='success'?'resolveRead':'rejectRead']!();await new Promise(resolve=>setTimeout(resolve,0));},outcome);
  await page.evaluate(()=>window.revealWindow());await browserExpect(page.getByText('Owner A',{exact:true})).toBeVisible();
  await browserExpect.poll(()=>page.evaluate(()=>window.fixtureJournal.reads)).toBe(1);
  if(outcome==='success'){
   await browserExpect(page.getByRole('button',{name:'Minimize A'})).toBeVisible();await browserExpect(page.getByText('Content A',{exact:true})).toBeVisible();
  }else{
   await browserExpect(page.getByRole('status')).toContainText('could not be recovered');await page.getByRole('button',{name:'Retry recovery'}).click();
   await page.waitForFunction(()=>window.fixtureJournal.reads===2);await page.evaluate(()=>window.fixtureJournal.resolveRead!());
   await browserExpect(page.getByRole('button',{name:'Minimize A'})).toBeVisible();await browserExpect(page.getByRole('status')).toHaveCount(0);
  }
 }finally{await page.close();}
});
