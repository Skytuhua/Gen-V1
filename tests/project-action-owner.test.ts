import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, type Browser} from '@playwright/test';

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectContextSurface} from './apps/web/src/ProjectContextSurface';
function Fixture(){const [projectId,setProject]=useState('a');window.selectProject=setProject;const thread={id:'thread-a',projectId,kind:'main'};return <ProjectContextSurface thread={thread} snapshot={{threads:[thread],data:[]}}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const projectApi = `
export function useProjectContext(projectId,threadId){return {loading:false,error:'',context:{project:{id:projectId,name:projectId,rootPath:'C:/fixture',authority:{kind:'local'}},threadId,machineName:'machine',editor:{available:false,label:''},branch:'main',head:'abc',revision:'one',changes:{added:0,removed:0,files:0},lineage:[],scripts:[],capabilities:{git:true,terminal:false}},action:()=>new Promise((resolve,reject)=>{window.accept=resolve;window.reject=()=>reject(Error('old project failed'));})};}
`;
describe('project action owner',()=>{
 let browser: Browser, script: string;
 beforeAll(async()=>{
  script=(await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'stub-project-api',setup(b){b.onResolve({filter:/^\.\/project-api$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:projectApi,loader:'js'}));}}]})).outputFiles[0]!.text;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 });
 afterAll(async()=>{await browser?.close();});
 for(const outcome of ['success','error'] as const) for(const backToA of [false,true]) it(`does not apply an old project action ${outcome} after ${backToA ? "A-B-A" : "A-B"}`,async()=>{
  const page=await browser.newPage();try{
   await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});
   await page.getByRole('button',{name:'main',exact:true}).click();await page.getByLabel('New branch').fill('branch-a');await page.getByRole('button',{name:'Create branch'}).click();
   await page.evaluate(()=>{(window as any).oldAccept=(window as any).accept;(window as any).oldReject=(window as any).reject;(window as any).selectProject('b');});
   await expect.poll(()=>page.getByRole('button',{name:'main',exact:true}).isEnabled()).toBe(true);
   if(backToA){await page.evaluate(()=>(window as any).selectProject('a'));await expect.poll(()=>page.getByRole('button',{name:'main',exact:true}).isEnabled()).toBe(true);}
   await page.getByRole('button',{name:'main',exact:true}).click();await page.getByLabel('New branch').fill('branch-b');
   await page.evaluate(outcome=>outcome==='success'?(window as any).oldAccept():(window as any).oldReject(),outcome);
   await expect.poll(()=>page.getByLabel('New branch').inputValue()).toBe('branch-b');expect(await page.getByRole('alert').count()).toBe(0);
  }finally{await page.close();}
 });
});
