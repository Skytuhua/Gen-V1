import {HarnessError,type CommandReceipt,type HostCommand} from '../contracts/index.ts';
import type {SkillActor,SkillChangeResult,SkillDetail,SkillOperation,SkillProposal,SkillSummary,SkillVersionSummary} from '../contracts/skills.ts';
import {digest,type Store} from '../storage/store.ts';

export interface HermesLibrarySource {request<T=unknown>(method:string,params?:Record<string,unknown>):Promise<T>}
interface LedgerEntry {id:string;ts:string;actor:string;action:string;skill:string}
interface Inspection {name:string;description:string;category?:string|null;document:string;content:string;files:string[];fileContent?:string;fileHashes?:Record<string,string>;usage:Record<string,unknown>;versions:LedgerEntry[];versionsVerified?:boolean}
interface CapturedPackage {inspection:Inspection; files:Record<string,string>; sourceId?:string}
interface Catalog {skills:{name:string}[];archived:string[];usage:Record<string,Record<string,unknown>>}
interface SourceSnapshot {catalog:Catalog;inspections:Record<string,Inspection>;proposals:NativePending[]}
interface NativePending {id:string;created_at:number;origin:string;summary:string;payload:Record<string,unknown>}
interface Version {revision:number;at:string;actor:SkillActor;action:string;skill:SkillSummary&{content:string;files:Record<string,string>};document?:string;sourceId?:string}
interface Expected {documentHash:string|null;fileHashes:Record<string,string>;enabled:boolean;protected:boolean;state:string;tip:string|null}
interface Projection {name:string;fingerprint:string;sourceId?:string;expected:Expected}
interface Intent {hash:string;state:'prepared'|'uncertain';method:string;params:Record<string,unknown>;at:string}
const failure=(message:string,code='INVALID_SKILL'):never=>{throw new HarnessError(code,message);};
const checked=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return failure('Original Hermes returned an invalid write result.','HERMES_PROTOCOL');
 const result=value as Record<string,unknown>;
 if(result.success===false)return failure(String(result.error??result.message??'Original Hermes refused this change.'),'HERMES_SKILL_REFUSED');
 return result;
};
const actor=(entry?:LedgerEntry):SkillActor=>({kind:entry?.actor==='curator'?'curator':entry?.actor==='agent'?'agent':'user'});

