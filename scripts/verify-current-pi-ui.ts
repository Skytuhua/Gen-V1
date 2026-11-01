import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,realpath,lstat,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchHost,type RunningHost} from '../apps/server/host.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import {discoverCapabilities} from '../packages/core/discovery.ts';
import {createPiRuntime} from '../packages/runtime-pi/index.ts';
import {isSubscriptionProviderId} from '../packages/contracts/connections.ts';
import {HarnessError,type HostCommand,type CommandReceipt,type RuntimeAdapter,type RunContext,type ToolCall,type Snapshot} from '../packages/contracts/index.ts';
import {verificationPorts} from './portable-verification.ts';

const SOURCE_NAME='checkout-trace.json';
export const SYNTHETIC_TRACE={
 source:'Synthetic captured local checkout test supplied for investigation, not production telemetry',revision:'capture-1',requestId:'checkout-17',endToEndBudgetMs:1200,result:'HTTP 503',retryAfterMs:2000,policy:{maxRetries:1,fixedDelayMs:200},
 spans:[
  {id:'checkout',name:'Checkout',startMs:0,durationMs:620,status:'error'},
  {id:'inventory',parentId:'checkout',name:'Inventory lookup',startMs:8,durationMs:24,status:'ok'},
  {id:'payment',parentId:'checkout',name:'Payment',startMs:40,durationMs:540,status:'error'},
  {id:'attempt-1',parentId:'payment',name:'First payment attempt',startMs:45,durationMs:120,status:'error',detail:'HTTP 429; Retry-After: 2 seconds'},
  {id:'delay',parentId:'payment',name:'Retry delay',startMs:165,durationMs:200,status:'ok'},
  {id:'attempt-2',parentId:'payment',name:'Second payment attempt',startMs:365,durationMs:180,status:'error',detail:'HTTP 429; Retry-After: 2 seconds'},
  {id:'format',parentId:'checkout',name:'Response formatting',startMs:580,durationMs:20,status:'ok'},
 ],
};
export const SYNTHETIC_TRACE_BASE64=Buffer.from(JSON.stringify(SYNTHETIC_TRACE,null,2)).toString('base64');

export function parseCurrentPiArguments(args:string[]){
 const values=new Map<string,string>();
 for(let index=0;index<args.length;index+=2){const name=args[index],value=args[index+1];if(!name||!['--runtime-profile','--model-id'].includes(name)||!value||value.startsWith('--')||values.has(name))throw Error('Pass exactly --runtime-profile <absolute existing profile> and --model-id <subscription model>.');values.set(name,value);}
 const runtimeProfile=values.get('--runtime-profile'),modelId=values.get('--model-id');
 if(!runtimeProfile||!isAbsolute(runtimeProfile)||/[\0\r\n]/.test(runtimeProfile)||!modelId||modelId.length>300||!modelId.includes('/')||modelId.endsWith('/')||/[\0\r\n]/.test(modelId)||!isSubscriptionProviderId(modelId.split('/')[0]))throw Error('An explicit absolute runtime profile and Pi subscription model are required.');
 return {runtimeProfile,modelId};
}
export function assertCurrentCatalog(value:Awaited<ReturnType<typeof discoverCapabilities>>){
 const names=new Set(value.components.map(item=>item.name));
 if(value.components.length!==48||names.size!==48||!['TraceWaterfall','WorkflowBoard','ArchitectureCanvas','Comparison','Stats'].every(name=>names.has(name))||value.generatedApps.available!==false)throw Error('Current 48-component catalog preflight failed. No inference was requested.');
}
export function buildCurrentPiPrompt(resourceId:string){
 if(!/^[a-zA-Z0-9:_-]+$/.test(resourceId))throw Error('Invalid source identity.');
 return `Help me investigate the failed checkout in the attached captured trace (resource ${resourceId}). It is a synthetic local test capture, not production telemetry. Product requires a hard 1,200 ms end-to-end budget. I need to decide what to fix first and compare a single payment attempt with an asynchronous payment continuation. Keep the investigation read-only and use only this attachment. Do not access other files or external services.`;
}
type DiscoveryTrace={at:string;query:string;details:boolean;offset:unknown;limit:unknown;componentNames:string[];domainToolNames:string[];responseBytes:number;total:unknown;nextOffset:unknown};

