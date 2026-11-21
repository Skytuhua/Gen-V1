/** Cold-start and render benchmark for the local harness (issue #1057).
 * `pnpm bench:startup` writes bench-results/<sha>-<timestamp>.json and prints a table.
 * Flags: `--runs N` (boot iterations, default 5), `--skip-browser` (host metrics only),
 * `--bundle` (host_boot_ms boots dist/host/main.mjs when it exists — the T03 hook),
 * `--check` (exit 1 when a metric exceeds the committed BUDGETS below). */
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {nodeSidecarArguments} from '../apps/desktop/backend-policy.ts';
import {Store} from '../packages/storage/store.ts';
import {openReviewHost} from './review-host.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const SEED_THREADS=200,SEED_MESSAGES=50,BOOT_TIMEOUT=180_000;
/** Millisecond ceilings per metric, set by the committed baseline run (issue #1057 T02).
 * `--check` asserts only filled entries; an empty object reports numbers and never fails. */
const BUDGETS:Record<string,{p50?:number;p95?:number}>={
 // Baseline e883ac0327c8 p95 x 0.9 (plan T02): post-fix targets. `--check` goes
 // green once T03-T06 land; wiring it into CI is T07. host_boot_ms has no Linux
 // baseline (guard supervisor required) so it carries no budget here.
 review_host_boot_ms:{p95:190.45},
 snapshot_serialize_ms:{p95:19.68},
 first_render_ms:{p95:754.51},
 split_interaction_ms:{p95:198.18},
 store_snapshot_ms:{p95:29.32},
};

interface RunResult{name:string;samples_ms:number[];p50:number;p95:number;mean:number;bytes?:number;note?:string}
const summarize=(name:string,samples:number[],extra:Partial<RunResult>={}):RunResult=>{
 const sorted=[...samples].sort((a,b)=>a-b),pick=(q:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)]!:0;
 return{name,samples_ms:samples.map(v=>Math.round(v*100)/100),p50:Math.round(pick(.5)*100)/100,p95:Math.round(pick(.95)*100)/100,mean:Math.round(samples.reduce((a,b)=>a+b,0)/Math.max(1,samples.length)*100)/100,...extra};
};
const freePort=()=>new Promise<number>((accept,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address(),port=typeof address==='object'&&address?address.port:0;server.close(()=>port?accept(port):reject(Error('No free loopback port.')));});});
const waitFor=<T>(promise:Promise<T>,ms:number,label:string)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error(`${label} timed out after ${ms}ms`)),ms))]);
function seedStore(store:Store){
 const day='2026-11-21T00:00:00.000Z';
 store.internal('bench.seed',null,()=>{
  for(let t=0;t<SEED_THREADS;t++){const id=`bench-thread-${t}`;store.put('thread',id,null,{id,title:`Bench thread ${t+1}`,projectName:null,createdAt:day,updatedAt:day,status:'ready',epoch:0,runId:null,modelId:null,sessionPath:null});
   for(let m=0;m<SEED_MESSAGES;m++){const mid=`bench-message-${t}-${m}`;store.put('message',mid,id,{id:mid,threadId:id,role:m%2?'assistant':'user',content:`Benchmark message ${m} — synthetic snapshot payload for cold-start sizing.`,createdAt:day,runId:null});}}
 });
}
async function seedDir(dataDir:string){const store=new Store(dataDir);try{seedStore(store);}finally{store.close();}}

interface Booted{origin:string;child:ChildProcess;dataDir:string;cookie:string;stderr:string}
/** Real desktop spawn: `node --import tsx apps/server/main.ts` (or dist/host bundle).
 * Requires the packaged guard supervisor (fd 3 broker socket + fd 4 root); on
 * platforms without it the child exits before listening and the error is
 * reported as an empty-sample metric, never retried into a fabricated number. */
