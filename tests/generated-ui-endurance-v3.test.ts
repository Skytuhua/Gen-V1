import {cleanTempDirs,tempDir} from './fixtures/temp-dir.ts';
import {it,expect,afterEach} from 'vitest';

import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {validateSurface,SURFACE_LIMITS} from '../packages/ui-catalog/index';
import {admitSchema,validateJson,GENERATED_APPS_ENABLED} from '../packages/core/widgets';
import {admitArtifactContents} from '../packages/core/ui-admission';
import type {InputRequest} from '../packages/contracts/index';
import {HarnessError} from '../packages/contracts/index';
const code=(fn:()=>unknown):string=>{try{fn();}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};

/** Pure admission checks. Actual reload, focus, cancellation and worker
 * isolation are exercised through tests/e2e/host-loop.spec.ts and
 * tests/widget-isolation.test.ts. Admission alone is not browser evidence.
 * This suite does not change the existing generated-code activation policy. */

const stores:Store[]=[];
function stateStore(){const store=new Store(join(tempDir('verify-state-'),'state'));stores.push(store);return store;}
afterEach(()=>{for(const store of stores.splice(0))store.close();cleanTempDirs();});
const THREAD='t1';

const surface=(elements:Record<string,{type:string;props:Record<string,unknown>;children?:string[]}>,root='root')=>({root,elements});
const brokenButtonSpec=()=>surface({
 root:{type:'Stack',props:{gap:'md'},children:['msg','go']},
 msg:{type:'Text',props:{text:'Ready'}},
 go:{type:'Button',props:{label:'Run',actionId:'run'},},
});

it('schema rejection is enforced at the catalog boundary',()=>{
 // Unknown component.
 expect(()=>validateSurface(surface({root:{type:'Eval',props:{}}}))).toThrow(/Unknown component/);
 // Too many nodes.
 const many:Record<string,{type:string;props:Record<string,unknown>;children?:string[]}>= {root:{type:'Stack',props:{},children:[]}};
 for(let i=0;i<SURFACE_LIMITS.nodes;i++)many['n'+i]={type:'Text',props:{text:'x'}};
 expect(()=>validateSurface(surface(many))).toThrow(/200 nodes/);
 // Depth beyond the bound.
 const deep:Record<string,{type:string;props:Record<string,unknown>;children:string[]}>= {root:{type:'Stack',props:{},children:['d1']}};
 for(let i=1;i<=SURFACE_LIMITS.depth;i++)deep['d'+i]={type:'Stack',props:{},children:i===SURFACE_LIMITS.depth?['leaf']:['d'+(i+1)]};
 deep['leaf']={type:'Text',props:{text:'end'},children:[]};
 expect(()=>validateSurface(surface(deep))).toThrow(/depth 12/);
 // Long output beyond the byte limit.
 expect(()=>validateSurface(surface({root:{type:'Text',props:{text:'y'.repeat(SURFACE_LIMITS.bytes)}}}))).toThrow();
 // Unreachable and dangling content.
 expect(()=>validateSurface({root:'root',elements:{root:{type:'Text',props:{text:'a'}},orphan:{type:'Text',props:{text:'b'}}}})).toThrow(/unreachable/);
 expect(()=>validateSurface(surface({root:{type:'Stack',props:{},children:['ghost']}}))).toThrow(/Dangling reference/);
});

it('the broken-button fixture fails for the intended reason, then the repaired fixture passes',()=>{
 const store=stateStore();
 // Expected failure: the button names an action that was never declared.
 expect(code(()=>admitArtifactContents(store,THREAD,{actions:{}},brokenButtonSpec(),null))).toBe('INVALID_SPEC');
 // Repaired fixture: the declared agent action satisfies the reference.
 const repaired=admitArtifactContents(store,THREAD,{actions:{run:{kind:'agent',prompt:'run it'}}},brokenButtonSpec(),null);
 expect(repaired.actions.run.kind).toBe('agent');
});