/** Verification-only scope: the shared runtime profile is never a task grant. */
export class CurrentPiVerificationService extends Service{
 private ownThread:string|null=null;
 private creationId:string|null=null;
 private creating=false;
 private uploadId:string|null=null;
 private uploading:string|null=null;
 constructor(store:Store,runtime:RuntimeAdapter,private readonly modelId:string,private readonly onDiscovery:(value:DiscoveryTrace)=>void){super(store,runtime);}
 get verificationThreadId(){return this.ownThread;}
 override async command(command:HostCommand):Promise<CommandReceipt>{
  if(command.type==='thread.create'){
   if(this.ownThread){if(command.id===this.creationId)return super.command(command);throw new HarnessError('VERIFICATION_SCOPE','Only one verification thread is allowed.');}
   if(this.creating){if(command.id===this.creationId)return super.command(command);throw new HarnessError('VERIFICATION_SCOPE','Only one verification thread is allowed.');}
   this.creating=true;this.creationId=command.id;
   try{const result=await super.command(command);const id=(result.result as {id?:unknown}).id;if(typeof id!=='string')throw Error('Thread creation did not return an identity.');this.ownThread=id;this.creationId=command.id;return result;}finally{this.creating=false;}
  }
  if(command.threadId&&command.threadId!==this.ownThread)throw new HarnessError('VERIFICATION_SCOPE','Command is outside the verification thread.');
  if(command.type==='resource.grant')throw new HarnessError('VERIFICATION_SCOPE','Filesystem grants are disabled for this verification.');
  if(command.type==='resource.upload'){
   if(!this.ownThread||command.threadId!==this.ownThread||command.payload.name!==SOURCE_NAME||command.payload.base64!==SYNTHETIC_TRACE_BASE64||Object.keys(command.payload).some(key=>!['name','base64'].includes(key))||this.uploadId&&this.uploadId!==command.id||this.uploading&&this.uploading!==command.id)throw new HarnessError('VERIFICATION_SCOPE','Only the exact synthetic source upload is allowed.');
   this.uploading=command.id;
   try{const receipt=await super.command(command);this.uploadId=command.id;return receipt;}finally{if(this.uploading===command.id)this.uploading=null;}
  }
  if(command.type==='operation.approve'||command.type==='operation.execute')throw new HarnessError('VERIFICATION_SCOPE','Operation approval and execution are disabled for this verification.');
  if((command.type==='message.send'||command.type==='run.resume')&&command.payload.modelId!==undefined&&command.payload.modelId!==this.modelId)throw new HarnessError('VERIFICATION_SCOPE','Use the explicitly selected verification model.');
  if(command.type==='settings.update'&&command.payload.modelId!==undefined&&command.payload.modelId!==null&&command.payload.modelId!==this.modelId)throw new HarnessError('VERIFICATION_SCOPE','Use the explicitly selected verification model.');
  return super.command(command);
 }
 override async tool(call:ToolCall,context:RunContext):Promise<unknown>{
  if(context.threadId!==this.ownThread)throw new HarnessError('VERIFICATION_SCOPE','Tool is outside the verification thread.');
  // Reader factories otherwise use the new Store profile, which has no account.
  // This benchmark authorizes only the primary session, never a hidden reader run.
  if(call.name==='task_delegate'||call.name==='operation_execute')throw new HarnessError('VERIFICATION_SCOPE','This verification authorizes primary read-only investigation only.');
  const result=await super.tool(call,context);
  if(call.name==='ui_discover'){
   const discovery=result as Awaited<ReturnType<typeof discoverCapabilities>>;
   this.onDiscovery({at:new Date().toISOString(),query:typeof call.args.query==='string'?call.args.query.slice(0,200):'',details:call.args.details===true,offset:call.args.offset??0,limit:call.args.limit??null,componentNames:discovery.components.map(item=>item.name),domainToolNames:discovery.domainTools.map(item=>item.name),responseBytes:Buffer.byteLength(JSON.stringify(result)),total:discovery.total,nextOffset:discovery.nextOffset??null});
  }
  return result;
 }
}

