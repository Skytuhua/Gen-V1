import {createHash} from 'node:crypto';
import {writeSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WorkerFrameDecoder,encodeWorkerFrame} from './isolated-host.ts';
import {
 WORKER_PROTOCOL_VERSION,isolatedDeclarationSchema,
 workerCancelPayloadSchema,workerHelloPayloadSchema,workerRequestPayloadSchema,
 type WorkerFrameV1,
} from '../contracts/plugin-worker.ts';
import type {PluginHostInstance,PluginHostModule,PluginManifest} from './contracts.ts';
import {pluginManifestSchema} from './contracts.ts';

// M13 worker entrypoint. Launched by the host as a separate owned process on
// private pipes: node --import tsx packages/plugins/worker-entry.ts <packageDir>
// <dataDir> <genVersion>. It verifies the pinned package digest against the
// HELLO claim, activates the declared host entry inside this process and
// serves WorkerFrameV1 requests. Only stdin/stdout protocol frames cross the
// boundary; every diagnostic goes to stderr.

const GENERATION_ZERO=0;
const send=(frame:WorkerFrameV1)=>{process.stdout.write(encodeWorkerFrame(frame));};
// Exit-adjacent frames use a synchronous write so the pipe cannot truncate them.
const sendSync=(frame:WorkerFrameV1)=>{try{writeSync(1,encodeWorkerFrame(frame));}catch{/* pipe may be gone */}};
const fail=(code:string,message:string):never=>{sendSync({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:GENERATION_ZERO,generation:generationNow,kind:'ERROR',payload:{code,message}});process.exit(2);};

const [packageDir,dataDir,genVersion='0.0.0']=process.argv.slice(2);
let generationNow=GENERATION_ZERO;
if(!packageDir||!dataDir)fail('INVALID_INPUT','The isolated extension launch is malformed.');

const main=async()=>{
 // The package digest is recomputed here: a worker never trusts the HELLO
 // claim, it must equal the pinned inventory on disk.
 const inventory=await readFile(join(packageDir,'plugin-files.json'));
 const packageDigest=createHash('sha256').update(inventory).digest('hex');
 const manifest:PluginManifest=pluginManifestSchema.parse(JSON.parse((await readFile(join(packageDir,'plugin.json'))).toString('utf8')));
 const declaration=isolatedDeclarationSchema.parse(JSON.parse((await readFile(join(packageDir,'isolated.json'))).toString('utf8')));
 if(declaration.pluginId!==manifest.id)fail('PROTOCOL_VIOLATION','The isolated declaration does not match the package.');

 let helloSeen=false,instance:PluginHostInstance|undefined;
 const pending=new Map<number,AbortController>();
 const decoder=new WorkerFrameDecoder();

 const shutdown=async()=>{
  for(const controller of pending.values())controller.abort();pending.clear();
  try{await instance?.close();}catch{/* teardown is best effort on the way out */}
  sendSync({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:GENERATION_ZERO,generation:generationNow,kind:'BYE',payload:{reason:'shutdown'}});
  process.exit(0);
 };

 process.stdin.on('data',(chunk:Buffer)=>{
  let frames:WorkerFrameV1[];
  try{frames=decoder.push(chunk);}catch{fail('PROTOCOL_VIOLATION','The host frame is malformed.');return;}
  for(const frame of frames){
   if(!helloSeen){
    if(frame.kind!=='HELLO'){fail('PROTOCOL_VIOLATION','The first host frame was not a handshake.');return;}
    helloSeen=true;
    const hello=workerHelloPayloadSchema.safeParse(frame.payload);
    if(!hello.success||hello.data.pluginId!==manifest.id||hello.data.packageDigest!==packageDigest){fail('PROTOCOL_VIOLATION','The handshake identity does not match this package.');return;}
    generationNow=frame.generation;
    void (async()=>{
     try{
      const module=await import(pathToFileURL(join(packageDir,manifest.hostEntry)).href) as {default?:PluginHostModule};
      if(typeof module.default?.activate!=='function')throw Error('unavailable');
      instance=await module.default.activate(Object.freeze({dataDir,genVersion}));
      send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:GENERATION_ZERO,generation:generationNow,kind:'READY',payload:{nonce:hello.data.nonce,pluginId:manifest.id,version:manifest.version,packageDigest,operations:Object.keys(instance.operations)}});
     }catch{fail('ACTIVATION_FAILED','The isolated extension could not start.');}
    })();
    continue;
   }
   if(frame.generation!==generationNow)continue;
   switch(frame.kind){
    case 'REQUEST':{
     const request=workerRequestPayloadSchema.safeParse(frame.payload);
     const operation=request.success?instance?.operations[request.data.operation]:undefined;
     if(!request.success||!operation){send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:frame.requestId,generation:generationNow,kind:'ERROR',payload:{code:'UNAVAILABLE',message:'The plug-in operation is unavailable.'}});continue;}
     const controller=new AbortController();pending.set(frame.requestId,controller);
     void Promise.resolve()
      .then(()=>operation(request.data.input,controller.signal))
      .then(value=>send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:frame.requestId,generation:generationNow,kind:'RESPONSE',payload:{ok:true,value:value??null}}))
      .catch(()=>send({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:frame.requestId,generation:generationNow,kind:'RESPONSE',payload:{ok:false,value:null,error:'The plug-in operation could not complete.'}}))
      .finally(()=>pending.delete(frame.requestId));
     continue;
    }
    case 'CANCEL':{
     const cancel=workerCancelPayloadSchema.safeParse(frame.payload);
     if(cancel.success)pending.get(cancel.data.requestId)?.abort();
     continue;
    }
    case 'SHUTDOWN':void shutdown();return;
    default:fail('PROTOCOL_VIOLATION','The host sent a frame kind reserved for the worker.');
   }
  }
 });
 process.on('SIGTERM',()=>void shutdown());
 process.on('SIGINT',()=>void shutdown());
};

void main().catch(()=>fail('ACTIVATION_FAILED','The isolated extension could not start.'));
