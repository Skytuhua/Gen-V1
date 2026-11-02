import { writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release } from "node:os";
import { test, expect, openHost, sendFixture, FIXTURE_LABEL } from "../host-fixture.ts";

const percentile = (values: number[]) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*0.95)-1];

test("records local, committed-event and specification latency independently of inference",async({page,host},info)=>{
 await openHost(page); await sendFixture(page,"document");
 const artifact=host.artifact("structured");
 const local:number[]=[], eventToVisible:number[]=[], specToVisible:number[]=[];
 // Warm up the actual controlled store/disclosure before timed samples.
 const disclosure=page.getByRole("button",{name:"Evidence and provenance",exact:true});
 await disclosure.click(); await disclosure.click();
 for(let sample=0;sample<100;sample++)local.push(await disclosure.evaluate(async element=>{
   const start=performance.now(), before=element.getAttribute("aria-expanded");
   const done=new Promise<number>(resolve=>{const observer=new MutationObserver(()=>{if(element.getAttribute("aria-expanded")!==before){observer.disconnect();resolve(performance.now()-start);}});observer.observe(element,{attributes:true,attributeFilter:["aria-expanded"]});});
   (element as HTMLButtonElement).click(); return done;
 }));
 for(let sample=0;sample<30;sample++){
   const content=`Committed event sample ${sample}`;
   await page.evaluate(text=>{
     Object.assign(window,{latencyObservation:new Promise<number>(resolve=>{const observer=new MutationObserver(()=>{if(document.body.textContent?.includes(text)){observer.disconnect();resolve(Date.now());}});observer.observe(document.body,{subtree:true,childList:true,characterData:true});})});
   },content);
   const committed=Date.now();host.runtime.event("assistant.message",{messageId:`latency-event-${sample}`,content});
   eventToVisible.push(await page.evaluate(()=> (window as unknown as {latencyObservation:Promise<number>}).latencyObservation)-committed);
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
 const report={fixture:FIXTURE_LABEL,scope:"Warm local Chromium fixture; no inference, cold startup or provider latency included. Event/spec samples include host commit time, SSE snapshot reconciliation and rendering.",hardware:{platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},runtime:{node:process.version,browser:page.context().browser()?.version(),viewport:page.viewportSize()},fixtureSize:{specBytes:Buffer.byteLength(JSON.stringify(artifact.spec)),nodes:Object.keys(artifact.spec!.elements).length},samples:{local,eventToVisible,specToVisible},p95:{localMs:percentile(local),acceptedEventToVisibleMs:percentile(eventToVisible),committedSpecToVisibleMs:percentile(specToVisible)},targets:{localMs:50,acceptedEventToVisibleMs:200,committedSpecToVisibleMs:150}};
 await writeFile(info.outputPath("latency.json"),JSON.stringify(report,null,2));
 await info.attach("latency",{body:JSON.stringify(report,null,2),contentType:"application/json"});
 expect(report.p95.localMs).toBeLessThan(50);expect(report.p95.acceptedEventToVisibleMs).toBeLessThan(200);expect(report.p95.committedSpecToVisibleMs).toBeLessThan(150);
});