async function boundedJson(path:string,value:unknown){const bytes=JSON.stringify(value,null,2);if(Buffer.byteLength(bytes)>8*1024*1024)throw Error('Verification evidence exceeded its 8 MiB bound.');await writeFile(path,bytes);}
function ownSnapshot(snapshot:Snapshot,threadId:string){return {seq:snapshot.seq,thread:snapshot.threads.find(thread=>thread.id===threadId),messages:snapshot.messages.filter(message=>message.threadId===threadId),artifacts:snapshot.artifacts.filter(artifact=>artifact.threadId===threadId),userStates:snapshot.userStates.filter(state=>state.threadId===threadId),data:snapshot.data.filter(data=>data.threadId===threadId),requests:snapshot.requests.filter(request=>request.threadId===threadId),operations:snapshot.operations.filter(operation=>operation.threadId===threadId),resources:snapshot.resources.filter(resource=>resource.threadId===threadId),usage:snapshot.usage[threadId]};}
async function stopRequested(path:string){try{const info=await lstat(path);return info.isFile()&&!info.isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}

export async function verifyCurrentPiUi(options:ReturnType<typeof parseCurrentPiArguments>){
 const runtimeProfile=await realpath(options.runtimeProfile),pi=await lstat(join(runtimeProfile,'pi'));if(!pi.isDirectory()||pi.isSymbolicLink())throw Error('The explicit existing runtime profile must contain an ordinary Pi directory.');
 const workspace=await realpath(resolve('.')),root=join(workspace,'.harness-current-pi-ui');await mkdir(root,{recursive:true});if(await realpath(root)!==root)throw Error('Verification evidence directory is redirected.');
 const directory=await mkdtemp(join(root,'run-')),dataDir=join(directory,'host'),stopPath=join(directory,'stop'),started=Date.now(),expiresAt=started+15*60*1000;
 const discovery=await discoverCapabilities({});assertCurrentCatalog(discovery);await boundedJson(join(directory,'catalog-preflight.json'),discovery);await boundedJson(join(directory,SOURCE_NAME),SYNTHETIC_TRACE);
 const trace:DiscoveryTrace[]=[];let service:CurrentPiVerificationService|undefined,host:RunningHost|undefined,stopping=false,initialRecorded=false,lastSequence=-1,initialInputId='';
 const lifecycle:Record<string,unknown>={createdAt:new Date(started).toISOString(),expiresAt:new Date(expiresAt).toISOString(),runtimeProfile,storeDataDir:dataDir,modelId:options.modelId,primaryPiOnly:true,credentialsCopied:false,rawCredentialsReadByVerifier:false,syntheticSource:true,presentationInstructionsInPrompt:false,closed:false};
 const signal=()=>{stopping=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{
  lifecycle.phase='launching-owned-host';
  const [port,widgetPort]=await verificationPorts();
  host=await launchHost({dataDir,port,widgetPort,dev:false},{createRuntime:()=>createPiRuntime({dataDir:runtimeProfile}),createService:(store,runtime)=>service=new CurrentPiVerificationService(store,runtime,options.modelId,value=>{if(trace.length>=256)throw new HarnessError('VERIFICATION_LIMIT','Discovery trace limit reached.');trace.push(value);})});
  const boot=await fetch(host.origin+'/api/bootstrap',{signal:AbortSignal.timeout(10000)});if(!boot.ok)throw Error('Owned host bootstrap failed.');const session=await boot.json() as {csrfToken:string};const cookie=boot.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const send=async(type:string,payload:Record<string,unknown>,threadId?:string)=>{
   const response=await fetch(host!.origin+'/api/commands',{method:'POST',headers:{cookie,'content-type':'application/json','x-harness-csrf':session.csrfToken},body:JSON.stringify({id:randomUUID(),type,payload,...(threadId?{threadId}:{})}),signal:AbortSignal.timeout(30000)});
   const result=await response.json() as CommandReceipt&{error?:{code?:string}};if(!response.ok)throw new HarnessError(result.error?.code??'VERIFICATION_HTTP','The owned verification command was rejected.');return result;
  };
  lifecycle.phase='validating-selected-model';
  const models=await service!.runtime.models();const model=models.find(model=>model.id===options.modelId);if(!model)throw Error('The explicitly selected authenticated model is unavailable. No task input was sent.');
  lifecycle.phase='creating-own-task';
  const created=await send('thread.create',{title:'Investigate checkout retries',projectName:'Current-source Pi acceptance'}),threadId=(created.result as {id:string}).id;
  const uploaded=await send('resource.upload',{name:SOURCE_NAME,base64:SYNTHETIC_TRACE_BASE64},threadId),resourceId=(uploaded.result as {id:string}).id,prompt=buildCurrentPiPrompt(resourceId);
  await writeFile(join(directory,'prompt.txt'),prompt);
  await boundedJson(join(directory,'identity.json'),{...lifecycle,directory,pid:process.pid,origin:host.origin,widgetOrigin:host.widgetOrigin,threadId,resourceId,stopPath,catalogComponents:discovery.components.length,selectedModel:{id:model.id,provider:model.provider,name:model.name}});
  console.log(JSON.stringify({directory,pid:process.pid,origin:host.origin,threadId,stopPath,expiresAt:new Date(expiresAt).toISOString(),sourceAttached:true}));
  if(stopping||Date.now()>=expiresAt||await stopRequested(stopPath)){lifecycle.initialOutcome='not-started';lifecycle.closeReason='stopped-before-inference';return {directory};}
  const sent=await send('message.send',{content:prompt,modelId:options.modelId},threadId);initialInputId=sent.commandId;
  lifecycle.phase='observing-own-task';
  const initialDeadline=Date.now()+180000;
  while(!stopping&&Date.now()<expiresAt&&!await stopRequested(stopPath)){
   const snapshot=service!.store.snapshot(),own=ownSnapshot(snapshot,threadId);
   if(snapshot.seq!==lastSequence){lastSequence=snapshot.seq;await boundedJson(join(directory,'latest.json'),own);await boundedJson(join(directory,'discovery-trace.json'),trace);}
   const input=service!.store.get<{status:string}>('outbox',initialInputId);
   if(!initialRecorded&&!own.thread?.runId&&(input?.status==='handled'||['failed','interrupted','stopped'].includes(own.thread?.status??''))){
    initialRecorded=true;lifecycle.initialOutcome=own.thread?.status;await boundedJson(join(directory,'initial.json'),own);await boundedJson(join(directory,'initial-result.json'),{status:own.thread?.status,artifactCount:own.artifacts.length,artifactTypes:[...new Set(own.artifacts.flatMap(artifact=>Object.values(artifact.spec?.elements??{}).map(element=>element.type)))],semanticActionCount:own.artifacts.reduce((sum,artifact)=>sum+Object.keys(artifact.actions).length,0),discoveryCalls:trace.length,discoveryResponseBytes:trace.reduce((sum,value)=>sum+value.responseBytes,0)});console.log(JSON.stringify({directory,initialOutcome:own.thread?.status,artifacts:own.artifacts.map(artifact=>({id:artifact.id,revision:artifact.revision})),hostOpen:true}));
   }
   if(!initialRecorded&&Date.now()>initialDeadline){
    initialRecorded=true;lifecycle.initialOutcome='deadline';if(own.thread?.runId)await service!.command({id:randomUUID(),type:'run.stop',threadId,payload:{}});await boundedJson(join(directory,'initial.json'),ownSnapshot(service!.store.snapshot(),threadId));await boundedJson(join(directory,'initial-result.json'),{status:'deadline',initialRunLimitMs:180000});console.log(JSON.stringify({directory,initialOutcome:'deadline',ownRunStopped:true,hostOpen:true}));
   }
   await new Promise(done=>setTimeout(done,1000));
  }
  lifecycle.closeReason=stopping?'signal':Date.now()>=expiresAt?'lifetime-limit':'stop-file';
 }catch(error){lifecycle.failure={name:error instanceof Error?error.name:'Error',code:error instanceof HarnessError?error.code:undefined};throw error;}
 finally{
  process.off('SIGINT',signal);process.off('SIGTERM',signal);
  try{await host?.close();lifecycle.closed=true;}catch{lifecycle.closeError='Owned host cleanup failed.';process.exitCode=1;}
  await boundedJson(join(directory,'discovery-trace.json'),trace);await boundedJson(join(directory,'lifecycle.json'),lifecycle);console.log(JSON.stringify({directory,closed:lifecycle.closed,initialOutcome:lifecycle.initialOutcome}));
 }
 return {directory};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{await verifyCurrentPiUi(parseCurrentPiArguments(process.argv.slice(2)));}catch(error){console.error(JSON.stringify({failed:true,code:error instanceof HarnessError?error.code:'VERIFICATION_FAILED',name:error instanceof Error?error.name:'Error'}));process.exitCode=1;}
}
