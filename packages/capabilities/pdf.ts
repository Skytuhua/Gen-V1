import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {HarnessError} from '../contracts/index.ts';
import type {PdfArgs} from './schemas.ts';
import {PDF_LIMITS,type PdfInspection,type PdfJob} from './pdf-protocol.ts';
export {PDF_LIMITATIONS} from './pdf-protocol.ts';
export type {PdfInspection} from './pdf-protocol.ts';

const require=createRequire(import.meta.url),loader=require.resolve('tsx/cjs/api'),entry=fileURLToPath(new URL('./pdf-worker.ts',import.meta.url));
// Register the fixed loader inside the worker. Node's worker entry loading can
// otherwise use strip-only TypeScript before an inherited --import hook applies.
const bootstrap=`require(${JSON.stringify(loader)}).register();require(${JSON.stringify(entry)});`;
function checkSource(bytes:Uint8Array){if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>PDF_LIMITS.inputBytes)throw new HarnessError('PDF_LIMIT','PDF sources must be nonempty and at most 32 MiB.');}
function cancelled(){return new HarnessError('CANCELLED','PDF processing was cancelled.');}
async function run(job:PdfJob,signal?:AbortSignal):Promise<PdfInspection|Uint8Array>{
 if(signal?.aborted)throw cancelled();
 checkSource(job.bytes);
 const source=Uint8Array.from(job.bytes),pngs=job.kind==='render'?job.pngs.map(([id,bytes])=>[id,Uint8Array.from(bytes)] as [string,Uint8Array]):[];
 const owned:PdfJob=job.kind==='inspect'?{kind:'inspect',bytes:source}:{...job,bytes:source,pngs};
 return new Promise((resolve,reject)=>{
  const worker=new Worker(bootstrap,{eval:true,workerData:owned,transferList:[source.buffer,...pngs.map(([,bytes])=>bytes.buffer as ArrayBuffer)],execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  let finished=false;
  const finish=(error?:Error,result?:PdfInspection|Uint8Array)=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   // Terminal authority returns only after this job can no longer process data.
   void worker.terminate().then(()=>{worker.removeAllListeners();if(error)reject(error);else resolve(result!);},cause=>reject(error??cause));
  };
  const abort=()=>finish(cancelled());
  const timer=setTimeout(()=>finish(new HarnessError('PDF_TIMEOUT','PDF processing exceeded its 15 second limit. Try a smaller document.')),PDF_LIMITS.deadlineMs);
  signal?.addEventListener('abort',abort,{once:true});
  worker.on('message',(message:unknown)=>{
   if(!message||typeof message!=='object'){finish(new HarnessError('PDF_WORKER_ERROR','Invalid PDF worker response.'));return;}
   const value=message as Record<string,unknown>;
   if(value.kind==='error'&&typeof value.error==='string'&&value.error.length<=1000){finish(new HarnessError(typeof value.code==='string'&&/^[A-Z_]{1,60}$/.test(value.code)?value.code:'PDF_ERROR',value.error));return;}
   if(job.kind==='render'&&value.kind==='rendered'&&value.result instanceof Uint8Array&&value.result.byteLength>0&&value.result.byteLength<=PDF_LIMITS.outputBytes){finish(undefined,value.result);return;}
   if(job.kind==='inspect'&&value.kind==='inspection'&&value.result&&typeof value.result==='object'){
    const result=value.result as PdfInspection;
    if(Number.isInteger(result.pageCount)&&result.pageCount>0&&result.pageCount<=PDF_LIMITS.pages&&Array.isArray(result.pages)&&result.pages.length===result.pageCount&&Array.isArray(result.fields)&&result.fields.length<=PDF_LIMITS.fields&&Buffer.byteLength(JSON.stringify(result))<=PDF_LIMITS.inspectionBytes){finish(undefined,result);return;}
   }
   finish(new HarnessError('PDF_WORKER_ERROR','Invalid or oversized PDF worker result.'));
  });
  worker.once('error',error=>finish(new HarnessError('PDF_WORKER_ERROR',error.message.slice(0,1000))));
  worker.once('exit',code=>{if(!finished)finish(new HarnessError('PDF_WORKER_EXIT',`PDF worker exited without a result (${code}).`));});
  if(signal?.aborted)abort();
 });
}
export async function inspectPdf(bytes:Uint8Array,signal?:AbortSignal):Promise<PdfInspection>{return await run({kind:'inspect',bytes},signal) as PdfInspection;}
export async function renderPdf(bytes:Uint8Array,args:PdfArgs,resolvedPngs:ReadonlyMap<string,Uint8Array>=new Map(),signal?:AbortSignal):Promise<Uint8Array>{
 if(signal?.aborted)throw cancelled();
 if(Object.keys(args.fields??{}).length>100||Buffer.byteLength(JSON.stringify(args))>128*1024||resolvedPngs.size>20)throw new HarnessError('PDF_LIMIT','PDF export exceeds the field or signature input limit.');
 const pngs=[...resolvedPngs];if(pngs.some(([id,bytes])=>typeof id!=='string'||id.length>200||!(bytes instanceof Uint8Array)||bytes.byteLength>512*1024))throw new HarnessError('PDF_LIMIT','Signature PNG data exceeds the PDF input limit.');
 return await run({kind:'render',bytes,args,pngs},signal) as Uint8Array;
}