/** Source files/ledger are authoritative. SQLite is only UI CAS/history/receipt projection. */
export class HermesSourceLibrary {
 private tail:Promise<void>=Promise.resolve();
 constructor(private options:{source:HermesLibrarySource;store:Store}){}
 private get source(){return this.options.source;}
 private get store(){return this.options.store;}
 private async serial<T>(work:()=>Promise<T>):Promise<T>{
  const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(done=>{release=done;});
  await previous;try{return await work();}finally{release();}
 }
 initialize():Promise<{migrated:number}>{return this.serial(async()=>{
  let migrated=0;
  const catalog=await this.source.request<Catalog>('skills.list',{}),names=new Set([...catalog.skills.map(row=>row.name),...catalog.archived]);
  for(const summary of this.store.all<SkillSummary>('skill')){
   if(this.store.get('hermesSkill',summary.name))continue;
   try{
   const version=this.store.get<Version>('skillVersion',`${summary.name}@${summary.revision}`);
   if(!version)failure('Legacy skill history is missing; preserve it before migration.','HERMES_MIGRATION_CONFLICT');
   const compose=await this.source.request<{document:string}>('skills.compose',{name:summary.name,description:summary.description,content:version!.skill.content});
   if(names.has(summary.name)){
    const existing=await this.source.request<Inspection>('skills.inspect',{name:summary.name});
    const files=await this.files(existing);
    if(existing.content!==version!.skill.content||existing.description!==summary.description||digest(files)!==digest(version!.skill.files))failure(`Legacy and source skill '${summary.name}' differ; both copies are preserved.`,'HERMES_MIGRATION_CONFLICT');
   }else{
    const operations=[{action:'create',name:summary.name,category:summary.category,content:compose.document},...Object.entries(version!.skill.files).map(([file_path,file_content])=>({action:'write_file',name:summary.name,file_path,file_content}))];
    if(operations.length>20)failure(`Legacy skill '${summary.name}' needs more than the original 20-operation atomic import limit.`,'HERMES_MIGRATION_CONFLICT');
    await this.mutate(`migration:${summary.name}`,digest(version),'skills.import',{payload:{action:'',name:'',operations,session_id:`host-migration:${summary.name}`}});
    const imported=await this.source.request<Inspection>('skills.inspect',{name:summary.name});
    if(imported.document!==compose.document||digest(await this.files(imported))!==digest(version!.skill.files))failure('Imported source bytes differ; both copies and legacy history are preserved.','HERMES_MIGRATION_CONFLICT');
    migrated++;
   }
   const usage=this.store.get<{count:number;lastUsedAt:string|null}>('skillUsage',summary.name),metrics={count:usage?.count??summary.useCount,lastUsedAt:usage?.lastUsedAt??summary.lastUsedAt,patchCount:summary.patchCount,createdAt:summary.createdAt,updatedAt:summary.updatedAt},legacyUsage={id:digest({revision:summary.revision,...metrics}),...metrics};
   await this.mutate(`migration-flags:${summary.name}`,digest(summary),'skills.flags',{name:summary.name,enabled:summary.enabled,protected:summary.protected,legacyUsage,legacyFresh:!names.has(summary.name),...(summary.managed?{managed:true}:{}),...(summary.state==='archived'?{archived:true}:{})});
   const verified=await this.source.request<Inspection>('skills.inspect',{name:summary.name});
   if(verified.usage.harness_enabled!==summary.enabled||verified.usage.harness_protected!==summary.protected)failure('Migrated source flags did not verify.','HERMES_RECONCILIATION_REQUIRED');
   if(digest(verified.usage.harness_legacy_usage??null)!==digest(legacyUsage))failure('Migrated source usage did not verify; legacy metrics are preserved.','HERMES_RECONCILIATION_REQUIRED');
   this.store.internal('hermes.migration.verified',null,()=>{this.store.remove('hermesIntent',`migration:${summary.name}`);this.store.remove('hermesIntent',`migration-flags:${summary.name}`);});
   this.store.internal('hermes.migration.ready',null,()=>{this.store.remove('hermesMigration',summary.name);const {migrationError:_error,...ready}=summary as SkillSummary&{migrationError?:string};this.store.put('skill',summary.name,null,ready);});
   }catch(error){
    if(!(error instanceof HarnessError)||!['HERMES_MIGRATION_CONFLICT','HERMES_SKILL_REFUSED','INVALID_SKILL'].includes(error.code))throw error;
    this.store.internal('hermes.migration.pending',null,()=>{this.store.put('hermesMigration',summary.name,null,{name:summary.name,status:'pending',error:error.message,revision:summary.revision});this.store.put('skill',summary.name,null,{...summary,migrationError:error.message});});
   }
  }
  await this.migrateProposals();await this.refreshSource();return{migrated};
 });}
 migrate(_store?:Store){return this.initialize();}
 refresh():Promise<void>{return this.serial(()=>this.refreshSource());}

