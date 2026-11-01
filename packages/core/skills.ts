import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import type {SkillActor,SkillChangeResult,SkillDetail,SkillOperation,SkillPage,SkillPolicy,SkillProposal,SkillProposalSummary,SkillSummary,SkillVersionSummary} from '../contracts/skills.ts';
import {digest,type Store} from '../storage/store.ts';

export const SKILL_LIMITS={records:128,bodyBytes:64*1024,fileBytes:64*1024,packageBytes:128*1024,files:32,operations:32,pending:20,page:20,responseBytes:8192} as const;
interface SkillRecord extends SkillSummary {content:string;files:Record<string,string>}
interface SkillVersion extends SkillVersionSummary {skill:SkillRecord}
interface SkillUsage {count:number;lastUsedAt:string}
const unsafeKeys=new Set(['__proto__','prototype','constructor']);
const secret=/\b(?:sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{25,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const operationBase={name:z.string(),baseRevision:z.number().int().nonnegative()};
const operationSchema=z.discriminatedUnion('action',[
 z.strictObject({...operationBase,action:z.literal('create'),description:z.string(),category:z.string().optional(),content:z.string()}),
 z.strictObject({...operationBase,action:z.literal('patch'),description:z.string().optional(),category:z.string().optional(),content:z.string().optional(),oldText:z.string().optional(),newText:z.string().optional()}),
 z.strictObject({...operationBase,action:z.literal('write_file'),path:z.string(),content:z.string()}),z.strictObject({...operationBase,action:z.literal('remove_file'),path:z.string()}),
 z.strictObject({...operationBase,action:z.literal('delete')}),z.strictObject({...operationBase,action:z.literal('restore')}),z.strictObject({...operationBase,action:z.literal('rollback'),revision:z.number().int().positive()}),
]);
const identity=z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/);
const actorSchema=z.strictObject({kind:z.enum(['user','agent','curator']),threadId:identity.optional(),runId:identity.optional(),evidence:z.array(identity).max(8).optional()});
const fail=(message:string,code='INVALID_SKILL'):never=>{throw new HarnessError(code,message);};
const at=(value?:string)=>{const date=value??new Date().toISOString();if(!Number.isFinite(Date.parse(date)))fail('Choose a valid skill timestamp.');return date;};
function nameOf(value:string){if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)||unsafeKeys.has(value))fail('Choose a lowercase skill name of at most 64 letters, digits or dashes.');return value;}
function text(value:unknown,label:string,max:number,empty=false){if(typeof value!=='string'||(!empty&&!value.trim())||Buffer.byteLength(value)>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)||secret.test(value))fail(`Keep ${label} within its size limit and omit credentials or control characters.`);return value as string;}
function pathOf(value:unknown){const path=text(value,'supporting paths',1024);if(path.includes('\\')||path.includes(':')||/^[\/]|[\r\n\t]/.test(path)||path.toLowerCase()==='skill.md'||path.split('/').some(part=>!part||part==='.'||part==='..'||unsafeKeys.has(part)))fail('Use an ordinary relative supporting-file path.');return path;}
function metadata(record:SkillRecord):SkillSummary {const {content:_content,files:_files,...summary}=record;return summary;}
function usage(store:Store,summary:SkillSummary):SkillSummary {const value=store.get<SkillUsage>('skillUsage',summary.name);return value?{...summary,useCount:value.count,lastUsedAt:value.lastUsedAt}:summary;}
function current(store:Store,name:string):SkillRecord|null {const summary=store.get<SkillSummary>('skill',name);if(!summary)return null;const version=store.get<SkillVersion>('skillVersion',`${name}@${summary.revision}`);if(!version)fail('The saved skill version is unavailable.','SKILL_VERSION_MISSING');return {...usage(store,summary),content:version!.skill.content,files:structuredClone(version!.skill.files)};}
function save(store:Store,record:SkillRecord,actor:SkillActor,action:string){const key=`${record.name}@${record.revision}`;if(store.get('skillVersion',key))fail('A saved skill version cannot be overwritten.','SKILL_VERSION_CONFLICT');store.put('skill',record.name,null,metadata(record));store.put('skillVersion',key,null,{revision:record.revision,at:record.updatedAt,actor:structuredClone(actor),action,skill:structuredClone(record)} satisfies SkillVersion);}
function checkPackage(record:SkillRecord){text(record.description,'descriptions',1024);if(/[\r\n\t]/.test(record.description))fail('Keep the description on one line.');if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.category)||unsafeKeys.has(record.category))fail('Choose an ordinary skill category.');text(record.content,'skill instructions',SKILL_LIMITS.bodyBytes);const entries=Object.entries(record.files);if(entries.length>SKILL_LIMITS.files)fail('A skill can contain at most 32 supporting files.');for(const [path,content]of entries){pathOf(path);text(content,'supporting text',SKILL_LIMITS.fileBytes,true);}if(Buffer.byteLength(record.content)+entries.reduce((sum,[,content])=>sum+Buffer.byteLength(content),0)>SKILL_LIMITS.packageBytes)fail('The skill package exceeds 128 KiB.');}
function mutable(record:SkillRecord,actor:SkillActor){if(actor.kind==='user')return;if(record.protected)fail('This skill is protected by the user.','SKILL_PROTECTED');if(!record.enabled)fail('This skill is disabled by the user.','SKILL_DISABLED');if(record.state==='archived')fail('Restore this archived skill explicitly before changing it.','SKILL_ARCHIVED');if(actor.kind==='curator'&&(record.origin==='user'||!record.managed))fail('The curator cannot change user-maintained skills.','SKILL_PROTECTED');}

