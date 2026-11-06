/** Recording-only adapters. Never imported by the production application. */
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {crc32,deflateSync} from 'node:zlib';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {PlanningCoordinator} from '../packages/core/planning.ts';
import {buildServer} from '../apps/server/server.ts';
import type {ArtifactRecord,DataRecord,InputRequest,Operation,ResourceGrant,RunContext,RuntimeAdapter,RuntimeCallbacks,StartRun,SurfaceSpec,Thread} from '../packages/contracts/index.ts';
import {SOFTWARE_FIXTURE_DATA} from './software-development-fixtures.ts';
import {everydaySpec,EVERYDAY_REVIEW_DATA,interactionSpec,INTERACTION_REVIEW_DATA} from './review-fixtures.ts';

export type ExpandedScenario='debugging'|'software'|'images'|'planning'|'everyday'|'interactions';
export const EXPANDED_PROVENANCE='Explicit local recording fixtures with scripted model adapters, not subscription-Pi inference. The named node test runs only after native approval; API/CI records, project statistics, plan comparisons and procedural PNG inputs are illustrative. Private token entry uses only an obvious synthetic token and the real session-only host route, without making any external connection. Agent jobs use the real coordinator with scripted child responses.';
export const EXPANDED_COMPONENT_COVERAGE=['ApiExplorer','ChangeSet','Comparison','CredentialEntry','Diagnostics','ImageCompare','Pipeline','Stats','ReviewQueue','EditableTable','ParameterControls'];
export function expandedSpec(name:ExpandedScenario,images?:{before:string;after:string}):SurfaceSpec{
  if(name==='debugging')return {root:'tabs',elements:{tabs:{type:'Tabs',props:{labels:['Failures','Changes'],stateKey:'debugTab'},children:['diagnostics','changes']},diagnostics:{type:'Diagnostics',props:{dataBinding:'diagnostics',stateKey:'diagnostic'}},changes:{type:'ChangeSet',props:{dataBinding:'changes',stateKey:'changedFile'}}}};
  if(name==='software')return {root:'tabs',elements:{tabs:{type:'Tabs',props:{labels:['API contract','Release checks'],stateKey:'softwareTab'},children:['api','pipeline']},api:{type:'ApiExplorer',props:{dataBinding:'api',stateKey:'endpoint'}},pipeline:{type:'Pipeline',props:{dataBinding:'pipeline',stateKey:'stage'}}}};
  if(name==='images')return {root:'comparison',elements:{comparison:{type:'ImageCompare',props:{beforeResourceId:images?.before??'before-image',afterResourceId:images?.after??'after-image',stateKey:'comparison',beforeLabel:'Before',afterLabel:'After'}}}};
  if(name==='everyday')return everydaySpec();
  if(name==='interactions')return interactionSpec();
  return {root:'summary',elements:{summary:{type:'Text',props:{text:'Review the checkout repair scope.',size:'sm'}}}};
}

