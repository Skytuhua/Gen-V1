import {z} from 'zod';
import {skillReferenceSchema,type SkillReference} from '../../../packages/contracts/skill-catalog';
import {terminalExcerptSchema,type TerminalExcerpt,excerptDraftKey} from './terminal-excerpts';
import {journalCompareAndSwapMany,journalReadRecord,journalEntries,journalSubscribeEntries,type JournalRecord} from './journal';
import {skillDraftKey,readSkillBindings} from './composer-skill-drafts';
import {SAVED_DRAFT_MAX_COUNT,SAVED_DRAFT_MAX_BYTES,SAVED_DRAFT_IDLE_MS,TERMINAL_EXCERPT_MAX_BYTES,TERMINAL_EXCERPT_MAX_COUNT} from './draft-limits';
export {SAVED_DRAFT_MAX_COUNT,SAVED_DRAFT_MAX_BYTES} from './draft-limits';
const id=z.string().min(1).max(240),encoder=new TextEncoder();
export const savedDraftOwnerSchema=z.object({profileId:id,accountId:id.nullable(),threadId:id,projectId:id.nullable(),workingCopyId:id.nullable()}).strict();
export type SavedDraftOwner=z.infer<typeof savedDraftOwnerSchema>;
const referenceId=z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_.-]+$/),binding=z.string().regex(/^[a-f0-9]{64}$/);
export const draftResourceRefSchema=z.strictObject({resourceId:referenceId,binding});
export type DraftResourceRef=z.infer<typeof draftResourceRefSchema>;
// Legacy hints remain inspectable; only the distinct host-issued binding can enter validation.
const resourceRefSchema=z.union([draftResourceRefSchema,z.strictObject({resourceId:id,identity:z.string().max(2048).optional()})]);
export type SavedResourceRef=z.infer<typeof resourceRefSchema>;
const textSchema=z.string().refine(value=>encoder.encode(value).length<=SAVED_DRAFT_MAX_BYTES,`Draft text exceeds ${SAVED_DRAFT_MAX_BYTES/1000} KB.`);
export const savedDraftSchema=z.object({version:z.literal(1),id:z.string().uuid(),name:z.string().trim().min(1).max(120),owner:savedDraftOwnerSchema,updatedAt:z.string().datetime(),text:textSchema,resourceRefs:z.array(resourceRefSchema).max(100),skills:z.array(skillReferenceSchema).max(100),excerpts:z.array(terminalExcerptSchema).max(TERMINAL_EXCERPT_MAX_COUNT)}).strict();
export type SavedDraft=z.infer<typeof savedDraftSchema>;
export interface SavedDraftLibrary {version:1;owner:SavedDraftOwner;records:SavedDraft[]}
export const savedDraftOwnerKey=(owner:SavedDraftOwner)=>{const o=savedDraftOwnerSchema.parse(owner);return JSON.stringify([o.profileId,o.accountId,o.threadId,o.projectId,o.workingCopyId]);};
export const savedDraftLibraryKey=(owner:SavedDraftOwner)=>'saved-drafts:'+savedDraftOwnerKey(owner);
export function readSavedDraftLibrary(value:unknown,owner:SavedDraftOwner):SavedDraftLibrary{
 const parsed=value===undefined?{version:1 as const,owner:savedDraftOwnerSchema.parse(owner),records:[]}:z.object({version:z.literal(1),owner:savedDraftOwnerSchema,records:z.array(savedDraftSchema)}).strict().parse(value);
 const key=savedDraftOwnerKey(owner);
 if(savedDraftOwnerKey(parsed.owner)!==key||parsed.records.some(record=>savedDraftOwnerKey(record.owner)!==key||record.excerpts.some(e=>e.threadId!==owner.threadId||e.projectId!==owner.projectId))||new Set(parsed.records.map(r=>r.id)).size!==parsed.records.length)throw Error('Saved drafts belong to another owner or contain duplicate records.');
 return parsed;
}
export function createSavedDraft(owner:SavedDraftOwner,name:string,text:string,metadata:{resourceRefs?:SavedResourceRef[];skills?:SkillReference[];excerpts?:readonly TerminalExcerpt[]}={}):SavedDraft{
 const draft=savedDraftSchema.parse({version:1,id:crypto.randomUUID(),owner,name,updatedAt:new Date().toISOString(),text,resourceRefs:metadata.resourceRefs??[],skills:metadata.skills??[],excerpts:metadata.excerpts??[]});
 const reviewed=draft.excerpts.reduce((bytes,e)=>bytes+encoder.encode(e.text).length,0),original=draft.excerpts.reduce((bytes,e)=>bytes+encoder.encode(e.originalText).length,0);
 if(Math.max(reviewed,original)>TERMINAL_EXCERPT_MAX_BYTES)throw Error(`Saved excerpts exceed ${TERMINAL_EXCERPT_MAX_BYTES/1000} KB combined. Shorten or remove an excerpt.`);
 if(encoder.encode(text).length+reviewed>SAVED_DRAFT_MAX_BYTES)throw Error(`Draft text and reviewed excerpts exceed ${SAVED_DRAFT_MAX_BYTES/1000} KB. Shorten the prompt or an excerpt.`);
 return draft;
}
export function insertDraftText(current:string,text:string,caret:number){
 let at=Math.max(0,Math.min(current.length,Math.floor(caret)));if(at>0&&at<current.length&&/[\uD800-\uDBFF]/.test(current[at-1])&&/[\uDC00-\uDFFF]/.test(current[at]))at++;
 return {text:current.slice(0,at)+text+current.slice(at),caret:at+text.length};
}
export interface ProjectOwner {projectId:string;threadId:string|null;workingCopyId:string|null;binding:string}
export type ReferenceStatus='valid'|'missing'|'revoked'|'changed'|'unavailable';
const unique=(values:readonly string[])=>new Set(values).size===values.length;
export const bindResourceRequestSchema=z.strictObject({threadId:referenceId,projectId:referenceId.nullable(),resourceIds:z.array(referenceId).max(32).refine(unique,'Duplicate resource IDs.')});
export type BindResourceRequest=z.infer<typeof bindResourceRequestSchema>;
export interface BindResourceResponse {owner:ProjectOwner|null;threadId:string;resources:{resourceId:string;status:ReferenceStatus;binding:string|null}[]}
export const validateReferencesRequestSchema=z.strictObject({threadId:referenceId,projectId:referenceId.nullable(),resources:z.array(draftResourceRefSchema).max(32).refine(refs=>unique(refs.map(ref=>ref.resourceId)),'Duplicate resource IDs.'),skills:z.array(skillReferenceSchema).max(8).refine(refs=>unique(refs.map(ref=>JSON.stringify(ref))),'Duplicate skill references.')});
export type ValidateReferencesRequest=z.infer<typeof validateReferencesRequestSchema>;
export interface ValidateReferencesResponse {owner:ProjectOwner|null;threadId:string;resources:{resourceId:string;status:ReferenceStatus}[];skills:{reference:SkillReference;status:ReferenceStatus}[]}
export type DraftReferenceValidationRequest=ValidateReferencesRequest;
export type DraftReferenceValidationResult<Response=ValidateReferencesResponse>={available:false;issues:string[]}|{available:true;response:Response};
export interface DraftReferenceValidationAdapter {enabled:boolean;bind(input:BindResourceRequest):Promise<DraftReferenceValidationResult<BindResourceResponse>>;validate(input:ValidateReferencesRequest):Promise<DraftReferenceValidationResult>}
/** Unavailable is a local capability result, never a simulated successful host response. */
export const disabledReferenceValidation={enabled:false,
 bind:async(input:BindResourceRequest)=>{const request=bindResourceRequestSchema.parse(input);return {available:false as const,issues:request.resourceIds.map(id=>`Resource ${id}: binding unavailable`)};},
 validate:async(input:ValidateReferencesRequest)=>{const request=validateReferencesRequestSchema.parse(input);return {available:false as const,issues:[...request.resources.map(ref=>`Resource ${ref.resourceId}: validation unavailable`),...request.skills.map(ref=>`Skill ${ref.skillId}: validation unavailable`)]};},
} satisfies DraftReferenceValidationAdapter;
const threadQuotaKey=(owner:SavedDraftOwner)=>'saved-draft-thread:'+JSON.stringify([owner.profileId,owner.accountId,owner.threadId]);
export async function loadSavedDrafts(owner:SavedDraftOwner):Promise<{library:SavedDraftLibrary;generation:string|undefined;threadGeneration:string|undefined;count:number;nextExpiry:number|null}>{
 for(let attempt=0;attempt<8;attempt++){
  const key=savedDraftLibraryKey(owner),record=await journalReadRecord(key),fallback=readSavedDraftLibrary(record?.value,owner),quotaKey=threadQuotaKey(owner),quota=await journalReadRecord(quotaKey),entries=await journalEntries();
  const libraries:{key:string;library:SavedDraftLibrary;generation:string}[]=[],threadPrefix='saved-drafts:'+JSON.stringify([owner.profileId,owner.accountId,owner.threadId]).slice(0,-1)+',';
  for(const entry of entries){
   if(!entry.key.startsWith('saved-drafts:'))continue;
   const record=await journalReadRecord(entry.key);
   if(!record)continue;
   try{
    const scope=savedDraftOwnerSchema.parse((record.value as {owner?:unknown}|null)?.owner);
    if(entry.key!==savedDraftLibraryKey(scope))throw Error('Saved draft owner does not match its local storage key.');
    libraries.push({key:entry.key,library:readSavedDraftLibrary(record.value,scope),generation:record.generation});
   }catch(cause){
    // An unreadable library in this thread makes its quota unknowable; unrelated corruption is isolated.
    if(entry.key.startsWith(threadPrefix))throw cause;
    console.warn('Skipped an invalid saved-draft library outside the current thread. Stored data was preserved.');
   }
  }
  const cutoff=Date.now()-SAVED_DRAFT_IDLE_MS,expired=libraries.flatMap(row=>{
   const records=row.library.records.filter(draft=>Date.parse(draft.updatedAt)>cutoff);
   return records.length===row.library.records.length?[]:[{key:row.key,generation:row.generation,value:{...row.library,records}}];
  });
  if(expired.length){
   const quotas=await Promise.all([...new Set(expired.map(row=>threadQuotaKey(row.value.owner)))].map(async key=>({key,generation:(await journalReadRecord(key))?.generation,value:0})));
   // Guard each expired library and its own thread quota; a concurrent edit causes a fresh scan.
   await journalCompareAndSwapMany([...expired,...quotas]);
   continue;
  }
  const current=libraries.find(row=>row.key===key),related=libraries.filter(row=>row.library.owner.profileId===owner.profileId&&row.library.owner.accountId===owner.accountId&&row.library.owner.threadId===owner.threadId);
  const expiry=libraries.reduce((next,row)=>row.library.records.reduce((next,draft)=>Math.min(next,Date.parse(draft.updatedAt)+SAVED_DRAFT_IDLE_MS),next),Infinity);
  return {library:current?.library??fallback,generation:current?.generation??record?.generation,threadGeneration:quota?.generation,count:related.reduce((count,row)=>count+row.library.records.length,0),nextExpiry:Number.isFinite(expiry)?expiry:null};
 }
 throw Error('Saved drafts changed in another window. Retry loading.');
}
export function subscribeSavedDrafts(_owner:SavedDraftOwner,listener:()=>void){
 // Inactive libraries can introduce an earlier deadline, including from another window.
 let queued=false,active=true;
 const stop=journalSubscribeEntries(key=>{if(!key.startsWith('saved-drafts:')||queued||!active)return;queued=true;queueMicrotask(()=>{queued=false;if(active)listener();});});
 return()=>{active=false;stop();};
}
function append(library:SavedDraftLibrary,record:SavedDraft,count:number){if(count>=SAVED_DRAFT_MAX_COUNT)throw Error(`Saved drafts is full (${SAVED_DRAFT_MAX_COUNT} per thread). Delete a draft before saving or replacing. Existing drafts are kept.`);return readSavedDraftLibrary({...library,records:[record,...library.records]},library.owner);}
export async function saveNamedDraft(owner:SavedDraftOwner,name:string,resourceRefs:SavedResourceRef[]=[]){
 const [library,active,skills,excerpts]=await Promise.all([loadSavedDrafts(owner),journalReadRecord<string>('draft:'+owner.threadId),journalReadRecord(skillDraftKey(owner.threadId)),journalReadRecord(excerptDraftKey(owner.threadId))]);
 if(active&&typeof active.value!=='string')throw Error('Active draft could not be read. Keep this window open.');
 const text=active?.value??'';
 if(!text.trim()&&!resourceRefs.length&&!readSkillBindings(skills?.value).length&&!(excerpts?.value as unknown[]|undefined)?.length)throw Error('Write a prompt before saving.');
 const draft=createSavedDraft(owner,name,text,{resourceRefs,skills:readSkillBindings(skills?.value).map(binding=>binding.ref),excerpts:excerpts?.value as TerminalExcerpt[]|undefined});
 const next=append(library.library,draft,library.count);
 if(!await journalCompareAndSwapMany([{key:savedDraftLibraryKey(owner),generation:library.generation,value:next},{key:threadQuotaKey(owner),generation:library.threadGeneration,value:0}],[{key:'draft:'+owner.threadId,generation:active?.generation},{key:skillDraftKey(owner.threadId),generation:skills?.generation},{key:excerptDraftKey(owner.threadId),generation:excerpts?.generation}]))throw Error('Draft changed in another window. Retry saving.');
 return draft;
}
export async function deleteSavedDraft(owner:SavedDraftOwner,id:string,generation:string|undefined){
 const current=await loadSavedDrafts(owner);if(current.generation!==generation)throw Error('Saved drafts changed. Review the list and retry.');
 if(!await journalCompareAndSwapMany([{key:savedDraftLibraryKey(owner),generation,value:{...current.library,records:current.library.records.filter(r=>r.id!==id)}},{key:threadQuotaKey(owner),generation:current.threadGeneration,value:0}]))throw Error('Saved drafts changed. Review the list and retry.');
}
export interface DraftRestorePlan {ownerKey:string;draft:SavedDraft;libraryGeneration:string|undefined;active:JournalRecord<string>|undefined}
export async function planDraftRestore(owner:SavedDraftOwner,id:string):Promise<DraftRestorePlan>{const [library,active]=await Promise.all([loadSavedDrafts(owner),journalReadRecord<string>('draft:'+owner.threadId)]);const draft=library.library.records.find(r=>r.id===id);if(!draft)throw Error('This saved draft is no longer available. Refresh the list.');if(active&&typeof active.value!=='string')throw Error('Active draft could not be read. Keep this window open.');return {ownerKey:savedDraftOwnerKey(owner),draft,libraryGeneration:library.generation,active};}
export async function restoreSavedDraftText(owner:SavedDraftOwner,plan:DraftRestorePlan,mode:'replace'|'insert',caret:number){
 if(plan.ownerKey!==savedDraftOwnerKey(owner)||savedDraftOwnerKey(plan.draft.owner)!==plan.ownerKey)throw Error('The composer owner changed. Restore cancelled.');
 const current=await loadSavedDrafts(owner);if(current.generation!==plan.libraryGeneration)throw Error('Saved drafts changed. Review the list and retry.');
 const selected=current.library.records.find(record=>record.id===plan.draft.id);if(!selected||JSON.stringify(selected)!==JSON.stringify(plan.draft)||!selected.text)throw Error('Saved prompt changed or has no text to restore. Review and retry.');
 const before=plan.active?.value??'',result=mode==='insert'?insertDraftText(before,plan.draft.text,caret):{text:plan.draft.text,caret:plan.draft.text.length};textSchema.parse(result.text);
 const library=mode==='replace'&&before?append(current.library,createSavedDraft(owner,'Before replacing · '+new Date().toLocaleString(),before),current.count):current.library;
 if(!await journalCompareAndSwapMany([{key:'draft:'+owner.threadId,generation:plan.active?.generation,value:result.text},{key:savedDraftLibraryKey(owner),generation:plan.libraryGeneration,value:library},{key:threadQuotaKey(owner),generation:current.threadGeneration,value:0}]))throw Error('The current draft changed in another window. Nothing was replaced. Review and retry.');
 return result.caret;
}