export function listSkills(store:Store,options:{query?:string;includeInactive?:boolean;offset?:number;limit?:number}={}):SkillPage {
 const {offset=0,limit=20}=options;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>SKILL_LIMITS.page)fail('Use a valid skill page.');
 const query=options.query===undefined?'':text(options.query,'skill searches',1000,true),tokens=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const all=store.all<SkillSummary>('skill').sort((a,b)=>a.name.localeCompare(b.name));
 const catalogId=digest(all.map(({name,revision,state,enabled,protected:pin})=>({name,revision,state,enabled,protected:pin})));
 const records=all.filter(skill=>(options.includeInactive||skill.enabled&&skill.state!=='archived'&&!skill.migrationError)&&tokens.every(token=>`${skill.name} ${skill.description} ${skill.category}`.toLocaleLowerCase().includes(token)));
 const usages=new Map(store.db.prepare('SELECT id,body FROM entities WHERE kind=?').all('skillUsage').map(row=>{const item=row as {id:string;body:string};return[item.id,JSON.parse(item.body) as SkillUsage] as const;}));
 const page:SkillPage={skills:[],nextOffset:null,catalogId};
 for(let i=offset;i<records.length&&page.skills.length<limit;i++){const saved=records[i],value=usages.get(saved.name),summary=value?{...saved,useCount:value.count,lastUsedAt:value.lastUsedAt}:saved;const next={...page,skills:[...page.skills,summary],nextOffset:i+1<records.length?i+1:null};if(Buffer.byteLength(JSON.stringify(next))>SKILL_LIMITS.responseBytes){page.nextOffset=i;break;}page.skills.push(summary);page.nextOffset=i+1<records.length?i+1:null;}
 return page;
}