it('a stale request binding is rejected, then the refreshed binding passes',()=>{
 const store=stateStore();
 const request:InputRequest={id:'req-1',threadId:THREAD,artifactId:null,revision:3,title:'Pick',prompt:'choose',responseSchema:{type:'string'},basis:[],status:'pending'};
 store.internal('test.fixture',THREAD,()=>store.put('request',request.id,THREAD,request));
 const spec=surface({root:{type:'Stack',props:{},children:['go']},go:{type:'Button',props:{label:'Choose',actionId:'pick'}}});
 const stale={pick:{kind:'request' as const,requestId:'req-1',requestRevision:1}};
 expect(code(()=>admitArtifactContents(store,THREAD,{actions:stale},spec,null))).toBe('STALE_REQUEST');
 const fresh=admitArtifactContents(store,THREAD,{actions:{pick:{kind:'request',requestId:'req-1'}}},spec,null);
 expect(fresh.actions.pick.requestRevision).toBe(3); // host stamps the revision it verified
});

it('admission preserves existing presentation and bindings when fields are omitted',()=>{
 const store=stateStore();
 store.internal('test.fixture',THREAD,()=>store.put('data','d1',THREAD,{id:'d1',threadId:THREAD,revision:1,value:{total:5},createdAt:new Date().toISOString()}));
 const spec=surface({root:{type:'Stack',props:{},children:['m']},m:{type:'Metric',props:{label:'Total',dataBinding:'t'}}});
 const existing={id:'a1',threadId:THREAD,messageId:'m1',title:'t',purpose:'',kind:'structured' as const,revision:1,spec,widget:null,bindings:{t:{mode:'live' as const,id:'d1'}},actions:{},stateId:'s1',lifecycle:'active' as const,placement:'inline' as const,pinned:false,presentation:{width:'wide' as const,frame:'canvas' as const},catalogVersion:'1',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const again=admitArtifactContents(store,THREAD,{},spec,existing);
 expect(again.presentation.width).toBe('wide');
 expect(again.bindings.t).toEqual({mode:'live',id:'d1'});
});

it('control schemas admit focusable inputs and reject invalid state references',()=>{
 // A focusable form: Form + Input stateKey stays valid through admission.
 const spec=surface({
  root:{type:'Form',props:{title:'Review',actionId:'submit'},children:['email']},
  email:{type:'Input',props:{stateKey:'email',label:'Email',inputType:'email'}},
 });
 expect(()=>validateSurface(spec)).not.toThrow();
 // An Input stateKey that collides with reserved names is rejected by the catalog key rules.
 const bad=surface({root:{type:'Form',props:{actionId:'submit'},children:['x']},x:{type:'Input',props:{stateKey:'__proto__',label:'x'}}});
 expect(()=>validateSurface(bad)).toThrow();
});

it('missing requests cannot back an action and unknown routes are rejected',()=>{
 const store=stateStore();
 // No request record at all -> the action cannot claim it.
 const spec=surface({root:{type:'Stack',props:{},children:['go']},go:{type:'Button',props:{label:'Choose',actionId:'pick'}}});
 expect(code(()=>admitArtifactContents(store,THREAD,{actions:{pick:{kind:'request',requestId:'req-gone'}}},spec,null))).toBe('CAPABILITY_DENIED');
 expect(code(()=>admitArtifactContents(store,THREAD,{actions:{pick:{kind:'shell' as 'agent'}}},spec,null))).toBe('INVALID_SPEC');
 // Generated-code capability unchanged by this milestone.
 expect(GENERATED_APPS_ENABLED).toBe(true);
});

it('admitSchema and validateJson bound generated widget contracts',()=>{
 expect(()=>admitSchema({type:'object',properties:{n:{type:'number'}}})).not.toThrow();
 expect(()=>admitSchema({type:'bogus'})).toThrow();
 expect(()=>validateJson({type:'object',properties:{n:{type:'number'}},required:['n']},{n:1})).not.toThrow();
 expect(()=>validateJson({type:'object',properties:{n:{type:'number'}},required:['n']},{n:'x'})).toThrow();
});
