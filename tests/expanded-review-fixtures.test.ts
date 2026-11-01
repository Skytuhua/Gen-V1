import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateSurface} from '../packages/ui-catalog/index.ts';
import {PlanRecordSchema} from '../packages/contracts/planning.ts';
import type {ArtifactRecord,InputRequest,Operation} from '../packages/contracts/index.ts';
import {EXPANDED_COMPONENT_COVERAGE,EXPANDED_PROVENANCE,expandedSpec,openExpandedReviewHost,proceduralComparisonPng} from '../scripts/expanded-review-host.ts';
import {expandedCoverage} from '../scripts/record-expanded-review.ts';
import {SYNTHETIC_REVIEW_TOKEN} from '../scripts/review-fixtures.ts';

type Host=Awaited<ReturnType<typeof openExpandedReviewHost>>;
let host:Host|undefined;
afterEach(async()=>{await host?.close();host=undefined;});
async function opened(){return host=await openExpandedReviewHost(await mkdtemp(join(tmpdir(),'harness-expanded-review-')),{port:0,stepMilliseconds:1});}
async function send(value:Host,scenario:keyof Host['threads']){
  const thread=value.threads[scenario];await value.service.command({id:randomUUID(),type:'message.send',threadId:thread.id,payload:{content:'Inspect the supplied local task.',modelId:'review/expanded-fixture'}});
  await expect.poll(()=>value.service.thread(thread.id).runId,{timeout:10000,interval:20}).toBeNull();return thread.id;
}