async function bootSpawned(options:{seed:boolean;bundle:boolean}):Promise<{origin:string;child:ChildProcess;dataDir:string;bootMs:number;cookie:string;stderr:string}>{
 const dataDir=await mkdtemp(join(tmpdir(),'bench-harness-'));
 if(options.seed)await seedDir(dataDir);
 const port=await freePort(),widgetPort=await freePort(),stderr:string[]=[];
 const args=options.bundle&&existsSync(join(root,'dist/host/main.mjs'))?[join(root,'dist/host/main.mjs')]:nodeSidecarArguments(root);
 const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,HARNESS_DATA_DIR:dataDir,HARNESS_PORT:String(port),HARNESS_WIDGET_PORT:String(widgetPort)},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',(chunk:Buffer)=>{stderr.push(String(chunk));if(stderr.join('').length>8192)stderr.splice(0,stderr.length-8);});
 child.stdout.resume();
 const started=performance.now(),origin=`http://127.0.0.1:${port}`;
 try{
  const session=await waitFor((async()=>{
   for(;;){
    if(child.exitCode!==null||child.signalCode!==null)throw Error(`Harness exited during boot: ${stderr.join('').slice(-500)}`);
    try{
     const response=await fetch(origin+'/api/bootstrap');
     if(response.status===200){
      const cookie=/harness_session=[a-f0-9]+/.exec(response.headers.get('set-cookie')??'')?.[0];
      if(!cookie)throw Error('Bootstrap returned no session cookie.');
      return{cookie};
     }
    }catch(error){if(error instanceof Error&&error.message.startsWith('Bootstrap'))throw error;}
    await new Promise(resolve=>setTimeout(resolve,250));
   }
  })(),BOOT_TIMEOUT,'host boot');
  const bootMs=performance.now()-started;
  return{origin,child,dataDir,bootMs,...session,stderr:stderr.join('')};
 }catch(error){child.kill('SIGKILL');await rm(dataDir,{recursive:true,force:true}).catch(()=>{});throw error;}
}
async function stopSpawned(booted:Booted){
 if(booted.child.exitCode===null&&booted.child.signalCode===null){
  booted.child.kill('SIGTERM');
  try{await waitFor(new Promise(resolve=>booted.child.once('exit',resolve)),15000,'host close');}catch{booted.child.kill('SIGKILL');}
 }
 await rm(booted.dataDir,{recursive:true,force:true});
}
async function snapshotTiming(origin:string,cookie:string){
 const samples:number[]=[];let bytes=0;
 for(let i=0;i<20;i++){const started=performance.now();const response=await fetch(origin+'/api/snapshot',{headers:{cookie}});const body=await response.arrayBuffer();if(response.status!==200)throw Error(`/api/snapshot returned ${response.status}`);bytes=body.byteLength;samples.push(performance.now()-started);}
 return{samples,bytes};
}
async function sessionCookie(origin:string){
 const response=await fetch(origin+'/api/bootstrap'),setCookie=response.headers.get('set-cookie')??'';
 const cookie=/harness_session=[a-f0-9]+/.exec(setCookie)?.[0];
 if(response.status!==200||!cookie)throw Error(`/api/bootstrap returned ${response.status} without a session cookie`);
 return cookie;
}
async function browserMetrics(origin:string,runs:number,selectedThread:string){
 const first:number[]=[],split:number[]=[],fcp:number[]=[];
 const browser=await chromium.launch({headless:true});
 try{
  for(let i=0;i<runs;i++){
   const context=await browser.newContext();
   try{
    const page=await context.newPage(),started=performance.now();
    await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-thread-id]',{timeout:BOOT_TIMEOUT});
    first.push(performance.now()-started);
    const paint=await page.evaluate(()=>performance.getEntriesByType('paint').find(entry=>entry.name==='first-contentful-paint')?.startTime);
    if(typeof paint==='number')fcp.push(Math.round(paint*100)/100);
   }finally{await context.close();}
  }
  const context=await browser.newContext();
  try{
   await context.addInitScript(`try{localStorage.setItem('harness:workspace-mode:v3','split');localStorage.setItem('harness:selected-thread',${JSON.stringify(selectedThread)});}catch{}`);
   const page=await context.newPage();
   await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('.split-root-workarea',{timeout:BOOT_TIMEOUT});
   // Commands run in-page against the app's own session so CSRF/cookie match the real client;
   // each sample is command response + two painted frames.
   // String source, not a function: tsx/esbuild wraps function expressions with a
   // __name helper that does not exist inside the browser context.
   const samples=await page.evaluate(`(async()=>{
    const bootstrap=await (await fetch('/api/bootstrap',{credentials:'same-origin'})).json();
    const layout=await (await fetch('/api/split-workspace?workspaceId=workspace',{credentials:'same-origin'})).json();
    if(layout.root.kind!=='pane'||!layout.root.paneId)throw Error('Expected a fresh single-pane split layout.');
    const out=[],post=async(type,payload)=>{
     const started=performance.now(),response=await fetch('/api/split-workspace/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':bootstrap.csrfToken},body:JSON.stringify({id:crypto.randomUUID(),type:'split-workspace.'+type,payload})});
     const receipt=await response.json();
     if(response.status!==200)throw Error('split-workspace.'+type+' returned '+response.status);
     await new Promise(frame=>requestAnimationFrame(()=>requestAnimationFrame(frame)));
     out.push(performance.now()-started);
     return receipt.result?.revision;
    };
    const splitId='bench-split-'+Date.now();
    let revision=await post('pane.split',{workspaceId:'workspace',baseRevision:layout.revision,paneId:layout.root.paneId,newPaneId:'bench-pane-'+Date.now(),splitId,axis:'horizontal',ratio:.5});
    for(let i=0;i<9;i++)revision=await post('pane.resize',{workspaceId:'workspace',baseRevision:revision,splitId,ratio:i%2?.3:.7});
    return out;
   })()`) as number[];
   split.push(...samples);
  }finally{await context.close();}
 }finally{await browser.close();}
 return{first,split,fcp};
}
async function main(){
 const args=process.argv.slice(2),flag=(name:string)=>args.includes(name),value=(name:string,fallback:number)=>{const index=args.indexOf(name);return index>=0?Number(args[index+1])||fallback:fallback;};
 const runs=value('--runs',5),check=flag('--check'),bundle=flag('--bundle'),skipBrowser=flag('--skip-browser');
 const sha=execFileSync('git',['rev-parse','--short=12','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const results:RunResult[]=[];
 // host_boot_ms: the real desktop spawn shape. On hosts without the packaged
 // guard supervisor the sidecar exits before listen; the metric records the
 // observed failure rather than substituting another number.
 const bootSamples:number[]=[];let bootError:string|undefined;
 for(let i=0;i<runs;i++){try{const booted=await bootSpawned({seed:false,bundle});try{bootSamples.push(booted.bootMs);}finally{await stopSpawned(booted);}}catch(error){bootError=(error instanceof Error?error.message:String(error)).slice(0,240);break;}}
 results.push(summarize('host_boot_ms',bootSamples,{note:(bundle?'dist/host/main.mjs':'node --import tsx apps/server/main.ts')+(bootError?'; UNAVAILABLE: '+bootError:'')}));
 // review_host_boot_ms + snapshot_serialize_ms + browser metrics share
 // seeded review hosts — the plan's sanctioned in-process launch (scripts/review-host.ts).
 const reviewBoot:number[]=[];const reviewDirs:string[]=[];
 for(let i=0;i<runs;i++){const dir=await mkdtemp(join(tmpdir(),'bench-review-boot-'));reviewDirs.push(dir);const started=performance.now();const h=await openReviewHost(dir,await freePort());reviewBoot.push(performance.now()-started);await h.close();}
 results.push(summarize('review_host_boot_ms',reviewBoot,{note:'in-process Store+Service+Fastify via openReviewHost; excludes the desktop guard broker'}));
 const hostDir=await mkdtemp(join(tmpdir(),'bench-review-'));reviewDirs.push(hostDir);
 const host=await openReviewHost(hostDir,await freePort());
 try{
  seedStore(host.store);
  const origin=`http://127.0.0.1:${(host.app.addresses()[0] as {port:number}).port}`,cookie=await sessionCookie(origin);
  const timing=await snapshotTiming(origin,cookie);
  results.push(summarize('snapshot_serialize_ms',timing.samples,{bytes:timing.bytes,note:`review host + ${SEED_THREADS} threads x ${SEED_MESSAGES} messages; includes per-seq JSON cache warm reads`}));
  if(!skipBrowser){
   if(!existsSync(join(root,'dist/web/index.html')))results.push(summarize('first_render_ms',[],{note:'SKIPPED: dist/web is not built; run pnpm build first'}));
   else{
    const metrics=await browserMetrics(origin,3,'bench-thread-0');
    results.push(summarize('first_render_ms',metrics.first,{note:'goto -> [data-thread-id] visible; FCP '+JSON.stringify(metrics.fcp)}),summarize('split_interaction_ms',metrics.split,{note:'pane.split + pane.resize command -> two painted frames'}));
   }
  }
 }finally{await host.close();for(const dir of reviewDirs)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
 const storeDir=await mkdtemp(join(tmpdir(),'bench-store-'));
 try{await seedDir(storeDir);const store=new Store(storeDir);const samples:number[]=[];try{for(let i=0;i<10;i++){const started=performance.now();store.snapshot();samples.push(performance.now()-started);}}finally{store.close();}results.push(summarize('store_snapshot_ms',samples,{note:'in-process Store.snapshot() on seeded data; excludes HTTP and JSON.stringify'}));}finally{await rm(storeDir,{recursive:true,force:true});}
 const output={sha,node:process.version,platform:`${process.platform}/${process.arch}`,generatedAt:new Date().toISOString(),seed:{threads:SEED_THREADS,messages:SEED_MESSAGES},budgets:BUDGETS,runs:results};
 const outDir=join(root,'bench-results');await mkdir(outDir,{recursive:true});
 const file=join(outDir,`${sha}-${new Date().toISOString().replaceAll(/[:.]/g,'-')}.json`);await writeFile(file,JSON.stringify(output,null,2));
 for(const run of results)console.log(`${run.name.padEnd(24)} p50=${String(run.p50).padStart(9)}ms p95=${String(run.p95).padStart(9)}ms mean=${String(run.mean).padStart(9)}ms n=${run.samples_ms.length}${run.note?'  ('+run.note+')':''}`);
 console.log('wrote '+file);
 let failed=false;
 if(check)for(const run of results){const budget=BUDGETS[run.name];if(!budget)continue;if(budget.p50!==undefined&&run.p50>budget.p50){console.error(`BUDGET ${run.name} p50 ${run.p50}ms > ${budget.p50}ms`);failed=true;}if(budget.p95!==undefined&&run.p95>budget.p95){console.error(`BUDGET ${run.name} p95 ${run.p95}ms > ${budget.p95}ms`);failed=true;}}
 if(failed)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;})
 .finally(()=>{
  // Unref'd backstop: pooled fetch keep-alives/fixture internals can hold the loop
  // past the summary; exits once stdout has flushed or sooner if the loop drains.
  setTimeout(()=>process.exit(process.exitCode??0),750).unref();
 });
