import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertInstalledControlProvenance,runInstalledBrowserControlScenario,type InstalledControlProvenance,type ScenarioPage} from '../scripts/m16-installed-control-scenario.ts';

type JsonRow=Record<string,unknown>&{phase:string};

const ORIGIN='http://127.0.0.1:4317';
const TARGET={kind:'BROWSER_TAB',creationIdentity:'tab:browser-1@7',sessionIdentity:'nav|1|geo|0|0|800|600|dpi|1',origin:'https://fixture.example'};

function pngBytes(width:number,height:number){
 const buffer=Buffer.alloc(33);
 buffer.writeUInt32BE(0x89504e47,0);buffer.writeUInt32BE(0x0d0a1a0a,4);
 buffer.writeUInt32BE(13,8);buffer.write('IHDR',12,'latin1');
 buffer.writeUInt32BE(width,16);buffer.writeUInt32BE(height,20);
 return buffer;
}

const provenance:InstalledControlProvenance={
 sourceSha:'4110b56a3fc0b7cc81be0af7712bb90933f13428',
 packageVersion:'1.2.3',
 installerSha256:'a'.repeat(64),
 executableSha256:'b'.repeat(64),
 payloadSha256:'c'.repeat(64),
};

/** A scripted renderer + backend: the fake evaluate dispatches on the
 * function shape the scenario sends — bootstrap, browser open, or the
 * fetch(path) relay — and answers with a small state machine that mirrors the
 * production consent/grant/capture/stop semantics, writing real PNG bytes
 * under the disposable profile's host root. */
function fakeHost(directory:string,options:{tamperArtifact?:boolean;wrongTarget?:boolean;allowPostStopCapture?:boolean}={}){
 let browserOpen=false,consent:'none'|'pending'|'granted'|'stopped'='none',artifactPng=pngBytes(800,600);
 const grantTarget=options.wrongTarget?{...TARGET,creationIdentity:'tab:browser-9@7'}:TARGET;
 const routes=async(path:string,init?:{method?:string;body?:unknown})=>{
  const body=(init?.body??{}) as Record<string,unknown>;
  if(path==='/api/commands'){
   const type=String(body.type),threadId=body.threadId as string|undefined;
   if(type==='thread.create')return {status:200,body:{result:{id:'thread-1'}}};
   if(type==='control.request'&&threadId==='thread-1'){consent='pending';return {status:200,body:{result:{consent:{consentId:'consent-1',state:'PENDING'},control:{state:'consent'}}}}};
   if(type==='control.grant'&&threadId==='thread-1'&&consent==='pending'){consent='granted';return {status:200,body:{result:{grant:{grantId:'grant-1',capturePermission:true,permittedOperations:[],expiresAtMs:Date.now()+600000,target:grantTarget},control:{state:'active'}}}}};
   if(type==='control.stop'&&threadId==='thread-1'){consent='stopped';return {status:200,body:{result:{control:{state:'unavailable'}}}}};
   return {status:400,body:{error:{code:'INVALID_INPUT',message:'unknown command'}}};
  }
  if(path.includes('/control-targets')){
   return {status:200,body:{candidates:browserOpen?[{target:TARGET,title:'Fixture'}]:[]}};
  }
  if(path.includes('/control-capture')){
   if(consent!=='granted'&&!options.allowPostStopCapture)return {status:400,body:{error:{code:'CAPABILITY_DENIED',message:'No active control grant.'}}};
   if(consent!=='granted')return {status:200,body:{capture:{artifactRef:'control-captures/thread-1/capture-x.png',sha256:'0'.repeat(64),artifactId:'capture-x',frameDimensions:{width:1,height:1},captureScope:{kind:'TAB'}}}};
   const ref='control-captures/thread-1/capture-1.png',bytes=options.tamperArtifact?pngBytes(320,240):artifactPng;
   await mkdir(join(directory,'host','control-captures','thread-1'),{recursive:true});
   await writeFile(join(directory,'host',...ref.split('/')),bytes,{mode:0o600});
   return {status:200,body:{capture:{artifactRef:ref,sha256:createHash('sha256').update(artifactPng).digest('hex'),artifactId:'capture-1',frameDimensions:{width:800,height:600},captureScope:{kind:'TAB'}}}};
  }
  if(path.includes('/control-observe'))return {status:200,body:{observation:{observationId:'obs-1'}}};
  if(path.includes('/control-action'))return {status:400,body:{error:{code:'CAPABILITY_DENIED',message:'This action was not consented.'}}};
  return {status:404,body:{error:{code:'NOT_FOUND',message:'unknown route'}}};
 };
 const page:ScenarioPage={
  url:()=>ORIGIN+'/',
  async evaluate(fn,arg){
   const source=fn.toString();
   if(source.includes('/api/bootstrap'))return 'csrf-test' as never;
   if(source.includes('harnessDesktop')){browserOpen=true;return undefined as never;}
   if(source.includes('fetch(path')){const input=arg as {path:string;init?:{method?:string;body?:unknown}};return routes(input.path,input.init) as never;}
   throw Error('Unexpected page function: '+source.slice(0,120));
  },
 };
 return {page};
}

