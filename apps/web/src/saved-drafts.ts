import {z} from 'zod';
import {skillReferenceSchema,type SkillReference} from '../../../packages/contracts/skill-catalog';
import {terminalExcerptSchema,type TerminalExcerpt,excerptDraftKey} from './terminal-excerpts';
import {journalCompareAndSwapMany,journalReadRecord,journalSubscribe,type JournalRecord} from './journal';
import {skillDraftKey,readSkillBindings} from './composer-skill-drafts';
export const SAVED_DRAFT_MAX_COUNT=20,SAVED_DRAFT_MAX_BYTES=2*1024*1024;
const id=z.string().min(1).max(240),encoder=new TextEncoder();
export const savedDraftOwnerSchema=z.object({profileId:id,accountId:id.nullable(),threadId:id,projectId:id.nullable(),workingCopyId:id.nullable()}).strict();
export type SavedDraftOwner=z.infer<typeof savedDraftOwnerSchema>;
const resourceRefSchema=z.object({resourceId:id,identity:z.string().max(2048).optional()}).strict();
export type SavedResourceRef=z.infer<typeof resourceRefSchema>;
const textSchema=z.string().refine(value=>encoder.encode(value).length<=65536,'Draft text exceeds 64 KiB.');
export const savedDraftSchema=z.object({version:z.literal(1),id:z.string().uuid(),name:z.string().trim().min(1).max(120),owner:savedDraftOwnerSchema,updatedAt:z.string().datetime(),text:textSchema,resourceRefs:z.array(resourceRefSchema).max(100),skills:z.array(skillReferenceSchema).max(100),excerpts:z.array(terminalExcerptSchema).max(4)}).strict();
export type SavedDraft=z.infer<typeof savedDraftSchema>;
export interface SavedDraftLibrary {version:1;owner:SavedDraftOwner;records:SavedDraft[]}
export const savedDraftOwnerKey=(owner:SavedDraftOwner)=>{const o=savedDraftOwnerSchema.parse(owner);return JSON.stringify([o.profileId,o.accountId,o.threadId,o.projectId,o.workingCopyId]);};
export const savedDraftLibraryKey=(owner:SavedDraftOwner)=>'saved-drafts:'+savedDraftOwnerKey(owner);
export function readSavedDraftLibrary(value:unknown,owner:SavedDraftOwner):SavedDraftLibrary{
 const parsed=value===undefined?{version:1 as const,owner:savedDraftOwnerSchema.parse(owner),records:[]}:z.object({version:z.literal(1),owner:savedDraftOwnerSchema,records:z.array(savedDraftSchema).max(SAVED_DRAFT_MAX_COUNT)}).strict().parse(value);
 const key=savedDraftOwnerKey(owner);
 if(savedDraftOwnerKey(parsed.owner)!==key||parsed.records.some(record=>savedDraftOwnerKey(record.owner)!==key||record.excerpts.some(e=>e.threadId!==owner.threadId||e.projectId!==owner.projectId))||new Set(parsed.records.map(r=>r.id)).size!==parsed.records.length)throw Error('Saved drafts belong to another owner or contain duplicate records.');
 if(encoder.encode(JSON.stringify(parsed)).length>SAVED_DRAFT_MAX_BYTES)throw Error('Saved draft library exceeds 2 MiB.');
 return parsed;
}
export function createSavedDraft(owner:SavedDraftOwner,name:string,text:string,metadata:{resourceRefs?:SavedResourceRef[];skills?:SkillReference[];excerpts?:readonly TerminalExcerpt[]}={}):SavedDraft{
 return savedDraftSchema.parse({version:1,id:crypto.randomUUID(),owner,name,updatedAt:new Date().toISOString(),text,resourceRefs:metadata.resourceRefs??[],skills:metadata.skills??[],excerpts:metadata.excerpts??[]});
}
export function insertDraftText(current:string,text:string,caret:number){
 let at=Math.max(0,Math.min(current.length,Math.floor(caret)));if(at>0&&at<current.length&&/[\uD800-\uDBFF]/.test(current[at-1])&&/[\uDC00-\uDFFF]/.test(current[at]))at++;
 return {text:current.slice(0,at)+text+current.slice(at),caret:at+text.length};
}
export interface DraftReferenceValidationRequest {owner:SavedDraftOwner;resourceRefs:SavedResourceRef[];skills:SkillReference[]}
export interface DraftReferenceValidationResult {available:boolean;issues:string[]}
export interface DraftReferenceValidationAdapter {enabled:boolean;validate(input:DraftReferenceValidationRequest):Promise<DraftReferenceValidationResult>}
/** No endpoint is assumed. Rich restore remains disabled even if a caller passes metadata. */
export const disabledReferenceValidation:DraftReferenceValidationAdapter={enabled:false,validate:async input=>({available:false,issues:[...input.resourceRefs.map(ref=>`Resource ${ref.resourceId}: validation unavailable`),...input.skills.map(ref=>`Skill ${ref.skillId}: validation unavailable`)]})};
export async function loadSavedDrafts(owner:SavedDraftOwner){const record=await journalReadRecord(savedDraftLibraryKey(owner));return {library:readSavedDraftLibrary(record?.value,owner),generation:record?.generation};}
export const subscribeSavedDrafts=(owner:SavedDraftOwner,listener:()=>void)=>journalSubscribe(savedDraftLibraryKey(owner),listener);
function append(library:SavedDraftLibrary,record:SavedDraft){if(library.records.length>=SAVED_DRAFT_MAX_COUNT)throw Error('Saved drafts is full (20). Delete a draft before saving or replacing.');return readSavedDraftLibrary({...library,records:[record,...library.records]},library.owner);}
export async function saveNamedDraft(owner:SavedDraftOwner,name:string,resourceRefs:SavedResourceRef[]=[]){
 const [library,active,skills,excerpts]=await Promise.all([loadSavedDrafts(owner),journalReadRecord<string>('draft:'+owner.threadId),journalReadRecord(skillDraftKey(owner.threadId)),journalReadRecord(excerptDraftKey(owner.threadId))]);
 if(active&&typeof active.value!=='string')throw Error('Active draft could not be read. Keep this window open.');
 const text=active?.value??'';
 if(!text.trim()&&!resourceRefs.length&&!readSkillBindings(skills?.value).length&&!(excerpts?.value as unknown[]|undefined)?.length)throw Error('Write a prompt before saving.');
 const draft=createSavedDraft(owner,name,text,{resourceRefs,skills:readSkillBindings(skills?.value).map(binding=>binding.ref),excerpts:excerpts?.value as TerminalExcerpt[]|undefined});
 const next=append(library.library,draft);
 if(!await journalCompareAndSwapMany([{key:savedDraftLibraryKey(owner),generation:library.generation,value:next}],[{key:'draft:'+owner.threadId,generation:active?.generation},{key:skillDraftKey(owner.threadId),generation:skills?.generation},{key:excerptDraftKey(owner.threadId),generation:excerpts?.generation}]))throw Error('Draft changed in another window. Retry saving.');
 return draft;
}
export async function deleteSavedDraft(owner:SavedDraftOwner,id:string,generation:string|undefined){
 const current=await loadSavedDrafts(owner);if(current.generation!==generation)throw Error('Saved drafts changed. Review the list and retry.');
 if(!await journalCompareAndSwapMany([{key:savedDraftLibraryKey(owner),generation,value:{...current.library,records:current.library.records.filter(r=>r.id!==id)}}]))throw Error('Saved drafts changed. Review the list and retry.');
}
export interface DraftRestorePlan {ownerKey:string;draft:SavedDraft;libraryGeneration:string|undefined;active:JournalRecord<string>|undefined}
export async function planDraftRestore(owner:SavedDraftOwner,id:string):Promise<DraftRestorePlan>{const [library,active]=await Promise.all([loadSavedDrafts(owner),journalReadRecord<string>('draft:'+owner.threadId)]);const draft=library.library.records.find(r=>r.id===id);if(!draft)throw Error('This saved draft is no longer available. Refresh the list.');if(active&&typeof active.value!=='string')throw Error('Active draft could not be read. Keep this window open.');return {ownerKey:savedDraftOwnerKey(owner),draft,libraryGeneration:library.generation,active};}
export async function restoreSavedDraftText(owner:SavedDraftOwner,plan:DraftRestorePlan,mode:'replace'|'insert',caret:number){
 if(plan.ownerKey!==savedDraftOwnerKey(owner)||savedDraftOwnerKey(plan.draft.owner)!==plan.ownerKey)throw Error('The composer owner changed. Restore cancelled.');
 const current=await loadSavedDrafts(owner);if(current.generation!==plan.libraryGeneration)throw Error('Saved drafts changed. Review the list and retry.');
 const selected=current.library.records.find(record=>record.id===plan.draft.id);if(!selected||JSON.stringify(selected)!==JSON.stringify(plan.draft)||!selected.text)throw Error('Saved prompt changed or has no text to restore. Review and retry.');
 const before=plan.active?.value??'',result=mode==='insert'?insertDraftText(before,plan.draft.text,caret):{text:plan.draft.text,caret:plan.draft.text.length};textSchema.parse(result.text);
 const library=mode==='replace'&&before?append(current.library,createSavedDraft(owner,'Before replacing · '+new Date().toLocaleString(),before)):current.library;
 if(!await journalCompareAndSwapMany([{key:'draft:'+owner.threadId,generation:plan.active?.generation,value:result.text},{key:savedDraftLibraryKey(owner),generation:plan.libraryGeneration,value:library}]))throw Error('The current draft changed in another window. Nothing was replaced. Review and retry.');
 return result.caret;
}
