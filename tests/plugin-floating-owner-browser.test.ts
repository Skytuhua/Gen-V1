import {afterAll,beforeAll,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as browserExpect,type Browser} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

let browser:Browser,server:Server,origin:string;
beforeAll(async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{startTransition,useState} from 'react';import {createRoot} from 'react-dom/client';
  import {PluginFloatingWindow} from './apps/web/src/PluginFloatingWindow';
  const held=new Promise(()=>{});function Gate({id}){if(id==='suspended'){window.speculativeRendered=true;throw held}return null}
  function App(){const [id,setId]=useState('A');window.switchWindow=setId;window.suspendWindow=()=>startTransition(()=>setId('suspended'));return <React.Suspense fallback={<p>Loading</p>}><PluginFloatingWindow id={id} title={id}><p>Content {id}</p></PluginFloatingWindow><Gate id={id}/></React.Suspense>}
  createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},plugins:[{name:'synthetic-journal',setup(builder){
  builder.onResolve({filter:/plugin-frame-client$/},args=>args.importer.endsWith('PluginFloatingWindow.tsx')?{path:'journal',namespace:'fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
   const intents=new Map();window.fixtureJournal={};
   export const journalRead=async()=>({width:320,collapsed:false});export const journalReadRetainingIntent=journalRead;
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
  await page.evaluate(()=>(window as any).switchWindow('B'));await browserExpect(page.getByRole('button',{name:'Minimize B'})).toBeVisible();
  await page.evaluate(()=>(window as any).fixtureJournal.reject());await browserExpect(page.getByRole('status')).toHaveCount(0);
  await page.evaluate(()=>(window as any).switchWindow('A'));await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();await browserExpect(page.getByRole('status')).toContainText('could not be saved');
 }finally{await page.close();}
});
it('keeps the committed owner when a replacement render suspends',async()=>{
 const page=await browser.newPage();try{
  await page.goto(origin);await page.getByRole('button',{name:'Minimize A'}).click();await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();
  await page.evaluate(()=>(window as any).suspendWindow());await page.waitForFunction(()=>(window as any).speculativeRendered===true);
  await page.evaluate(()=>(window as any).fixtureJournal.reject());await browserExpect(page.getByRole('status')).toContainText('could not be saved');
  await browserExpect(page.getByRole('button',{name:'Expand A'})).toBeVisible();
 }finally{await page.close();}
});