/** Two deterministic original pixel studies, created for this fixture only. */
export function proceduralComparisonPng(after:boolean):Buffer{
  const width=960,height=600,rows=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb=[236,239,244];
    if(x<162)rgb=after?[30,40,58]:[48,54,66];
    else if(y<64)rgb=[255,255,255];
    else if(x>190&&x<930&&y>96&&y<198)rgb=[255,255,255];
    else if(x>190&&x<664&&y>222&&y<555)rgb=[255,255,255];
    else if(x>685&&x<930&&y>222&&y<555)rgb=after?[48,86,159]:[217,222,231];
    if(x>25&&x<130&&y>30&&y<43)rgb=[213,226,248];
    for(let n=0;n<5;n++)if(x>25&&x<(n===1?133:112)&&y>102+n*49&&y<115+n*49)rgb=n===1?[101,148,240]:[114,128,150];
    if(x>214&&x<360&&y>119&&y<130)rgb=[65,76,95];
    if(x>214&&x<450&&y>146&&y<154)rgb=[177,187,200];
    if(x>798&&x<900&&y>124&&y<163)rgb=after?[51,108,219]:[140,151,167];
    if(after&&x>714&&x<900&&y>253&&y<263)rgb=[218,232,255];
    for(let n=0;n<6;n++){
      const left=218+n*69,top=after?440-[25,60,40,102,123,155][n]:440-[18,25,35,44,51,66][n];
      if(x>left&&x<left+38&&y>top&&y<485)rgb=after?[74+n*8,123+n*5,220]:[155,171,194];
      if(x>215&&x<610&&y>246+n*12&&y<248+n*12)rgb=[241,243,247];
    }
    const offset=y*(width*4+1)+1+x*4;rows.set([...rgb,255],offset);
  }
  const chunk=(type:string,bytes:Buffer)=>{const length=Buffer.alloc(4),checksum=Buffer.alloc(4),name=Buffer.from(type);length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,bytes])));return Buffer.concat([length,name,bytes,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

const pause=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));
class ScriptedReader implements RuntimeAdapter{
  private callbacks!:RuntimeCallbacks;private stopped=false;
  constructor(private readonly stepMilliseconds:number){}
  configure(callbacks:RuntimeCallbacks){this.callbacks=callbacks;}
  async models(){return [];}
  async history(){return [];}
  async start(input:StartRun){
    const event=(type:string,extra:Record<string,unknown>={})=>this.callbacks.onEvent({...input,type,...extra});
    const requirements=JSON.parse(input.prompt.split('Requirements: ').at(-1)!) as {id:string}[];
    for(let n=0;n<requirements.length;n++){
      await pause(this.stepMilliseconds);if(this.stopped)return;
      await this.callbacks.onTool({name:'agent_progress',args:{completedRequirementIds:requirements.slice(0,n+1).map(item=>item.id),summary:n?'Compared both supplied paths.':'Located the supplied assertion.'}},input);
      event('usage',{usage:{inputTokens:1200*(n+1),outputTokens:140*(n+1),cost:null}});
    }
    await pause(this.stepMilliseconds);if(this.stopped)return;
    await this.callbacks.onTool({name:'task_finish',args:{outcome:'Compared the quantity assertion and empty-basket boundary.',evidence:[]}},input);event('settled',{aborted:false});
  }
  async followUp(input:StartRun){await this.start(input);}
  async cancel(){this.stopped=true;}
  async compact(){throw new Error('Compaction is not part of this recording fixture');}
  async dispose(){this.stopped=true;}
}