 private async files(value:Inspection,revisionId?:string):Promise<Record<string,string>>{
  const files:Record<string,string>={};
  for(const file_path of value.files.filter(path=>path!=='SKILL.md')){
   const detail=await this.source.request<Inspection>('skills.inspect',{name:value.name,file_path,...(revisionId?{revisionId}:{})});
   if(typeof detail.fileContent!=='string')failure('A canonical supporting file is unavailable.','HERMES_PROTOCOL');
   files[file_path]=detail.fileContent!;
  }
  return files;
 }
 private async capture(name:string,expected:Expected):Promise<CapturedPackage>{
  let result:CapturedPackage;
  try{result=await this.source.request<CapturedPackage>('skills.capture',{name,expected:{[name]:expected}});}
  catch{return failure('A canonical package could not be captured. Refresh its source state before continuing.','HERMES_RECONCILIATION_REQUIRED');}
  const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const value=result?.inspection;
  if(!object(result)||!object(value)||typeof value.name!=='string'||typeof value.description!=='string'||(value.category!==undefined&&value.category!==null&&typeof value.category!=='string')||typeof value.document!=='string'||typeof value.content!=='string'||!Array.isArray(value.files)||value.files.some(path=>typeof path!=='string')||!object(value.fileHashes)||Object.values(value.fileHashes).some(hash=>typeof hash!=='string')||!object(value.usage)||!Array.isArray(value.versions)||value.versions.some(entry=>!object(entry)||['id','ts','actor','action','skill'].some(key=>typeof entry[key]!=='string'))||!object(result.files)||Object.values(result.files).some(text=>typeof text!=='string')||(result.sourceId!==undefined&&typeof result.sourceId!=='string'))return failure('Original Hermes returned an invalid package capture.','HERMES_PROTOCOL');
  const paths=value.files,expectedPaths=Object.keys(expected.fileHashes),support=paths.filter(path=>path!=='SKILL.md');
  const descriptor:Expected={documentHash:value.fileHashes['SKILL.md']??null,fileHashes:value.fileHashes,state:String(value.usage.state??'active'),enabled:typeof value.usage.harness_enabled==='boolean'?value.usage.harness_enabled:true,protected:typeof value.usage.harness_protected==='boolean'?value.usage.harness_protected:false,tip:value.versions[0]?.id??null};
  if(value.name!==name||new Set(paths).size!==paths.length||!paths.includes('SKILL.md')||digest([...paths].sort())!==digest(expectedPaths.sort())||digest(Object.keys(result.files).sort())!==digest(support.sort())||digest(descriptor)!==digest(expected)||result.sourceId!==(expected.tip??undefined))return failure('The canonical package capture does not match its source snapshot.','HERMES_RECONCILIATION_REQUIRED');
  return result;
 }
 private async refreshSource():Promise<void>{
  const snapshot=await this.source.request<SourceSnapshot>('skills.snapshot',{}),{catalog,proposals:pending}=snapshot;
  const archived=new Set(catalog.archived),names=[...new Set([...catalog.skills.map(row=>row.name),...catalog.archived])];
  const updates:{summary:SkillSummary;projection:Projection;versions:Version[]}[]=[];
  for(const name of names){
   if(this.store.get('hermesMigration',name))continue;
   let value=snapshot.inspections[name];const old=this.store.get<SkillSummary>('skill',name),previous=this.store.get<Projection>('hermesSkill',name);
   if(!value)failure('A source snapshot row is missing.','HERMES_PROTOCOL');
   const snapshotUsage=value.usage??catalog.usage[name]??{},snapshotLatest=value.versions[0];
   const state=archived.has(name)?'archived':snapshotUsage.state==='stale'?'stale':'active';
   const enabled=typeof snapshotUsage.harness_enabled==='boolean'?snapshotUsage.harness_enabled:old?.enabled??true,protectedFlag=typeof snapshotUsage.harness_protected==='boolean'?snapshotUsage.harness_protected:old?.protected??false;
   const expected:Expected={documentHash:value.fileHashes?.['SKILL.md']??null,fileHashes:value.fileHashes??{},state,enabled,protected:protectedFlag,tip:snapshotLatest?.id??null};
   const fingerprint=digest(expected);
   const changed=previous?.fingerprint!==fingerprint;
   const captured=changed&&(!old||previous)?await this.capture(name,expected):undefined;
   if(captured)value=captured.inspection;
   const usage=value.usage??{},latest=value.versions[0],stamp=latest?.ts??String(usage.created_at??old?.createdAt??new Date().toISOString());
   let revision=old?.revision??0;
   const versions:Version[]=[];
   const managed=usage.created_by==='agent'||usage.agent_created===true;
   const base={name,description:value.description,category:value.category&&value.category!=='.archive'?value.category:old?.category??'general',state,enabled,protected:protectedFlag,origin:old?.origin??(managed?'agent':'user'),managed,author:actor(latest).kind,createdAt:old?.createdAt??String(usage.created_at??stamp),updatedAt:changed?stamp:old?.updatedAt??stamp,lastUsedAt:typeof usage.last_used_at==='string'?usage.last_used_at:null,useCount:Number(usage.use_count??0),patchCount:Number(usage.patch_count??0)} satisfies Omit<SkillSummary,'revision'>;
   // Existing legacy revisions are immutable; link their matching migration state.
   if(captured){
    revision++;
    versions.push({revision,at:stamp,actor:actor(latest),action:latest?.action??'source',skill:{...base,revision,content:captured.inspection.content,files:captured.files},document:captured.inspection.document,...(captured.sourceId?{sourceId:captured.sourceId}:{})});
   }
   if(!revision)revision=1;
   updates.push({summary:{...base,revision},projection:{name,fingerprint,expected,...(latest?{sourceId:latest.id}:{})},versions});
  }
  this.store.internal('hermes.library.refreshed',null,()=>{
   for(const {summary,projection,versions}of updates){
    this.store.put('skill',summary.name,null,summary);this.store.put('hermesSkill',summary.name,null,projection);this.store.put('skillUsage',summary.name,null,{count:summary.useCount,lastUsedAt:summary.lastUsedAt});
    for(const version of versions){const key=`${summary.name}@${version.revision}`;if(this.store.get('skillVersion',key))failure('A UI history revision cannot be overwritten.','SKILL_VERSION_CONFLICT');this.store.put('skillVersion',key,null,version);}
   }
   for(const item of this.store.all<Projection>('hermesSkill'))if(!names.includes(item.name)&&!this.store.get('hermesMigration',item.name)){this.store.remove('skill',item.name);this.store.remove('hermesSkill',item.name);}
   for(const row of pending){
    const link=this.store.get<{id:string}>('hermesProposal',row.id),id=link?.id??row.id;
    const old=this.store.get<SkillProposal>('skillProposal',id);
    if(!old)this.store.put('skillProposal',id,null,this.pendingProjection(row,id));
   }
   return{skills:updates.length,pending:pending.length};
  });
 }
 private pendingProjection(row:NativePending,id=row.id):SkillProposal{
  const raw=(Array.isArray(row.payload.operations)?row.payload.operations:[row.payload]) as Record<string,unknown>[];
  const operations=raw.map(op=>({action:op.action,name:op.name,baseRevision:this.store.get<SkillSummary>('skill',String(op.name))?.revision??0,...(op.content===undefined?{}:{content:op.content}),...(op.file_path===undefined?{}:{path:op.file_path}),...(op.file_content===undefined?{}:{content:op.file_content}),...(op.old_string===undefined?{}:{oldText:op.old_string,newText:op.new_string})})) as SkillOperation[];
  return{id,createdAt:new Date(row.created_at*1000).toISOString(),status:'pending',actor:{kind:row.origin==='background_review'?'agent':'user'},targets:[...new Set(operations.map(op=>op.name))],operations};
 }
 private async migrateProposals(){
  const pending=await this.source.request<NativePending[]>('skills.proposals',{});
  for(const proposal of this.store.all<SkillProposal>('skillProposal').filter(row=>row.status==='pending')){
   if(this.store.all<{id:string}>('hermesProposal').some(link=>link.id===proposal.id))continue;
   if(proposal.targets.some(name=>this.store.get('hermesMigration',name)))continue;
   try{
   const existing=pending.find(row=>row.payload.harness_legacy_proposal===proposal.id);
   const operations=await this.operations(proposal.operations,false);
   const payload={action:'',name:'',operations,harness_legacy_proposal:proposal.id};
   let sourceId=existing?.id;
   if(!sourceId){
    const value=checked(await this.mutate(`proposal-migration:${proposal.id}`,digest(proposal),'skills.stage',{payload,summary:'Preserved pending legacy skill proposal',origin:proposal.actor.kind==='user'?'foreground':'background_review'}));
    sourceId=String(value.id);
   }
   const persisted=(await this.source.request<NativePending[]>('skills.proposals',{})).find(row=>row.id===sourceId);
   if(!persisted||digest(persisted.payload)!==digest(payload))failure('The pending source payload did not verify; the legacy proposal and intent are retained.','HERMES_RECONCILIATION_REQUIRED');
   this.store.internal('hermes.proposal.linked',null,()=>{this.store.put('hermesProposal',sourceId!,null,{id:proposal.id});this.store.remove('hermesIntent',`proposal-migration:${proposal.id}`);});
   }catch(error){if(!(error instanceof HarnessError)||!['HERMES_MIGRATION_CONFLICT','HERMES_SKILL_REFUSED','INVALID_SKILL'].includes(error.code))throw error;this.store.internal('hermes.proposal.migration.pending',null,()=>this.store.put('hermesProposalMigration',proposal.id,null,{id:proposal.id,error:error.message}));}
  }
 }
 private async mutate(id:string,hash:string,method:string,params:Record<string,unknown>):Promise<unknown>{
  const existing=this.store.get<Intent>('hermesIntent',id);
  if(existing){if(existing.hash!==hash)failure('Command ID reused with different content.','DUPLICATE_COMMAND');failure('A source write has an uncertain result. Reconcile its canonical files before retrying.','HERMES_RECONCILIATION_REQUIRED');}
  this.store.internal('hermes.intent.prepared',null,()=>this.store.put('hermesIntent',id,null,{hash,state:'prepared',method,params,at:new Date().toISOString()} satisfies Intent));
  let result:unknown;
  try{result=await this.source.request(method,params);}catch(error){
   if(error instanceof HarnessError&&['HERMES_SOURCE_BUSY','HERMES_CONFIG_BUSY','INVALID_SKILL','STALE_SKILL','HERMES_SKILL_REFUSED'].includes(error.code)){this.store.internal('hermes.intent.refused',null,()=>this.store.remove('hermesIntent',id));throw error;}
   this.store.internal('hermes.intent.uncertain',null,()=>this.store.put('hermesIntent',id,null,{hash,state:'uncertain',method,params,at:new Date().toISOString()} satisfies Intent));throw new HarnessError('HERMES_RECONCILIATION_REQUIRED','A source write could not be confirmed. Its intent is retained.',{cause:error instanceof Error?error.message:String(error)});
  }
  if(result&&typeof result==='object'&&(result as Record<string,unknown>).success===false){this.store.internal('hermes.intent.refused',null,()=>this.store.remove('hermesIntent',id));checked(result);}
  return result;
 }
 private async operations(operations:SkillOperation[],cas=true):Promise<Record<string,unknown>[]>{
  if(!Array.isArray(operations)||operations.length<1||operations.length>20)failure('Use at most 20 original Hermes operations.');
  const result:Record<string,unknown>[]=[],documents=new Map<string,string>(),revisions=new Map<string,number>();
  for(const op of operations){
   if(!op||typeof op!=='object'||typeof op.name!=='string'||typeof op.action!=='string'||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)failure('Choose valid skill operations with a current revision.');
   const summary=this.store.get<SkillSummary>('skill',op.name);
   const revision=revisions.get(op.name)??summary?.revision??0;
   if(cas&&op.baseRevision!==revision)failure('This skill revision changed. Inspect it before editing.','STALE_SKILL');
   revisions.set(op.name,revision+1);
   if(op.action==='create'){
    if(cas&&summary)failure('This skill already exists. Restore it explicitly.','SKILL_EXISTS');
    const value=await this.source.request<{document:string}>('skills.compose',{name:op.name,description:op.description??'',content:op.content??''});
    result.push({action:'create',name:op.name,content:value.document,...(op.category?{category:op.category}:{})});documents.set(op.name,value.document);
   }else if(op.action==='patch'){
    if(op.category!==undefined&&op.category!==summary?.category)failure('Original Hermes assigns categories when creating a package.');
    const document=documents.get(op.name)??(await this.source.request<Inspection>('skills.inspect',{name:op.name})).document;
    const composed=await this.source.request<{document:string}>('skills.compose',{document,...(op.content===undefined?{}:{content:op.content}),...(op.description===undefined?{}:{description:op.description}),...(op.oldText===undefined&&op.newText===undefined?{}:{oldText:op.oldText,newText:op.newText})});
    result.push({action:'patch',name:op.name,content:composed.document});documents.set(op.name,composed.document);
   }else if(op.action==='write_file')result.push({action:op.action,name:op.name,file_path:op.path,file_content:op.content});
   else if(op.action==='remove_file')result.push({action:op.action,name:op.name,file_path:op.path});
   else failure('Archive, restore and rollback must be submitted as a single operation.');
  }
  return result;
 }
 command(command:HostCommand):Promise<CommandReceipt>{return this.serial(async()=>{
  const receipt=this.store.receipt(command);if(receipt)return receipt;
  const payload=command.payload;
  if(command.type==='skill.manage'&&(!Array.isArray(payload.operations)||payload.operations.length<1||payload.operations.length>20||payload.operations.some(op=>!op||typeof op!=='object'||typeof op.name!=='string'||typeof op.action!=='string'||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)))failure('Choose a valid batch of at most 20 skill operations.');
  if(command.type==='skill.flags'&&(typeof payload.name!=='string'||!['enabled','protected'].some(key=>payload[key]!==undefined)||['enabled','protected'].some(key=>payload[key]!==undefined&&typeof payload[key]!=='boolean')))failure('Choose explicit boolean skill controls.');
  if(command.type==='skill.decide'&&(typeof payload.approve!=='boolean'||typeof payload.proposalId!=='string'))failure('Choose approve or reject explicitly.');
  if(this.store.get('hermesIntent',command.id))failure('A source write has an uncertain result; do not replay it.','HERMES_RECONCILIATION_REQUIRED');
  await this.refreshSource();const p=command.payload;let method='',params:Record<string,unknown>={},targets:string[]=[],proposalId:string|undefined;
  if(command.type==='skill.manage'){
   if(!Array.isArray(p.operations)||p.operations.length<1||p.operations.length>20||p.operations.some(op=>!op||typeof op!=='object'||typeof op.name!=='string'||typeof op.action!=='string'||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0))failure('Choose a valid batch of at most 20 skill operations.');
   const ops=p.operations as SkillOperation[];targets=[...new Set(ops.map(op=>op.name))];
   if(targets.some(name=>this.store.get('hermesMigration',name)))failure('This legacy package is preserved and awaiting source-compatible migration.','HERMES_MIGRATION_PENDING');
   const first=ops?.[0];
   if(ops?.length===1&&['delete','restore'].includes(first.action)){
    if(first.baseRevision!==this.store.get<SkillSummary>('skill',first.name)?.revision)failure('This skill revision changed.','STALE_SKILL');
    method='skills.flags';params={name:first.name,archived:first.action==='delete'};
   }else if(ops?.length===1&&first.action==='rollback'){
    if(first.baseRevision!==this.store.get<SkillSummary>('skill',first.name)?.revision)failure('This skill revision changed.','STALE_SKILL');
    const target=await this.viewSource(first.name,{revision:first.revision,includeInactive:true}),current=await this.source.request<Inspection>('skills.inspect',{name:first.name});
    const old=this.store.get<Version>('skillVersion',`${first.name}@${first.revision}`),desired:Record<string,string>=old?.sourceId?{}:old?.skill.files??{};
    if(old?.sourceId)for(const path of target.files)desired[path]=(await this.viewSource(first.name,{revision:first.revision,path,includeInactive:true})).content;
    const operations=[{action:'patch',name:first.name,content:target.document},...current.files.filter(path=>path!=='SKILL.md'&&!Object.hasOwn(desired,path)).map(file_path=>({action:'remove_file',name:first.name,file_path})),...Object.entries(desired).map(([file_path,file_content])=>({action:'write_file',name:first.name,file_path,file_content}))];
    if(operations.length>20)failure('This restore exceeds the original 20-operation atomic limit.');method='skills.manage';params={action:'',name:'',operations,session_id:command.id};
   }else{method='skills.manage';params={action:'',name:'',operations:await this.operations(ops),session_id:command.id};}
  }else if(command.type==='skill.flags'){
   if(typeof p.name!=='string'||!['enabled','protected'].some(key=>p[key]!==undefined)||['enabled','protected'].some(key=>p[key]!==undefined&&typeof p[key]!=='boolean'))failure('Choose explicit boolean skill controls.');
   const summary=this.store.get<SkillSummary>('skill',String(p.name));if(!summary||summary.revision!==p.baseRevision)failure('This skill revision changed.','STALE_SKILL');targets=[summary!.name];method='skills.flags';params={name:p.name,...(p.enabled===undefined?{}:{enabled:p.enabled}),...(p.protected===undefined?{}:{protected:p.protected})};
   if(this.store.get('hermesMigration',summary!.name))failure('This legacy package is awaiting source-compatible migration.','HERMES_MIGRATION_PENDING');
  }else if(command.type==='skill.decide'){
   if(typeof p.approve!=='boolean'||typeof p.proposalId!=='string')failure('Choose approve or reject explicitly.');
   proposalId=String(p.proposalId);const proposal=this.store.get<SkillProposal>('skillProposal',proposalId);if(!proposal||proposal.status!=='pending')failure('This proposal is unavailable.','NOT_FOUND');
   if(proposal!.targets.some(name=>this.store.get('hermesMigration',name))||this.store.get('hermesProposalMigration',proposalId)){
    if(p.approve)failure('This preserved proposal is awaiting source-compatible migration.','HERMES_MIGRATION_PENDING');
    return this.store.command(command,()=>{this.store.put('skillProposal',proposalId!,null,{...proposal!,status:'rejected',decidedAt:new Date().toISOString()});return{status:'rejected',changes:[],proposalId};});
   }
   if(p.approve){const revisions=new Map<string,number>();for(const op of proposal!.operations){const current=revisions.get(op.name)??this.store.get<SkillSummary>('skill',op.name)?.revision??0;if(op.baseRevision!==current)failure('A proposed skill changed. Inspect it before approving.','STALE_SKILL');revisions.set(op.name,current+1);}}
   const sourceId=(this.store.db.prepare("SELECT id FROM entities WHERE kind=? AND json_extract(body,'$.id')=?").get('hermesProposal',proposalId) as {id:string}|undefined)?.id??proposalId;
   targets=proposal!.targets;method='skills.decide';params={id:sourceId,approve:p.approve};
  }else if(command.type==='learning.curate'){if(p.consolidate!==undefined&&typeof p.consolidate!=='boolean')failure('Choose an explicit curation mode.');method='skills.curate';params={dryRun:false,consolidate:p.consolidate===true};}
  else failure('Unknown source library command.','UNKNOWN_CAPABILITY');
  if(targets.length)params.expected=Object.fromEntries(targets.map(name=>[name,this.store.get<Projection>('hermesSkill',name)?.expected??null]));
  const value=checked(await this.mutate(command.id,digest(command),method,params));
  try{await this.refreshSource();}catch{failure('The source changed but its projection could not be verified. Do not repeat the write.','HERMES_RECONCILIATION_REQUIRED');}
  if(value.pending_id){const pending=(await this.source.request<NativePending[]>('skills.proposals',{})).find(row=>row.id===value.pending_id);if(!pending||digest(pending.payload.operations)!==digest(params.operations))failure('The pending source payload could not be verified. Its intent is retained.','HERMES_RECONCILIATION_REQUIRED');}
  const result:SkillChangeResult={status:value.staged?'pending':command.type==='skill.decide'&&p.approve===false?'rejected':'applied',changes:targets.flatMap(name=>{const summary=this.store.get<SkillSummary>('skill',name);return summary?[summary]:[];}),...(value.pending_id?{proposalId:String(value.pending_id)}:proposalId?{proposalId}:{})};
  return this.store.command(command,()=>{
   this.store.remove('hermesIntent',command.id);
   if(command.type==='learning.curate')this.store.put('learningStatus','global',null,{...(this.store.get<Record<string,unknown>>('learningStatus','global')??{supported:true,status:'idle',lastReview:null}),lastCuratedAt:new Date().toISOString()});
   if(proposalId){const proposal=this.store.get<SkillProposal>('skillProposal',proposalId);if(proposal)this.store.put('skillProposal',proposalId,null,{...proposal,status:p.approve?'approved':'rejected',decidedAt:new Date().toISOString()});}
   return command.type==='learning.curate'?{changes:result.changes}:result;
  });
 });}
 view(name:string,options:{path?:string;revision?:number;includeInactive?:boolean;versionOffset?:number}={}):Promise<SkillDetail>{return this.serial(()=>this.viewSource(name,options));}
 private async viewSource(name:string,options:{path?:string;revision?:number;includeInactive?:boolean;versionOffset?:number}):Promise<SkillDetail>{
  const summary=this.store.get<SkillSummary>('skill',name);if(!summary)failure('Skill not found.','NOT_FOUND');if(!options.includeInactive&&(!summary!.enabled||summary!.state==='archived'))failure('This skill is disabled or unavailable.','SKILL_DISABLED');
  const legacyPending=this.store.get('hermesMigration',name);
  const version=options.revision===undefined?(legacyPending?this.store.get<Version>('skillVersion',`${name}@${summary!.revision}`):null):this.store.get<Version>('skillVersion',`${name}@${options.revision}`);if(options.revision!==undefined&&!version)failure('Skill revision not found.','NOT_FOUND');
  const path=options.path??'SKILL.md';let content:string,document:string|undefined,files:string[],selected=summary!,retained:Set<string>|undefined;
  if(version&&!version.sourceId){const {content:body,files:storedFiles,...metadata}=version.skill;selected={...metadata,...(legacyPending?{migrationError:(summary as SkillSummary&{migrationError?:string}).migrationError}:{})};content=path==='SKILL.md'?body:storedFiles[path];document=path==='SKILL.md'?version.document??`---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(selected.description)}\n---\n\n${content}`:undefined;files=Object.keys(storedFiles);}
  else{const value=await this.source.request<Inspection>('skills.inspect',{name,...(version?.sourceId?{revisionId:version.sourceId}:{}),...(path==='SKILL.md'?{}:{file_path:path})});if(value.versionsVerified!==false)retained=new Set(value.versions.filter(entry=>entry.skill===name).map(entry=>entry.id));content=path==='SKILL.md'?value.content:value.fileContent!;document=path==='SKILL.md'?value.document:undefined;files=value.files.filter(path=>path!=='SKILL.md');if(version){const {content:_body,files:_files,...metadata}=version.skill;selected=metadata;}}
  if(typeof content!=='string')failure('Supporting file is unavailable.','NOT_FOUND');
  const all=this.store.all<Version>('skillVersion').filter(row=>row.skill.name===name).sort((a,b)=>b.revision-a.revision),offset=options.versionOffset??0,versions:SkillVersionSummary[]=all.slice(offset,offset+20).map(({revision,at,actor,action,sourceId})=>({revision,at,actor,action,...(sourceId&&retained?{sourceAvailability:retained.has(sourceId)?'retained' as const:'unavailable' as const}:{})}));
  return{skill:selected,content,document,files,versions,nextVersionOffset:offset+20<all.length?offset+20:null};
 }
 proposal(id:string):Promise<SkillProposal>{return this.serial(async()=>{const value=this.store.get<SkillProposal>('skillProposal',id);if(!value)failure('Skill proposal not found.','NOT_FOUND');return value!;});}
}
