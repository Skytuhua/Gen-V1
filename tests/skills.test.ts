import {afterEach,expect,it} from 'vitest';
import {lstatSync,mkdtempSync,realpathSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations,curateSkills,decideSkillProposal,listSkillProposals,listSkills,setSkillFlags,skillIndex,viewSkill,viewSkillProposal} from '../packages/core/skills.ts';
import type {SkillActor,SkillOperation,SkillPolicy} from '../packages/contracts/skills.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const user:SkillActor={kind:'user'},agent:SkillActor={kind:'agent',threadId:'source-thread',runId:'source-run',evidence:['operation:verified']};
const timestamp='2026-11-01T12:00:00.000Z';
function fixture(){
 const root=realpathSync(tmpdir()),directory=mkdtempSync(join(root,'harness-skills-'));let store=new Store(directory);
 cleanups.push(async()=>{store.close();if(realpathSync(directory)!==resolve(directory)||!directory.startsWith(root+sep)||lstatSync(directory).isSymbolicLink())throw Error('Unsafe skill fixture cleanup');await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 return {get store(){return store;},change(operations:SkillOperation[],actor=agent,policy:SkillPolicy={}){return store.internal('test.skills',null,()=>applySkillOperations(store,operations,actor,{now:timestamp,...policy})) as ReturnType<typeof applySkillOperations>;},
  create(name='verified-workflow',actor=agent,content='Inspect the exact source.\nRun the relevant test before claiming success.'){return this.change([{action:'create',name,description:'Verify a repeatable workflow.',content,baseRevision:0}],actor);},
  flags(name:string,flags:{enabled?:boolean;protected?:boolean},revision:number){return store.internal('test.flags',null,()=>setSkillFlags(store,name,flags,revision,timestamp));},
  reopen(){store.close();store=new Store(directory);},
 };
}

it('keeps discovery metadata-only and renders standard SKILL.md on demand',()=>{
 const x=fixture();expect(listSkills(x.store)).toMatchObject({skills:[],nextOffset:null});
 const saved=x.create();expect(saved).toMatchObject({status:'applied',changes:[{name:'verified-workflow',revision:1,origin:'agent',sourceThreadId:'source-thread',sourceRunId:'source-run',state:'active',enabled:true,protected:false}]});
 const listing=listSkills(x.store);expect(listing.skills[0]).not.toHaveProperty('content');expect(listing.skills[0]).not.toHaveProperty('files');
 const detail=viewSkill(x.store,'verified-workflow');expect(detail.content).toContain('Inspect the exact source.');expect(detail.document).toContain('name: "verified-workflow"');expect(detail.document).toContain('description: "Verify a repeatable workflow."');expect(detail.files).toEqual([]);
 expect(skillIndex(x.store)).not.toContain('Inspect the exact source.');
});
it('reopens the library and retains immutable revisions through patch, archive, restore and rollback',()=>{
 const x=fixture();x.create();x.change([{action:'patch',name:'verified-workflow',baseRevision:1,oldText:'exact source',newText:'current exact source'}]);
 expect(viewSkill(x.store,'verified-workflow',{revision:1}).content).not.toContain('current exact');
 x.change([{action:'delete',name:'verified-workflow',baseRevision:2}],user);expect(listSkills(x.store).skills).toEqual([]);
 expect(()=>x.create()).toThrow(/exist|restore/i);
 x.change([{action:'restore',name:'verified-workflow',baseRevision:3}],user);
 x.change([{action:'rollback',name:'verified-workflow',baseRevision:4,revision:1}],user);x.reopen();
 const restored=viewSkill(x.store,'verified-workflow');expect(restored.skill.revision).toBe(5);expect(restored.content).not.toContain('current exact');expect(restored.versions.map(item=>item.revision)).toEqual([5,4,3,2,1]);
 expect(()=>x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'Stale editor'}])).toThrow(/changed|revision|stale/i);
});
it('rolls the entire batch back when a later operation fails',()=>{
 const x=fixture();x.create();const sequence=x.store.sequence;
 expect(()=>x.change([{action:'create',name:'another-workflow',description:'Another procedure',content:'Read source first.',baseRevision:0},{action:'patch',name:'verified-workflow',baseRevision:99,content:'Must not apply'}])).toThrow();
 expect(listSkills(x.store).skills.map(skill=>skill.name)).toEqual(['verified-workflow']);expect(x.store.sequence).toBe(sequence);expect(viewSkill(x.store,'verified-workflow').skill.revision).toBe(1);
});
it('requires one exact patch target and never silently patches several copies',()=>{
 const x=fixture();x.create('repeat-workflow',agent,'Check source. Check source.');
 for(const oldText of ['Check source.','missing',''])expect(()=>x.change([{action:'patch',name:'repeat-workflow',baseRevision:1,oldText,newText:'Replacement'}])).toThrow();
 expect(viewSkill(x.store,'repeat-workflow').skill.revision).toBe(1);
});
it('loads support files as data and enforces review-local fresh reads for exact existing targets',()=>{
 const x=fixture();x.create();x.change([{action:'write_file',name:'verified-workflow',baseRevision:1,path:'references/tests.md',content:'Run the exact named test.'}]);
 const reads=new Map<string,number>();
 expect(()=>x.change([{action:'patch',name:'verified-workflow',baseRevision:2,content:'Changed'}],agent,{readVersions:reads})).toThrow(/read/i);
 reads.set('verified-workflow',2);expect(()=>x.change([{action:'write_file',name:'verified-workflow',baseRevision:2,path:'references/tests.md',content:'Changed file'}],agent,{readVersions:reads})).toThrow(/read/i);
 const detail=viewSkill(x.store,'verified-workflow',{path:'references/tests.md'});expect(detail.content).toBe('Run the exact named test.');expect(detail.document).toBeUndefined();
 reads.set('verified-workflow/references/tests.md',2);x.change([{action:'write_file',name:'verified-workflow',baseRevision:2,path:'references/tests.md',content:'Revised recipe.'}],agent,{readVersions:reads});
 expect(()=>x.change([{action:'remove_file',name:'verified-workflow',baseRevision:3,path:'references/tests.md'}],agent,{readVersions:reads})).toThrow(/read|revision|changed/i);
});
it.each(['../outside','/absolute','C:/outside','references\\outside.md','references/../outside','references//a','__proto__/a','references/constructor','SKILL.md'])('rejects unsafe virtual supporting path %s',path=>{
 const x=fixture();x.create();expect(()=>x.change([{action:'write_file',name:'verified-workflow',baseRevision:1,path,content:'Text'}])).toThrow();expect(viewSkill(x.store,'verified-workflow').files).toEqual([]);
});
it.each(['constructor','__proto__','Uppercase','bad name','a'.repeat(65)])('rejects invalid skill name %s',name=>{
 const x=fixture();expect(()=>x.create(name)).toThrow();expect(listSkills(x.store).skills).toEqual([]);
});
it('bounds content, support files, counts and obvious credential content',()=>{
 const x=fixture();
 for(const content of ['a'.repeat(65537),'private\u0000text','sk-proj-abcdefghijklmnopqrstuvwxyz1234567890'])expect(()=>x.create('bad-content',agent,content)).toThrow();
 expect(()=>x.change([{action:'create',name:'bad-description',description:'d'.repeat(1025),content:'Good content.',baseRevision:0}])).toThrow();
 x.create();const files=Array.from({length:32},(_,i):SkillOperation=>({action:'write_file',name:'verified-workflow',baseRevision:i+1,path:`references/file-${i}.txt`,content:'a'}));x.change(files);
 expect(()=>x.change([{action:'write_file',name:'verified-workflow',baseRevision:33,path:'references/overflow.txt',content:'More'}])).toThrow();
 expect(()=>x.change([{action:'write_file',name:'verified-workflow',baseRevision:33,path:'references/file-0.txt',content:'a'.repeat(65537)}])).toThrow();
});
it('keeps list pages and automatic metadata within their response budgets',()=>{
 const x=fixture();x.change(Array.from({length:24},(_,i)=>({action:'create',name:`workflow-${String(i).padStart(2,'0')}`,description:'Description '.repeat(80),content:'Body must not appear in discovery.',baseRevision:0})));
 const page=listSkills(x.store,{limit:20});expect(page.skills.length).toBeGreaterThan(0);expect(page.skills.length).toBeLessThanOrEqual(20);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8192);expect(page.nextOffset).not.toBeNull();
 const names=[...page.skills.map(item=>item.name),...listSkills(x.store,{offset:page.nextOffset!,limit:20}).skills.map(item=>item.name)];expect(new Set(names).size).toBe(names.length);
 expect(Buffer.byteLength(skillIndex(x.store))).toBeLessThanOrEqual(8192);expect(skillIndex(x.store)).not.toContain('Body must not');
});
it('stages a complete mutation batch and applies it only after approval',()=>{
 const x=fixture();x.create();const staged=x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'User-reviewed revision.'},{action:'write_file',name:'verified-workflow',baseRevision:2,path:'references/evidence.md',content:'Inspect source receipts.'}],agent,{requireApproval:true});
 expect(staged).toMatchObject({status:'pending',changes:[]});expect(viewSkill(x.store,'verified-workflow').skill.revision).toBe(1);expect(listSkillProposals(x.store)).toHaveLength(1);expect(listSkillProposals(x.store)[0]).not.toHaveProperty('operations');
 const proposal=viewSkillProposal(x.store,staged.proposalId!);expect(proposal.operations).toHaveLength(2);
 const accepted=x.store.internal('test.approval',null,()=>decideSkillProposal(x.store,staged.proposalId!,true,timestamp));expect(accepted).toMatchObject({status:'applied'});expect(viewSkill(x.store,'verified-workflow').skill.revision).toBe(3);expect(listSkillProposals(x.store)).toEqual([]);
});
it('preserves a stale proposal and records rejection without applying content',()=>{
 const x=fixture();x.create();const staged=x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'Proposed.'}],agent,{requireApproval:true});x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'Newer user edit.'}],user);
 expect(()=>x.store.internal('test.approval',null,()=>decideSkillProposal(x.store,staged.proposalId!,true))).toThrow();expect(listSkillProposals(x.store)).toHaveLength(1);expect(viewSkill(x.store,'verified-workflow').content).toBe('Newer user edit.');
 x.store.internal('test.rejection',null,()=>decideSkillProposal(x.store,staged.proposalId!,false));expect(listSkillProposals(x.store)).toEqual([]);expect(viewSkillProposal(x.store,staged.proposalId!).status).toBe('rejected');
});
it('deduplicates actual use separately from the immutable content revision',()=>{
 const x=fixture();x.create();for(let i=0;i<2;i++)x.store.internal('test.view',null,()=>viewSkill(x.store,'verified-workflow',{useId:'task-run'}));
 const detail=viewSkill(x.store,'verified-workflow');expect(detail.skill).toMatchObject({revision:1,useCount:1});expect(detail.skill.lastUsedAt).not.toBeNull();expect(detail.versions).toHaveLength(1);
});
it('preserves user disable/protect choices against automatic mutations',()=>{
 const x=fixture();x.create();x.flags('verified-workflow',{protected:true},1);
 expect(()=>x.change([{action:'patch',name:'verified-workflow',baseRevision:2,content:'Agent replacement.'}])).toThrow(/protect/i);
 x.flags('verified-workflow',{protected:false,enabled:false},2);expect(listSkills(x.store).skills).toEqual([]);expect(()=>viewSkill(x.store,'verified-workflow')).toThrow(/disabled|unavailable/i);
 expect(()=>x.change([{action:'patch',name:'verified-workflow',baseRevision:3,content:'Agent replacement.'}])).toThrow(/disabled/i);
 expect(viewSkill(x.store,'verified-workflow',{includeInactive:true}).skill.enabled).toBe(false);
});
it('curates only managed unused skills and keeps every archive recoverable',()=>{
 const x=fixture();x.create('unused-agent');x.create('user-owned',user);x.create('protected-agent');x.flags('protected-agent',{protected:true},1);x.create('disabled-agent');x.flags('disabled-agent',{enabled:false},1);
 const at14='2026-11-15T12:00:00.000Z',at30='2026-12-01T12:00:00.000Z';
 const stale=x.store.internal('test.curate',null,()=>curateSkills(x.store,{now:at14}));expect(stale).toMatchObject([{name:'unused-agent',state:'stale',revision:2}]);
 const archived=x.store.internal('test.curate',null,()=>curateSkills(x.store,{now:at30}));expect(archived).toMatchObject([{name:'unused-agent',state:'archived',revision:3}]);
 expect(viewSkill(x.store,'user-owned').skill.state).toBe('active');expect(viewSkill(x.store,'protected-agent').skill.state).toBe('active');expect(viewSkill(x.store,'disabled-agent',{includeInactive:true}).skill.state).toBe('active');
 x.change([{action:'restore',name:'unused-agent',baseRevision:3}],user);expect(viewSkill(x.store,'unused-agent').content).toContain('exact source');
});
it('uses existing command receipts for idempotent skill writes',()=>{
 const x=fixture(),operations:SkillOperation[]=[{action:'create',name:'receipt-workflow',baseRevision:0,description:'Retry safe',content:'One version only.'}];
 const command={id:'skill-retry',type:'skill.manage',payload:{operations}};
 const first=x.store.command(command,()=>applySkillOperations(x.store,operations,user));expect(x.store.command(command,()=>applySkillOperations(x.store,operations,user))).toEqual(first);expect(viewSkill(x.store,'receipt-workflow').versions).toHaveLength(1);
});
it('rejects ignored fields and malformed approval choices before staging or changing anything',()=>{
 const x=fixture();x.create();expect(()=>x.change([{action:'delete',name:'verified-workflow',baseRevision:1,content:'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890'}],agent,{requireApproval:true})).toThrow();
 expect(listSkillProposals(x.store)).toEqual([]);
 const staged=x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'Proposed.'}],agent,{requireApproval:true});
 expect(()=>x.store.internal('test.approval',null,()=>decideSkillProposal(x.store,staged.proposalId!,'false' as unknown as boolean))).toThrow();expect(listSkillProposals(x.store)).toHaveLength(1);
});
it('treats overlapping patch matches as ambiguous',()=>{const x=fixture();x.create('overlap-workflow',agent,'aaa');expect(()=>x.change([{action:'patch',name:'overlap-workflow',baseRevision:1,oldText:'aa',newText:'b'}])).toThrow(/exactly once|ambiguous/i);});
it('protects user-maintained learned skills from the curator without losing origin',()=>{
 const x=fixture();x.create();x.change([{action:'patch',name:'verified-workflow',baseRevision:1,content:'User-maintained procedure.'}],user);
 expect(viewSkill(x.store,'verified-workflow').skill).toMatchObject({origin:'agent',managed:false});
 expect(()=>x.change([{action:'patch',name:'verified-workflow',baseRevision:2,content:'Curator replacement.'}],{kind:'curator'})).toThrow(/user|managed/i);
 expect(x.store.internal('test.curate',null,()=>curateSkills(x.store,{now:'2026-12-20T12:00:00.000Z'}))).toEqual([]);
});
it('validates flag payloads and accepts omitted optional control values',()=>{
 const x=fixture();x.create();
 expect(()=>x.store.internal('test.flags',null,()=>setSkillFlags(x.store,'verified-workflow',null as never,1))).toThrow(/valid skill controls/i);
 x.flags('verified-workflow',{enabled:false,protected:undefined},1);expect(viewSkill(x.store,'verified-workflow',{includeInactive:true}).skill).toMatchObject({enabled:false,protected:false,revision:2});
});
it('pages version metadata while preserving access to every immutable body',()=>{
 const x=fixture();x.create();x.change(Array.from({length:24},(_,i)=>({action:'patch',name:'verified-workflow',baseRevision:i+1,content:`Procedure revision ${i+2}.`} as SkillOperation)));
 const first=viewSkill(x.store,'verified-workflow');expect(first.versions).toHaveLength(20);expect(first.nextVersionOffset).toBe(20);
 const second=viewSkill(x.store,'verified-workflow',{versionOffset:20});expect(second.versions.map(item=>item.revision)).toEqual([5,4,3,2,1]);expect(second.nextVersionOffset).toBeNull();expect(viewSkill(x.store,'verified-workflow',{revision:1}).content).toContain('exact source');
});
it('enforces the total support-package size and retained library/proposal counts',()=>{
 const x=fixture();x.create();x.change([{action:'write_file',name:'verified-workflow',baseRevision:1,path:'references/large.txt',content:'a'.repeat(65536)}]);
 expect(()=>x.change([{action:'write_file',name:'verified-workflow',baseRevision:2,path:'references/overflow.txt',content:'a'.repeat(65536)}])).toThrow(/128 KiB/i);
 for(let i=0;i<20;i++)x.change([{action:'patch',name:'verified-workflow',baseRevision:2,content:'Pending revision.'}],agent,{requireApproval:true});
 expect(()=>x.change([{action:'delete',name:'verified-workflow',baseRevision:2}],agent,{requireApproval:true})).toThrow(/pending/i);
 for(let batch=0;batch<4;batch++){const count=batch===3?31:32;x.change(Array.from({length:count},(_,i)=>({action:'create',name:`bounded-${batch}-${i}`,description:'Bounded procedure',content:'Use verified source.',baseRevision:0})));}
 expect(()=>x.create('one-too-many')).toThrow(/128-record/i);expect(x.store.all('skill')).toHaveLength(128);
});