export class ExpandedReviewRuntime implements RuntimeAdapter{
  private callbacks!:RuntimeCallbacks;service!:Service;planning!:PlanningCoordinator;
  readonly scenarios=new Map<string,ExpandedScenario>();readonly resources=new Map<string,{project?:string;before?:string;after?:string}>();
  private aliases=new Map<string,Map<string,string>>();private controllers=new Map<string,AbortController>();
  constructor(readonly store:Store,private readonly folder:string,private readonly stepMilliseconds:number){}
  configure(callbacks:RuntimeCallbacks){this.callbacks=callbacks;}
  async models(){return [{id:'review/expanded-fixture',provider:'recording fixture',name:'Local scripted UI review'}];}
  async history(path:string):Promise<string[]>{try{return JSON.parse(await readFile(path,'utf8'));}catch{return [];}}
  async start(input:StartRun){await this.deliver(input);}
  async followUp(input:StartRun){await this.deliver(input);}
  async cancel(ctx:RunContext){this.controllers.get(ctx.runId)?.abort();await this.planning.cancel(ctx);}
  async compact(){throw new Error('No compaction recording in this fixture');}
  async dispose(){this.controllers.forEach(controller=>controller.abort());}
  sourceValue(threadId:string,alias:string){return this.store.get<DataRecord>('data',this.aliases.get(threadId)?.get(alias)??'')?.value;}
  private source(ctx:RunContext,alias:string,value:unknown){
    this.service.assertRun(ctx);let refs=this.aliases.get(ctx.threadId);if(!refs){refs=new Map();this.aliases.set(ctx.threadId,refs);}const id=refs.get(alias)??randomUUID();refs.set(alias,id);
    const old=this.store.get<DataRecord>('data',id),record:DataRecord={id,threadId:ctx.threadId,revision:(old?.revision??0)+1,value,provenance:EXPANDED_PROVENANCE,createdAt:new Date().toISOString()};
    this.store.internal('expanded-review.source',ctx.threadId,()=>{this.service.assertRun(ctx);this.store.put('data',id,ctx.threadId,record);this.store.put('dataVersion',`${id}@${record.revision}`,ctx.threadId,record);});
  }
  private async present(ctx:RunContext,spec:SurfaceSpec,title:string,actions:Record<string,unknown>={}){
    const previous=this.store.all<ArtifactRecord>('artifact',ctx.threadId)[0];
    await this.service.tool({name:'ui_present',args:{...(previous?{artifactId:previous.id,baseRevision:previous.revision}:{initialState:{}}),title,purpose:'Inspect and work with supplied task sources',spec,actions,bindings:Object.fromEntries([...(this.aliases.get(ctx.threadId)??[])].map(([alias,id])=>[alias,{mode:'live',id}])),presentation:{width:'standard',frame:'card'}}},ctx);
  }
  private async planningFlow(input:StartRun){
    const request=this.store.all<InputRequest>('request',input.threadId).find(item=>item.status==='pending');
    if(request){
      const presentation=structuredClone(request.presentation!);
      for(const detail of request.detailRequests?.filter(item=>item.status==='pending')??[]){
        await pause(this.stepMilliseconds);this.service.assertRun(input);
        if(detail.kind==='more-options'){if(!presentation.options.some(option=>option.id==='test-first'))presentation.options.push({id:'test-first',label:'Test-first repair',description:'Add the missing quantity case before changing the calculation.'});}
        else {const option=presentation.options.find(item=>item.id===detail.optionId)!;if(detail.kind==='explain')option.explanation='Keep the public API and repair only the quantity calculation. Verify the failing case and the empty-basket case.';else option.examples=[{text:'For four items at 3 credits each, the result should be 12.'}];}
      }
      await this.service.tool({name:'ui_request_input',args:{requestId:request.id,baseRevision:request.revision,title:request.title,prompt:request.prompt,responseSchema:request.responseSchema,presentation}},input);return;
    }
    if(this.planning.inspect(input.threadId)){this.callbacks.onEvent({...input,type:'assistant.message',messageId:randomUUID(),content:'Scope saved. The repair can continue from this choice.',inputIds:input.inputIds});return;}
    const requirement=(id:string,label:string)=>({id,label,completed:false});
    this.planning.updatePlan(input,{title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'working',requirements:[requirement('reproduce','Reproduce the quantity failure'),requirement('locate','Locate the shared calculation')]},{id:'verify',title:'Run checkout tests',status:'pending',requirements:[requirement('focused','Focused regression passes')]}]});
    await this.planning.delegate(input,{commandId:randomUUID(),tasks:[{id:'tests',name:'Test investigator',task:'Trace the quantity assertion',prompt:'Read the supplied fixture observations.',stepId:'investigate',requirements:[{id:'reproduce',label:'Locate the failing assertion'},{id:'edge',label:'Check the empty-basket boundary'}]},{id:'review',name:'Code reviewer',task:'Review the calculation boundary',prompt:'Compare the proposed correction to the supplied contract.',stepId:'investigate',requirements:[{id:'contract',label:'Check the public contract'},{id:'scope',label:'Check the smallest change'}]}]},this.controllers.get(input.runId)!.signal);
    this.planning.updatePlan(input,{baseRevision:this.planning.inspect(input.threadId)!.revision,title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'completed',requirements:[{id:'reproduce',label:'Reproduce the quantity failure',completed:true},{id:'locate',label:'Locate the shared calculation',completed:true}],agentIds:this.planning.inspect(input.threadId)!.value.agents.map(agent=>agent.id)},{id:'verify',title:'Run checkout tests',status:'pending',requirements:[requirement('focused','Focused regression passes')]}]});
    await this.service.tool({name:'ui_request_input',args:{title:'Which repair should we explore?',prompt:'Choose the scope for the checkout repair.',responseSchema:{type:'string'},presentation:{options:[{id:'focused',label:'Focused repair',description:'Keep the public API stable.'},{id:'broader',label:'Broader cleanup',description:'Include nearby validation.'}],allowCustom:true}}},input);
  }
  private async deliver(input:StartRun){
    const controller=new AbortController();this.controllers.set(input.runId,controller);
    const event=(type:string,extra:Record<string,unknown>={})=>this.callbacks.onEvent({...input,type,...extra});
    try{
      this.service.assertRun(input);const path=join(this.folder,`session-${input.threadId}.json`),ids=input.inputIds??[input.inputId];await writeFile(path,JSON.stringify([...new Set([...await this.history(path),...ids])]));event('session',{sessionPath:path});event('input.processing',{inputIds:ids});
      event('usage',{usage:{inputTokens:12400,outputTokens:1850,contextTokens:14250,contextWindow:128000,cost:null,sessionPercent:null,weeklyPercent:null,activity:'running'}});
      const scenario=this.scenarios.get(input.threadId)!;let prose='';const messageId=randomUUID();
      if(scenario==='debugging'){
        const operation=this.store.all<Operation>('operation',input.threadId).find(item=>item.kind==='repository.test');
        const diagnostics={title:'Test failures',source:'Exact named local test output',items:[{id:'quantity',title:'includes item quantity',status:'not-run',file:'checkout.test.mjs',line:4},{id:'empty',title:'empty basket returns zero',status:'not-run',file:'checkout.test.mjs',line:5}]} as {title:string;source:string;items:Record<string,unknown>[]};
        const changes=structuredClone(SOFTWARE_FIXTURE_DATA.ChangeSet);changes.files[0].path='total.mjs';changes.files[1].path='checkout.test.mjs';
        this.source(input,'changes',changes);
        const spec=expandedSpec('debugging');let actions:Record<string,unknown>={};
        if(!operation){const prepared=await this.service.tool({name:'repository_test_prepare',args:{resourceId:this.resources.get(input.threadId)!.project,testFile:'checkout.test.mjs'}},input) as Operation;spec.elements.diagnostics.props={...spec.elements.diagnostics.props,actionId:'runTest',actionLabel:'Run named local test'};actions={runTest:{kind:'operation',operationId:prepared.id}};}
        else if((operation.status==='succeeded'||operation.status==='failed')&&operation.result){
          const result=operation.result as {exitCode:number|null;stdout:string;stderr:string};
          if(result.exitCode===1&&/(?:\u2716|not ok\s+\d+\s*-)\s*includes item quantity/.test(result.stdout)&&/(?:\u2714|(?:^|\n)ok\s+\d+\s*-)\s*empty basket returns zero/.test(result.stdout))diagnostics.items=[{...diagnostics.items[0],status:'failed',message:'Expected 12, received 3',expected:'12',actual:'3',code:'assert.equal(total([{price:3, quantity:4}]), 12);'},{...diagnostics.items[1],status:'passed'}];
          else diagnostics.items=diagnostics.items.map(item=>({...item,status:'unknown',message:'Inspect the recorded executor output.'}));
        }
        this.source(input,'diagnostics',diagnostics);await this.present(input,spec,'Checkout tests',actions);
        if(operation?.result&&(operation.status==='succeeded'||operation.status==='failed'))await this.service.tool({name:'task_finish',args:{outcome:'Named local test observed; proposed patch has not been applied',evidence:[operation.result]}},input);
      }else if(scenario==='software'){this.source(input,'api',SOFTWARE_FIXTURE_DATA.ApiExplorer);this.source(input,'pipeline',SOFTWARE_FIXTURE_DATA.Pipeline);await this.present(input,expandedSpec(scenario),'Orders API & release checks');}
      else if(scenario==='images'){const images=this.resources.get(input.threadId)!;await this.present(input,expandedSpec(scenario,{before:images.before!,after:images.after!}),'Interface comparison');}
      else if(scenario==='everyday'){
        const accepted=this.store.all<{actionId:string;payload:{optionId?:string};acceptedAt:string}>('acceptedAction',input.threadId).filter(action=>action.actionId==='choosePlan').sort((a,b)=>b.acceptedAt.localeCompare(a.acceptedAt))[0];
        const selected=EVERYDAY_REVIEW_DATA.Comparison.options.find(option=>option.id===accepted?.payload.optionId);
        this.source(input,'metrics',EVERYDAY_REVIEW_DATA.Stats);this.source(input,'choices',EVERYDAY_REVIEW_DATA.Comparison);
        if(selected)this.source(input,'selection',{status:'success',label:`${selected.label} selected`});
        for(const sentence of selected?[`${selected.label} is saved as the project plan. `,'No subscription or purchase has been activated.']:['The project handled 12,480 requests. ','Response time is down to 184 ms. ','Compare the plans when you are ready.']){
          controller.signal.throwIfAborted();this.service.assertRun(input);prose+=sentence;event('assistant.delta',{messageId,delta:sentence});await pause(Math.min(this.stepMilliseconds,450));
        }
        await this.present(input,everydaySpec(Boolean(selected)),'Project overview',{choosePlan:{kind:'agent',prompt:'Save the selected project plan preference'}});
      }
      else if(scenario==='interactions'){
        this.source(input,'reviewItems',INTERACTION_REVIEW_DATA.ReviewQueue);this.source(input,'editableRecords',INTERACTION_REVIEW_DATA.EditableTable);this.source(input,'parameters',INTERACTION_REVIEW_DATA.ParameterControls);
        const accepted=this.store.all<{actionId:string;payload:unknown;acceptedAt:string}>('acceptedAction',input.threadId).filter(item=>['sendReview','submitRecords','applyParameters'].includes(item.actionId)).sort((a,b)=>b.acceptedAt.localeCompare(a.acceptedAt))[0];
        const spec=interactionSpec();if(accepted){spec.elements.interactionTabs.children!.push('received');spec.elements.interactionTabs.props.labels=[...(spec.elements.interactionTabs.props.labels as string[]),'Submitted'];spec.elements.received={type:'Text',props:{text:accepted.actionId==='sendReview'?'Your review is ready for the next revision.':accepted.actionId==='submitRecords'?'The proposed record changes are ready to inspect.':'The selected parameters are ready for the task.'}};}
        await this.present(input,spec,'Review and refine',{sendReview:{kind:'agent',prompt:'Inspect the submitted content review'},submitRecords:{kind:'agent',prompt:'Inspect the submitted record change proposal'},applyParameters:{kind:'agent',prompt:'Inspect the submitted parameter choices'}});
      }
      else await this.planningFlow(input);
      controller.signal.throwIfAborted();this.service.assertRun(input);event('assistant.message',{messageId,content:prose,inputIds:ids});event('settled',{aborted:false});
    }catch(error){event(controller.signal.aborted?'settled':'error',controller.signal.aborted?{aborted:true}:{message:error instanceof Error?error.message:String(error)});}
    finally{this.controllers.delete(input.runId);}
  }
}