let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'m16-scenario-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});

it('runs the consented Observe-only capture and independent Stop proof',async()=>{
 const {page}=fakeHost(directory);
 const receipt=await runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance});
 expect(receipt.status).toBe('PASS');
 expect(receipt.provenance).toEqual(provenance);
 const phases=(receipt.phases as {phase:string}[]).map(row=>row.phase);
 expect(phases).toEqual(['session-bound','thread-created','browser-opened','consent-requested','consent-granted','capture-bound','interact-denied','stop-revoked']);
 const bound=(receipt.phases as JsonRow[]).find(row=>row.phase==='capture-bound')!;
 expect(bound.sha256).toBe(createHash('sha256').update(pngBytes(800,600)).digest('hex'));
 expect(bound.bytes).toBe(33);expect(bound.width).toBe(800);expect(bound.height).toBe(600);
 expect(((receipt.phases as JsonRow[]).find(row=>row.phase==='interact-denied'))!.scope).toBe('consent-scope-denial');
 const granted=(receipt.phases as JsonRow[]).find(row=>row.phase==='consent-granted')!;
 expect(granted.target).toEqual(TARGET);
});

it('refuses a grant whose recorded target differs from the selected fixture identity',async()=>{
 const {page}=fakeHost(directory,{wrongTarget:true});
 await expect(runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance})).rejects.toThrow(/grant target differs/i);
});

it('refuses a capture artifact whose bytes differ from the recorded digest',async()=>{
 const {page}=fakeHost(directory,{tamperArtifact:true});
 await expect(runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance})).rejects.toThrow(/digest differs/i);
});

it('refuses when capture after Stop is still allowed',async()=>{
 const {page}=fakeHost(directory,{allowPostStopCapture:true});
 await expect(runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance})).rejects.toThrow(/after Stop was not denied/i);
});

it('refuses a page outside the owned origin',async()=>{
 const {page}=fakeHost(directory);
 const alien={...page,url:()=> 'https://attacker.example/'};
 await expect(runInstalledBrowserControlScenario({page:alien,directory,origin:ORIGIN,provenance})).rejects.toThrow(/owned origin/i);
});

it('refuses absent or malformed provenance before any call',async()=>{
 const {page}=fakeHost(directory);
 await expect(runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance:{...provenance,installerSha256:'not-a-sha'}})).rejects.toThrow(/installerSha256/);
 await expect(runInstalledBrowserControlScenario({page,directory,origin:ORIGIN,provenance:{...provenance,sourceSha:'1234'}})).rejects.toThrow(/sourceSha/);
 expect(()=>assertInstalledControlProvenance({...provenance,packageVersion:'v1'})).toThrow(/packageVersion/);
});
