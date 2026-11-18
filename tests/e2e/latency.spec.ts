import { writeFile } from "node:fs/promises";
import type { Request } from "@playwright/test";
import { cpus, totalmem, platform, release } from "node:os";
import { test, expect, openHost, sendFixture, FIXTURE_LABEL } from "../host-fixture.ts";

const percentile = (values: number[]) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*0.95)-1];

test("records local, committed-event and specification latency independently of inference",async({page,host},info)=>{
 const pendingRequests=new Map<Request,{path:string;command:string|null;startedAt:number}>();
 page.on('request',request=>{
   const path=new URL(request.url()).pathname;
   if(path!=='/api/commands'&&path!=='/api/snapshot')return;
   let command:string|null=null;
   if(path==='/api/commands'){
     try{const body=request.postDataJSON() as {type?:unknown}|null;if(typeof body?.type==='string')command=body.type;}catch{}
   }
   pendingRequests.set(request,{path,command,startedAt:Date.now()});
 });
 const finished=(request:Request)=>{pendingRequests.delete(request);};
 page.on('requestfinished',finished);page.on('requestfailed',finished);
 const pending=()=>[...pendingRequests.values()].map(request=>({...request,ageMs:Date.now()-request.startedAt}));
 // Observe the same EventSource instance used by the application. Register the
 // receipt listener before its renderer listener; do not create a second stream.
 await page.addInitScript(()=>{
   const receipts=new Map<string,{receivedAt:number;sequence:number|null}>();
   Object.assign(window,{latencyEventReceipts:receipts});
   const NativeEventSource=window.EventSource;
   window.EventSource=class extends NativeEventSource{
     constructor(url:string|URL,options?:EventSourceInit){
       super(url,options);
       this.addEventListener('workspace',event=>{
         try{
           const value=JSON.parse((event as MessageEvent<string>).data) as {seq?:number;payload?:{result?:{message?:{id?:unknown}}}};
           const id=value.payload?.result?.message?.id;
           if(typeof id==='string'&&id.startsWith('latency-event-'))
             receipts.set(id,{receivedAt:Date.now(),sequence:Number.isSafeInteger(value.seq)?value.seq!:null});
         }catch{}
       });
     }
   };
 });
 await openHost(page); await sendFixture(page,"document");
 const artifact=host.artifact("structured");
 const local:number[]=[], eventToVisible:number[]=[], specToVisible:number[]=[];
 const eventStages:Record<string,unknown>[]=[];
 // Warm up the actual controlled store/disclosure before timed samples.
 const disclosure=page.getByRole("button",{name:"Evidence and provenance",exact:true});
 await disclosure.click(); await disclosure.click();
 for(let sample=0;sample<100;sample++)local.push(await disclosure.evaluate(async element=>{
   const start=performance.now(), before=element.getAttribute("aria-expanded");
   const done=new Promise<number>(resolve=>{const observer=new MutationObserver(()=>{if(element.getAttribute("aria-expanded")!==before){observer.disconnect();resolve(performance.now()-start);}});observer.observe(element,{attributes:true,attributeFilter:["aria-expanded"]});});
   (element as HTMLButtonElement).click(); return done;
 }));
 const afterLocal={pendingRequests:pending(),hostCommands:host.commands.length};
 for(let sample=0;sample<30;sample++){
   const content=`Committed event sample ${sample}`;
   await page.evaluate(text=>{
     Object.assign(window,{latencyObservation:new Promise<number>(resolve=>{const observer=new MutationObserver(()=>{if(document.body.textContent?.includes(text)){observer.disconnect();resolve(Date.now());}});observer.observe(document.body,{subtree:true,childList:true,characterData:true});})});
   },content);
   const messageId='latency-event-'+sample, pendingAtStart=pending(), commandsAtStart=host.commands.length;
   const committed=Date.now(), hostStarted=performance.now();
   host.runtime.event("assistant.message",{messageId,content});
   const hostReturnedAt=Date.now(),hostDurationMs=performance.now()-hostStarted;
   const observation=await page.evaluate(async id=>{
     const state=window as unknown as {
       latencyObservation:Promise<number>;
       latencyEventReceipts:Map<string,{receivedAt:number;sequence:number|null}>;
     };
     const visibleAt=await state.latencyObservation;
     return {visibleAt,delivery:state.latencyEventReceipts.get(id)??null};
   },messageId);
   eventToVisible.push(observation.visibleAt-committed);
   eventStages.push({
     sample,messageId,hostDurationMs,committed,hostReturnedAt,visibleAt:observation.visibleAt,
     receivedAt:observation.delivery?.receivedAt??null,eventSequence:observation.delivery?.sequence??null,
     receiveToDomMs:observation.delivery?observation.visibleAt-observation.delivery.receivedAt:null,
     hostReturnToReceiveMs:observation.delivery?observation.delivery.receivedAt-hostReturnedAt:null,
     pendingAtStart,commandsAtStart,commandsAtVisible:host.commands.length,
   });
 }
 for(let sample=0;sample<30;sample++){
   const label=`Committed specification ${sample}`;
   await page.evaluate(text=>{
     Object.assign(window,{latencyObservation:new Promise<number>(resolve=>{const observer=new MutationObserver(()=>{if(document.body.textContent?.includes(text)){observer.disconnect();resolve(Date.now());}});observer.observe(document.body,{subtree:true,childList:true,characterData:true});})});
   },label);
   const current=host.artifact("structured"), committed=Date.now();
   await host.runtime.tool({name:"ui_present",args:{artifactId:artifact.id,baseRevision:current.revision,title:artifact.title,patches:[{op:"replace",path:"/elements/document/props/title",value:label}]}});
   specToVisible.push(await page.evaluate(()=> (window as unknown as {latencyObservation:Promise<number>}).latencyObservation)-committed);
 }
 const report={fixture:FIXTURE_LABEL,scope:"Warm local Chromium fixture; no inference, cold startup or provider latency included. Event/spec samples include host commit time, SSE snapshot reconciliation and rendering.",hardware:{platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},runtime:{node:process.version,browser:page.context().browser()?.version(),viewport:page.viewportSize()},fixtureSize:{specBytes:Buffer.byteLength(JSON.stringify(artifact.spec)),nodes:Object.keys(artifact.spec!.elements).length},samples:{local,eventToVisible,specToVisible},diagnostics:{afterLocal,eventStages},p95:{localMs:percentile(local),acceptedEventToVisibleMs:percentile(eventToVisible),committedSpecToVisibleMs:percentile(specToVisible)},targets:{localMs:50,acceptedEventToVisibleMs:200,committedSpecToVisibleMs:150}};
 await writeFile(info.outputPath("latency.json"),JSON.stringify(report,null,2));
 await info.attach("latency",{body:JSON.stringify(report,null,2),contentType:"application/json"});
 console.info("M01_LATENCY_STAGE_REPORT "+JSON.stringify(report));
 expect(report.p95.localMs).toBeLessThan(50);expect(report.p95.acceptedEventToVisibleMs).toBeLessThan(200);expect(report.p95.committedSpecToVisibleMs).toBeLessThan(150);
});