export async function openExpandedReviewHost(folder:string,options:{port?:number;stepMilliseconds?:number}={}){
  const port=options.port??4348,stepMilliseconds=options.stepMilliseconds??2400;
  const project=join(folder,'resources','checkout');await mkdir(project,{recursive:true});
  await writeFile(join(project,'total.mjs'),'export const total = items => items.reduce((sum, item) => sum + item.price, 0);\n',{flag:'wx'});
  await writeFile(join(project,'checkout.test.mjs'),"import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {total} from './total.mjs';\ntest('includes item quantity', () => assert.equal(total([{price:3,quantity:4}]),12));\ntest('empty basket returns zero', () => assert.equal(total([]),0));\n",{flag:'wx'});
  const before=join(folder,'resources','before.png'),after=join(folder,'resources','after.png');await writeFile(before,proceduralComparisonPng(false),{flag:'wx'});await writeFile(after,proceduralComparisonPng(true),{flag:'wx'});
  const store=new Store(join(folder,'state')),runtime=new ExpandedReviewRuntime(store,folder,stepMilliseconds),service=new Service(store,runtime);runtime.service=service;
  const planning=new PlanningCoordinator({store,assertRun:ctx=>service.assertRun(ctx),runtimeFactory:()=>new ScriptedReader(stepMilliseconds),domainContext:(ctx,signal)=>({threadId:ctx.threadId,signal,resolveResource:async()=>{throw new Error('Recording child has no filesystem tool');},publishData:()=>{throw new Error('Recording child has no source publication');},prepareOperation:()=>{throw new Error('Recording child cannot prepare operations');},progress:()=>{}})});runtime.planning=planning;await service.recover();
  const threads={} as Record<ExpandedScenario,Thread>;
  for(const scenario of ['debugging','software','images','planning','everyday','interactions'] as const){
    const thread=(await service.command({id:randomUUID(),type:'thread.create',payload:{title:({debugging:'Trace a checkout failure',software:'Explore the Orders API',images:'Compare the interface revision',planning:'Plan the checkout repair',everyday:'Review project activity and plans',interactions:'Review and adjust a delivery'})[scenario],projectName:'Expanded UI review'}})).result as Thread;threads[scenario]=thread;runtime.scenarios.set(thread.id,scenario);
    const grant=async(path:string,kind:ResourceGrant['kind'],writable=false)=>(await service.command({id:randomUUID(),type:'resource.grant',threadId:thread.id,payload:{path,kind,writable}})).result as ResourceGrant;
    runtime.resources.set(thread.id,scenario==='debugging'?{project:(await grant(project,'project',true)).id}:scenario==='images'?{before:(await grant(before,'file')).id,after:(await grant(after,'file')).id}:{});
  }
  const app=await buildServer(service,{port,dev:false});await app.listen({port,host:'127.0.0.1'});
  return {app,store,service,runtime,planning,threads,async close(){await app.close();await planning.dispose();await service.dispose();store.close();}};
}