describe('explicit expanded recording fixtures',()=>{
  it('reports only the surfaces included in a subset recording',()=>{
    expect(expandedCoverage(['planning'])).toEqual({componentCoverage:[],shellCoverage:['PlanStatus','PlanningQuestion','LiveUsage','FloatingWindow']});
    expect(expandedCoverage(['images','debugging'])).toEqual({componentCoverage:['ChangeSet','Diagnostics','ImageCompare'],shellCoverage:[]});
    expect(expandedCoverage(['everyday'])).toEqual({componentCoverage:['Comparison','CredentialEntry','Stats'],shellCoverage:['ComposerToolbar','SentenceReveal']});
  });
  it('admits every recorded composition and reports fixture provenance outside task copy',()=>{
    for(const name of ['debugging','software','images','planning','everyday','interactions'] as const)validateSurface(expandedSpec(name,{before:'before-png',after:'after-png'}));
    expect(EXPANDED_COMPONENT_COVERAGE).toEqual(['ApiExplorer','ChangeSet','Comparison','CredentialEntry','Diagnostics','ImageCompare','Pipeline','Stats','ReviewQueue','EditableTable','ParameterControls']);
    expect(EXPANDED_PROVENANCE).toMatch(/scripted.*not.*Pi inference/i);
    expect(JSON.stringify(expandedSpec('software'))).not.toMatch(/fixture|simulat|fictional/i);
  });
  it.each([
    ['sendReview',{reviews:[{itemId:'summary',decision:'approve',comment:''},{itemId:'compatibility',decision:'revise',comment:'Name the checked callers.'},{itemId:'timing',decision:'defer',comment:''}]}],
    ['submitRecords',{changes:[{rowId:'prints',columnId:'quantity',value:6}]}],
    ['applyParameters',{values:{quality:90,width:1920,format:'webp',metadata:false}}],
  ] as const)('continues the same interaction object for %s without granting execution authority',async(actionId,payload)=>{
    const value=await opened(),id=await send(value,'interactions'),before=value.store.all<ArtifactRecord>('artifact',id)[0];
    const dataRevisions=Object.fromEntries(value.store.snapshot().data.filter(record=>record.threadId===id).map(record=>[record.id,record.revision]));
    await value.service.command({id:randomUUID(),type:'action.submit',threadId:id,payload:{artifactId:before.id,revision:before.revision,actionId,payload,dataRevisions}});
    await expect.poll(()=>value.service.thread(id).runId,{timeout:10000,interval:20}).toBeNull();const after=value.store.all<ArtifactRecord>('artifact',id)[0];
    expect(after.id).toBe(before.id);expect(after.stateId).toBe(before.stateId);expect(after.revision).toBe(before.revision+1);expect(after.spec!.elements.received.type).toBe('Text');
    expect(value.store.all<{actionId:string;payload:unknown}>('acceptedAction',id)[0]).toMatchObject({actionId,payload});expect(value.store.all<Operation>('operation',id)).toEqual([]);
  });
  it('creates distinct bounded local PNG inputs rather than remote image URLs',()=>{
    const before=proceduralComparisonPng(false),after=proceduralComparisonPng(true);
    expect(before.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(before.equals(after)).toBe(false);
    for(const image of [before,after]){expect(image.readUInt32BE(16)).toBe(960);expect(image.readUInt32BE(20)).toBe(600);expect(image.length).toBeLessThan(512*1024);}
  });
  it('publishes the new components only through real Service tool admission',async()=>{
    const value=await opened(),id=await send(value,'software'),artifact=value.store.all<ArtifactRecord>('artifact',id)[0];
    expect(Object.values(artifact.spec!.elements).map(node=>node.type)).toEqual(['Tabs','ApiExplorer','Pipeline']);
    expect(Object.values(artifact.bindings)).toHaveLength(2);expect(value.store.all<Operation>('operation',id)).toEqual([]);
  });
  it('uses the actual authenticated private slot route without writing the synthetic token into task projections',async()=>{
    const value=await opened(),id=await send(value,'everyday'),artifact=value.store.all<ArtifactRecord>('artifact',id)[0];
    expect(Object.values(artifact.spec!.elements).map(node=>node.type)).toEqual(['Tabs','Stats','Stack','Comparison','CredentialEntry']);
    const boot=await value.app.inject({url:'/api/bootstrap',headers:{host:'127.0.0.1:0'}}),cookie=String(boot.headers['set-cookie']).split(';')[0];
    const headers={host:'127.0.0.1:0',cookie,'x-harness-csrf':boot.json().csrfToken},url=`/api/artifacts/${artifact.id}/credentials/projectApiToken`,scope={threadId:id,artifactRevision:artifact.revision};
    const status=await value.app.inject({url:url+`?threadId=${id}&artifactRevision=${artifact.revision}`,headers});
    expect(status.json()).toMatchObject({present:false,version:0});
    const saved=await value.app.inject({method:'PUT',url,headers,payload:{...scope,version:0,token:SYNTHETIC_REVIEW_TOKEN}});
    expect(saved.statusCode).toBe(200);expect(saved.json()).toMatchObject({present:true,version:1});
    expect(saved.headers['cache-control']).toBe('no-store');
    expect(saved.body).not.toContain(SYNTHETIC_REVIEW_TOKEN);
    expect(JSON.stringify(value.store.snapshot())).not.toContain(SYNTHETIC_REVIEW_TOKEN);
    expect(JSON.stringify(value.store.eventsAfter(0))).not.toContain(SYNTHETIC_REVIEW_TOKEN);
    const removed=await value.app.inject({method:'DELETE',url,headers,payload:{...scope,version:1}});
    expect(removed.json()).toMatchObject({present:false,version:2});
    const message=value.store.snapshot().messages.find(item=>item.threadId===id&&item.role==='assistant'&&item.content);
    expect(message?.content).toContain('The project handled 12,480 requests.');
  });
  it('continues the same Everyday artifact from a source-backed selected option',async()=>{
    const value=await opened(),id=await send(value,'everyday'),before=value.store.all<ArtifactRecord>('artifact',id)[0];
    const dataRevisions=Object.fromEntries(value.store.snapshot().data.filter(record=>record.threadId===id).map(record=>[record.id,record.revision]));
    await value.service.command({id:randomUUID(),type:'action.submit',threadId:id,payload:{artifactId:before.id,revision:before.revision,actionId:'choosePlan',payload:{optionId:'studio',label:'Untrusted label'},dataRevisions}});
    await expect.poll(()=>value.service.thread(id).runId,{timeout:10000,interval:20}).toBeNull();
    const after=value.store.all<ArtifactRecord>('artifact',id)[0];
    expect(after.id).toBe(before.id);expect(after.revision).toBe(before.revision+1);
    expect(value.runtime.sourceValue(id,'selection')).toMatchObject({status:'success',label:'Studio selected'});
    expect(JSON.stringify(after)).not.toContain('Untrusted label');expect(value.store.all<Operation>('operation',id)).toEqual([]);
  });
  it('runs the named local test only after exact native approval and derives failure from exit status',async()=>{
    const value=await opened(),id=await send(value,'debugging'),operation=value.store.all<Operation>('operation',id)[0];
    expect(operation).toMatchObject({kind:'repository.test',status:'prepared',approved:false});
    expect(value.store.all<ArtifactRecord>('artifact',id)[0].actions.runTest).toMatchObject({kind:'operation',operationId:operation.id});
    await value.service.command({id:randomUUID(),type:'operation.approve',threadId:id,payload:{operationId:operation.id,revision:operation.revision}});
    await expect.poll(()=>value.service.thread(id).status,{timeout:20000,interval:30}).toBe('completed');
    const finished=value.store.get<Operation>('operation',operation.id)!;expect(finished.status).toBe('failed');expect(finished.result).toMatchObject({exitCode:1});
    const diagnostics=value.runtime.sourceValue(id,'diagnostics') as {items:{status:string}[]};expect(diagnostics.items.map(item=>item.status)).toEqual(['failed','passed']);
  },25000);
  it('uses the real planning coordinator for scripted jobs and durable question updates',async()=>{
    const value=await opened(),id=await send(value,'planning'),plan=value.planning.inspect(id)!;
    expect(PlanRecordSchema.parse(plan.value).agents.map(agent=>agent.status)).toEqual(['completed','completed']);
    expect(plan.value.agents.every(agent=>agent.completedRequirementIds.length===2)).toBe(true);
    const question=value.store.all<InputRequest>('request',id).find(request=>request.status==='pending')!;
    await value.service.command({id:randomUUID(),type:'request.detail',threadId:id,payload:{requestId:question.id,revision:question.revision,kind:'explain',optionId:'focused'}});
    await expect.poll(()=>value.store.get<InputRequest>('request',question.id)!.revision,{timeout:10000,interval:20}).toBe(2);
    expect(value.store.get<InputRequest>('request',question.id)!.presentation!.options[0].explanation).toMatch(/quantity/);
  });
});