export function viewSkill(store:Store,name:string,options:{path?:string;revision?:number;includeInactive?:boolean;useId?:string;versionOffset?:number}={}):SkillDetail {
 if(typeof name!=='string'||store.get<{name:string}>('hermesSkill',name)?.name!==name)nameOf(name);let record=current(store,name);if(!record)fail('Skill not found.','NOT_FOUND');
 if(!options.includeInactive&&(!record!.enabled||record!.state==='archived'||record!.migrationError))fail('This skill is disabled or unavailable.','SKILL_DISABLED');
 if(options.revision!==undefined){if(!Number.isSafeInteger(options.revision)||options.revision<1)fail('Choose a saved skill revision.');const version=store.get<SkillVersion>('skillVersion',`${name}@${options.revision}`);if(!version)fail('Skill revision not found.','NOT_FOUND');record=structuredClone(version!.skill);}
 const path=options.path??'SKILL.md';if(path!=='SKILL.md')pathOf(path);
 const content=path==='SKILL.md'?record!.content:record!.files[path];if(content===undefined)fail('Supporting file not found.','NOT_FOUND');
 if(options.useId!==undefined){const useId=text(options.useId,'skill use identities',200),key=`${name}:${digest(useId)}`;if(options.revision!==undefined&&options.revision!==store.get<SkillSummary>('skill',name)?.revision)fail('Historical inspection cannot count as current skill use.');if(!store.get('skillUse',key)){const previous=store.get<SkillUsage>('skillUsage',name);const value={count:(previous?.count??0)+1,lastUsedAt:at()};store.put('skillUse',key,null,{name,useId});store.put('skillUsage',name,null,value);record={...record!,useCount:value.count,lastUsedAt:value.lastUsedAt};}}
 const offset=options.versionOffset??0;if(!Number.isSafeInteger(offset)||offset<0)fail('Choose a valid skill history page.');
 const rows=store.db.prepare("SELECT json_extract(body,'$.revision') AS revision,json_extract(body,'$.at') AS at,json_extract(body,'$.actor') AS actor,json_extract(body,'$.action') AS action FROM entities WHERE kind=? AND id LIKE ? ESCAPE '\\' AND json_extract(body,'$.skill.name')=? ORDER BY revision DESC LIMIT 21 OFFSET ?").all('skillVersion',`${name.replace(/[\\%_]/g,value=>'\\'+value)}@%`,name,offset) as {revision:number;at:string;actor:string;action:string}[];
 const versions:SkillVersionSummary[]=[];let nextVersionOffset:number|null=null;
 for(let i=0;i<Math.min(rows.length,20);i++){const row=rows[i],entry={...row,actor:JSON.parse(row.actor) as SkillActor};if(Buffer.byteLength(JSON.stringify([...versions,entry]))>SKILL_LIMITS.responseBytes){nextVersionOffset=offset+i;break;}versions.push(entry);nextVersionOffset=i+1<rows.length?offset+i+1:null;}
 return {skill:metadata(record!),content:content!,...(path==='SKILL.md'?{document:`---\nname: ${JSON.stringify(record!.name)}\ndescription: ${JSON.stringify(record!.description)}\n---\n\n${content}`} : {}),files:Object.keys(record!.files).sort(),versions,nextVersionOffset};
}

