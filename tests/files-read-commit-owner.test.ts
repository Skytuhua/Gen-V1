import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,type Browser} from '@playwright/test';
const fixture=`
import React,{Suspense,startTransition,useState} from 'react';import {createRoot} from 'react-dom/client';import {useFilesRead} from './apps/web/src/files/useFilesRead';
const never=new Promise(()=>{});const read=()=>new Promise((resolve,reject)=>{window.acceptA=()=>resolve('accepted A');window.rejectA=()=>reject(Error('A read failed'));});
function Reader({owner}){const state=useFilesRead(owner,true,read);if(owner==='B'){window.bRendered=true;throw never;}return <div><span data-testid="value">{state.value||''}</span><span data-testid="error">{state.error}</span><span data-testid="pending">{String(state.pending)}</span></div>;}
function App(){const[owner,setOwner]=useState('A');window.startB=()=>startTransition(()=>setOwner('B'));return <Suspense fallback="fallback"><Reader owner={owner}/></Suspense>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
describe('file read committed ownership',()=>{
 let browser:Browser,script:string;
 beforeAll(async()=>{script=(await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0]!.text;browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});});
 afterAll(async()=>{await browser?.close();});
 for(const outcome of ['success','error'] as const)it(`keeps A's ${outcome} when B renders but never commits`,async()=>{const page=await browser.newPage();try{await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});await expect.poll(()=>page.evaluate(()=>typeof window.acceptA)).toBe('function');await page.evaluate(()=>window.startB());await expect.poll(()=>page.evaluate(()=>Boolean(window.bRendered))).toBe(true);await page.evaluate(outcome=>outcome==='success'?window.acceptA():window.rejectA(),outcome);await expect.poll(()=>page.getByTestId(outcome==='success'?'value':'error').textContent()).toBe(outcome==='success'?'accepted A':'A read failed');expect(await page.getByTestId('pending').textContent()).toBe('false');}finally{await page.close();}});
});