function prepare(store:Store,raw:unknown,actor:SkillActor,policy:SkillPolicy){
 const parsed=z.array(operationSchema).min(1).max(SKILL_LIMITS.operations).safeParse(raw);if(!parsed.success)fail('Choose a valid batch of at most 32 skill operations.');
 const checkedActor=actorSchema.safeParse(actor);if(!checkedActor.success||secret.test(JSON.stringify(actor)))fail('Choose a valid skill author without credentials.');
 const operations=parsed.data as SkillOperation[],stamp=at(policy.now),initial=new Map<string,SkillRecord|null>(),pending=new Map<string,SkillRecord>(),versions:SkillVersion[]=[];
 const get=(name:string)=>{if(!initial.has(name))initial.set(name,current(store,name));return pending.get(name)??initial.get(name)??null;};
 for(const operation of operations){
  const name=nameOf(operation.name),previous=get(name);if(operation.action==='create'&&previous)fail('This skill already exists. Restore its archived version instead.','SKILL_EXISTS');
  if(operation.action!=='create'&&!previous)fail('Skill not found.','NOT_FOUND');
  if(operation.baseRevision!==(previous?.revision??0))fail('This skill revision changed. Inspect it before editing.','STALE_SKILL');
  if(previous)mutable(previous,actor);else if(actor.kind==='curator')fail('The curator cannot create skills.','SKILL_PROTECTED');
  const original=initial.get(name),path=operation.path===undefined?undefined:pathOf(operation.path);
  if(original&&policy.readVersions){const key=path&&Object.hasOwn(original.files,path)?`${name}/${path}`:name;if(policy.readVersions.get(key)!==original.revision)fail('Read the current skill or exact supporting file during this review before changing it.','SKILL_READ_REQUIRED');}
  const next:SkillRecord=previous?structuredClone(previous):{name,description:'',category:'general',content:'',files:{},revision:0,state:'active',enabled:true,protected:false,origin:actor.kind==='user'?'user':'agent',managed:actor.kind!=='user',author:actor.kind,createdAt:stamp,updatedAt:stamp,lastUsedAt:null,useCount:0,patchCount:0};
  next.revision++;next.updatedAt=stamp;next.author=actor.kind;if(actor.threadId)next.sourceThreadId=actor.threadId;if(actor.runId)next.sourceRunId=actor.runId;
  if(actor.kind==='user'&&['patch','write_file','remove_file','rollback'].includes(operation.action))next.managed=false;
  if(operation.action==='create'){next.description=text(operation.description,'descriptions',1024);next.content=text(operation.content,'skill instructions',SKILL_LIMITS.bodyBytes);if(operation.category!==undefined)next.category=operation.category;}
  else if(operation.action==='patch'){
   if(operation.content!==undefined){if(operation.oldText!==undefined||operation.newText!==undefined)fail('Choose a whole rewrite or one exact patch.');next.content=text(operation.content,'skill instructions',SKILL_LIMITS.bodyBytes);}
   else if(operation.oldText!==undefined||operation.newText!==undefined){const old=text(operation.oldText,'patch targets',SKILL_LIMITS.bodyBytes),replacement=text(operation.newText,'replacement text',SKILL_LIMITS.bodyBytes,true),position=next.content.indexOf(old);if(position<0||next.content.indexOf(old,position+1)!==-1)fail('The patch target must occur exactly once.','SKILL_PATCH_CONFLICT');next.content=next.content.slice(0,position)+replacement+next.content.slice(position+old.length);}
   else if(operation.description===undefined&&operation.category===undefined)fail('Supply changed instructions or metadata.');
   if(operation.description!==undefined)next.description=operation.description;if(operation.category!==undefined)next.category=operation.category;next.patchCount++;
  }else if(operation.action==='write_file'){if(!path)fail('Choose a supporting file.');next.files[path!]=text(operation.content,'supporting text',SKILL_LIMITS.fileBytes,true);next.patchCount++;}
  else if(operation.action==='remove_file'){if(!path||!Object.hasOwn(next.files,path))fail('Supporting file not found.','NOT_FOUND');delete next.files[path!];next.patchCount++;}
  else if(operation.action==='delete'){next.state='archived';}
  else if(operation.action==='restore'){if(actor.kind!=='user')fail('Only the user can restore archived skills.','SKILL_PROTECTED');if(next.state!=='archived')fail('This skill is not archived.');next.state='active';}
  else if(operation.action==='rollback'){const target=versions.find(version=>version.skill.name===name&&version.revision===operation.revision)??store.get<SkillVersion>('skillVersion',`${name}@${operation.revision}`);if(!target)fail('Choose an existing saved revision.','NOT_FOUND');next.content=target!.skill.content;next.files=structuredClone(target!.skill.files);next.description=target!.skill.description;next.category=target!.skill.category;next.patchCount++;}
  checkPackage(next);pending.set(name,next);versions.push({revision:next.revision,at:stamp,actor:structuredClone(actor),action:operation.action,skill:next});
 }
 const existing=new Set(store.all<SkillSummary>('skill').map(skill=>skill.name));for(const name of pending.keys())existing.add(name);if(existing.size>SKILL_LIMITS.records)fail('The skill library has reached its 128-record limit.','SKILL_FULL');
 return {operations,stamp,pending,versions};
}

/** Mutations participate in the caller's existing Store command transaction. */
export function applySkillOperations(store:Store,operations:unknown,actor:SkillActor,policy:SkillPolicy={}):SkillChangeResult {
 const prepared=prepare(store,operations,actor,policy);
 if(policy.requireApproval&&actor.kind!=='user'){
  if(listSkillProposals(store).length>=SKILL_LIMITS.pending)fail('Review the pending skill proposals before adding another.','SKILL_APPROVAL_FULL');
  const proposal:SkillProposal={id:randomUUID(),createdAt:prepared.stamp,status:'pending',actor:structuredClone(actor),targets:[...prepared.pending.keys()],operations:structuredClone(prepared.operations)};
  store.put('skillProposal',proposal.id,null,proposal);return {status:'pending',changes:[],proposalId:proposal.id};
 }
 for(const version of prepared.versions)save(store,version.skill,version.actor,version.action);
 return {status:'applied',changes:[...prepared.pending.values()].map(metadata),appliedOperations:prepared.operations.length};
}

export function listSkillProposals(store:Store):SkillProposalSummary[]{return store.all<SkillProposal>('skillProposal').filter(item=>item.status==='pending').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(({operations:_operations,...summary})=>summary);}
export function viewSkillProposal(store:Store,id:string):SkillProposal {const proposal=store.get<SkillProposal>('skillProposal',id);if(!proposal)fail('Skill proposal not found.','NOT_FOUND');return proposal!;}
export function decideSkillProposal(store:Store,id:string,approve:boolean,now?:string):SkillChangeResult {
 if(typeof approve!=='boolean')fail('Choose approve or reject explicitly.');
 const proposal=viewSkillProposal(store,id);if(proposal.status!=='pending')fail('This proposal has already been reviewed.','SKILL_PROPOSAL_REVIEWED');
 const stamp=at(now);let result:SkillChangeResult={status:'rejected',changes:[],proposalId:id};
 if(approve)result={...applySkillOperations(store,proposal.operations,proposal.actor,{now:stamp}),proposalId:id};
 store.put('skillProposal',id,null,{...proposal,status:approve?'approved':'rejected',decidedAt:stamp});return result;
}
export function setSkillFlags(store:Store,name:string,flags:{enabled?:boolean;protected?:boolean},baseRevision:number,now?:string):SkillSummary {
 nameOf(name);if(!flags||typeof flags!=='object'||Array.isArray(flags)||Object.keys(flags).some(key=>!['enabled','protected'].includes(key)))fail('Choose valid skill controls.');
 const updates=Object.fromEntries(Object.entries(flags).filter(([,value])=>value!==undefined));if(!Object.keys(updates).length||Object.values(updates).some(value=>typeof value!=='boolean'))fail('Choose valid skill controls.');
 const record=current(store,name);if(!record)fail('Skill not found.','NOT_FOUND');if(baseRevision!==record!.revision)fail('This skill revision changed. Inspect it before editing.','STALE_SKILL');
 const next={...record!,...updates,revision:record!.revision+1,author:'user' as const,updatedAt:at(now)};save(store,next,{kind:'user'},'flags');return metadata(next);
}
export function skillIndex(store:Store):string {const page=listSkills(store);return JSON.stringify({catalogId:page.catalogId,skills:page.skills.map(({name,description,category,revision})=>({name,description,category,revision})),nextOffset:page.nextOffset});}
export function curateSkills(store:Store,options:{now?:string}={}):SkillSummary[]{
 const stamp=at(options.now),date=Date.parse(stamp),changes:SkillSummary[]=[];
 for(const summary of store.all<SkillSummary>('skill')){
  if(summary.origin!=='agent'||!summary.managed||summary.protected||!summary.enabled||summary.state==='archived')continue;
  const record=current(store,summary.name)!,last=Date.parse(record.lastUsedAt??record.createdAt);if(!Number.isFinite(last)||last>date)continue;
  const idle=date-last,state=idle>=30*86400000?'archived':idle>=14*86400000?'stale':'active';if(state===record.state)continue;
  const next={...record,state,revision:record.revision+1,author:'curator' as const,updatedAt:stamp} satisfies SkillRecord;save(store,next,{kind:'curator'},state==='archived'?'archive':'curate');changes.push(metadata(next));
 }
 return changes;
}
